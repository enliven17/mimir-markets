/**
 * Mimir Launch: holder airdrops (ported from snipad worker/airdrop.ts). Each claim's holders share accrues in the agent's holders pool (worker/fees.ts);
 * once the pool reaches the minimum, and at most once per AIRDROP_EVERY_MS, a round pays it out to
 * the agent token's holders pro-rata:
 *   snapshot  every token account of the mint (Helius DAS, getProgramAccounts fallback)
 *   exclude   the agent wallet, the pump.fun bonding curve, any program-owned (off-curve) owner
 *             such as PumpSwap/Raydium pool vaults, explicit extras, and dust below `dustBps` of supply
 *   eligible  everyone above the dust line (one owner's accounts count once), at the MIN of their balance
 *             now and in a snapshot taken at a random time 6-18h earlier (anti-sniping, M2); a hard
 *             safety cap `max` (<= 500): over it, the top `max` are paid pro-rata and the event says so
 *   payable   recipients whose account is executable or owned by a program other than System are
 *             dropped at plan time (M1); a batch that still fails simulation is bisected down to the
 *             bad recipient, whose share goes back to the pool; no batch is retried forever
 *   pay       floor(pool * balance / sum) lamports each; shares under the rent-exempt minimum are
 *             skipped and stay in the pool for the next round, as does the rounding dust
 * Idempotent: a round is planned in full (recipients, amounts, batches) and its total reserved from
 * the pool in one write before any transfer. Every batch records its signature BEFORE broadcast,
 * so a crash mid-round resumes by asking the cluster about that signature instead of paying again.
 * Pure orchestration over ports; the Convex action (convex/launchFees.ts) wires the real ones.
 */
import type { Log } from "./worker/log";

export const RENT_EXEMPT_MIN = 890_880n; // lamports a fresh system account needs to exist
export const AIRDROP_EVERY_MS = 24 * 3600_000;
export const AIRDROP_BATCH = 20;
/** M2: hard safety cap on recipients per round. */
export const AIRDROP_HARD_CAP = 500;
/** M6: least holders pool a killed agent's final round runs with. */
export const FINAL_ROUND_MIN_LAMPORTS = 10_000_000n;
/** M1: a batch that provably failed this many times is dropped (its lamports go back to the pool). */
export const AIRDROP_BATCH_MAX_ATTEMPTS = 5;
/** M2: the earlier snapshot is picked at random from this window before planning. */
export const PRIOR_SNAPSHOT_MIN_AGE_MS = 6 * 3600_000;
export const PRIOR_SNAPSHOT_MAX_AGE_MS = 18 * 3600_000;
/** M2: owners kept per stored snapshot (Convex arrays hold at most 8192 values). */
export const SNAPSHOT_CAP = 4_000;

export type HolderAccount = { owner: string; amount: bigint };
export type Recipient = { to: string; lamports: bigint; tokens: bigint };
export type Plan = {
  recipients: Recipient[];
  total: bigint;
  skipped: { excluded: number; dust: number; belowRent: number; overCap: number };
};

export type PlanInput = {
  accounts: readonly HolderAccount[];
  supply: bigint;
  pool: bigint;
  /** Owners that never receive (agent wallet, curve PDA, known pools). */
  exclude: ReadonlySet<string>;
  /** False for program-derived (off-curve) owners: pool vaults, curves, escrows. */
  isWallet: (owner: string) => boolean;
  /** Owners holding less than this many basis points of supply are dust (1 = 0.01%). */
  dustBps: number;
  max: number;
  minLamports: bigint;
  /** M2: balances (per owner) from the earlier snapshot; eligibility is min(now, earlier). Missing owner = 0. */
  prior?: ReadonlyMap<string, bigint>;
};

export function planAirdrop(i: PlanInput): Plan {
  const skipped = { excluded: 0, dust: 0, belowRent: 0, overCap: 0 };
  const byOwner = new Map<string, bigint>();
  const excludedOwners = new Set<string>();
  for (const a of i.accounts) {
    if (a.amount <= 0n) continue;
    if (i.exclude.has(a.owner) || !i.isWallet(a.owner)) {
      excludedOwners.add(a.owner);
      continue;
    }
    byOwner.set(a.owner, (byOwner.get(a.owner) ?? 0n) + a.amount);
  }
  skipped.excluded = excludedOwners.size;
  if (i.prior) for (const [owner, amt] of byOwner) {
    const before = i.prior.get(owner) ?? 0n;
    if (before < amt) byOwner.set(owner, before);
  }
  const dustLine = (i.supply * BigInt(i.dustBps)) / 10_000n;
  const eligible = [...byOwner].filter(([, amt]) => {
    if (amt < dustLine) return (skipped.dust += 1), false;
    return true;
  });
  eligible.sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : x[0] < y[0] ? -1 : 1));
  const top = eligible.slice(0, Math.max(0, i.max));
  skipped.overCap = eligible.length - top.length;
  const sum = top.reduce((s, [, amt]) => s + amt, 0n);
  const recipients: Recipient[] = [];
  if (sum > 0n && i.pool > 0n) {
    for (const [to, tokens] of top) {
      const lamports = (i.pool * tokens) / sum;
      if (lamports < i.minLamports) skipped.belowRent += 1;
      else recipients.push({ to, lamports, tokens });
    }
  }
  return { recipients, total: recipients.reduce((s, r) => s + r.lamports, 0n), skipped };
}

type Env = Record<string, string | undefined>;
const intVar = (env: Env, name: string, fallback: number, min: number, max: number): number => {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer in ${min}..${max}`);
  return n;
};

/** Airdrop knobs from env. Pure, so the V8 scheduler and the Node action read the same values. */
export function airdropSettings(env: Env) {
  return {
    minLamports: BigInt(intVar(env, "HOLDER_AIRDROP_MIN_LAMPORTS", 100_000_000, 10_000_000, 1_000_000_000_000)),
    max: intVar(env, "HOLDER_AIRDROP_MAX", AIRDROP_HARD_CAP, 1, AIRDROP_HARD_CAP),
    /** M6: a killed agent's last round runs from this pool size (dust below it goes with the sweep). */
    finalMinLamports: FINAL_ROUND_MIN_LAMPORTS,
    /** Owners holding less than this many bps of supply are dust (1 = 0.01%). */
    dustBps: intVar(env, "HOLDER_AIRDROP_DUST_BPS", 1, 0, 10_000),
  };
}

export function batches<T>(xs: readonly T[], size = AIRDROP_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export function airdropDue(a: { pool: bigint; lastAt: number | null; now: number; min: bigint; killed: boolean }): boolean {
  if (a.pool < a.min) return false;
  return a.killed || a.lastAt === null || a.now - a.lastAt >= AIRDROP_EVERY_MS;
}

// ---------------- the round runner ----------------

export type Transfer = { to: string; lamports: bigint };
export type BatchView = { id: string; idx: number; transfers: Transfer[]; status: "planned" | "sending" | "sent" | "failed"; sig?: string; lastValidBlockHeight?: number; attempts?: number };
export type RoundView = { id: string; total: bigint; recipients: number; batches: BatchView[] };
export type Snapshot = { owner: string; amount: bigint }[];

export type AirdropStore = {
  /** The agent's unfinished round, if any. */
  openRound(agentId: string): Promise<RoundView | null>;
  /** Reserves plan.total from the holders pool and stores every batch, in one write. Null when the pool is short or a round is open. */
  createRound(agentId: string, plan: Plan, batchSize: number): Promise<RoundView | null>;
  /** Signature known, about to broadcast. */
  markSending(batchId: string, sig: string, lastValidBlockHeight: number): Promise<void>;
  /** sent (landed, with sig) or planned (provably not landed: pay again). Returns the batch's failed attempts so far. */
  markBatch(batchId: string, status: "sent" | "planned", sig?: string): Promise<number>;
  /** M1: replaces a planned batch by its two halves (both planned, attempts reset). */
  splitBatch(batchId: string): Promise<void>;
  /** M1: gives up on a planned batch: status failed, its lamports go back to the holders pool. */
  dropBatch(batchId: string, reason: string): Promise<void>;
  finishRound(roundId: string): Promise<void>;
  event(agentId: string, kind: "fee" | "error", text: string): Promise<void>;
  /** M2: one stored snapshot taken between `from` and `to`, chosen by `pick` in [0,1); null if none. */
  priorSnapshot(agentId: string, from: number, to: number, pick: number): Promise<ReadonlyMap<string, bigint> | null>;
  saveSnapshot(agentId: string, at: number, balances: Snapshot): Promise<void>;
  /** M6: a killed agent's pool that can pay nobody goes back to the bankroll (and on to the creator). */
  releaseHoldersPool(agentId: string): Promise<void>;
  /** M3: true while the wallet policy may be widened for a round; false once the base policy is back. */
  policyWidened(agentId: string, open: boolean): Promise<void>;
};

export type Settlement = "landed" | "failed" | "pending" | "notLanded" | "unknown";

export type AirdropChain = {
  snapshot(mint: string): Promise<{ accounts: HolderAccount[]; supply: bigint }>;
  isWallet(owner: string): boolean;
  /** The pump.fun bonding curve PDA of `mint` (holds the unsold supply). */
  curveAccount(mint: string): string;
  /** M1: the owners that can receive SOL (missing accounts or System-owned, non-executable ones). */
  payable(owners: string[]): Promise<Set<string>>;
  /** H1: where a signature stands (lib/launch/solana/tx.ts settleSignature: sticky + second-endpoint rule). */
  settle(sig: string, lastValidBlockHeight: number): Promise<Settlement>;
  /** Opens the wallet policy to exactly these recipients for this round; null restores the base policy. */
  allowRecipients(a: AirdropAgent, recipients: string[] | null): Promise<void>;
  /** One tx of SOL transfers; must call onSigned before broadcasting. */
  payBatch(a: { walletId: string; wallet: string; transfers: Transfer[]; onSigned(sig: string, lastValidBlockHeight: number): Promise<void> }): Promise<string>;
};

export type AirdropAgent = {
  id: string;
  ticker: string;
  mint: string;
  walletId: string;
  wallet: string;
  creator: string;
  treasury: string;
  status: "live" | "paused" | "killed";
  holdersPool: bigint;
  holdersAirdropAt: number | null;
};

export type AirdropDeps = {
  store: AirdropStore;
  chain: AirdropChain;
  minLamports: bigint;
  /** M6: the killed agent's final round runs from this pool size (default FINAL_ROUND_MIN_LAMPORTS). */
  finalMinLamports?: bigint;
  max: number;
  dustBps: number;
  batchSize?: number;
  /** Owners never paid besides the agent wallet and the curve (e.g. known pool authorities). */
  extraExclude?: readonly string[];
  log: Log;
  /** Picks the earlier snapshot (default Math.random). */
  random?: () => number;
};

export type AirdropResult = "idle" | "nothing" | "busy" | "waiting" | "done";

const sol = (l: bigint) => (Number(l) / 1e9).toFixed(3);
const provablyNotPaid = (err: unknown) => (err as { notLanded?: boolean })?.notLanded === true || (err as { name?: string })?.name === "TxFailedError";
/** The batch itself is bad (simulation/preflight refused it, or it landed and failed): bisect, do not just retry. */
const rejected = (err: unknown) => {
  const e = err as { code?: string; name?: string; message?: string };
  return e?.name === "TxFailedError" || e?.code === "TX_REJECTED" || /simulation failed/i.test(e?.message ?? "");
};
const minFor = (a: AirdropAgent, d: AirdropDeps) => (a.status === "killed" ? (d.finalMinLamports ?? FINAL_ROUND_MIN_LAMPORTS) : d.minLamports);

/** Owners that may receive: holders net of the agent wallet, the curve, extras and program-derived owners. */
function excludeSet(a: AirdropAgent, d: AirdropDeps): Set<string> {
  return new Set([a.wallet, d.chain.curveAccount(a.mint), ...(d.extraExclude ?? [])]);
}

/** M2: stores one aggregated balance per eligible owner (largest SNAPSHOT_CAP), for a later round's anti-sniping check. */
export async function takeSnapshot(a: AirdropAgent, d: AirdropDeps, now = Date.now()): Promise<number> {
  const snap = await d.chain.snapshot(a.mint);
  const exclude = excludeSet(a, d);
  const byOwner = new Map<string, bigint>();
  for (const x of snap.accounts) {
    if (x.amount <= 0n || exclude.has(x.owner) || !d.chain.isWallet(x.owner)) continue;
    byOwner.set(x.owner, (byOwner.get(x.owner) ?? 0n) + x.amount);
  }
  const rows = [...byOwner].sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : x[0] < y[0] ? -1 : 1)).slice(0, SNAPSHOT_CAP).map(([owner, amount]) => ({ owner, amount }));
  await d.store.saveSnapshot(a.id, now, rows);
  return rows.length;
}

/** M3: put the base policy back. Idempotent; a failure is logged and alerted, never thrown. */
async function restorePolicy(a: AirdropAgent, d: AirdropDeps): Promise<boolean> {
  try {
    await d.chain.allowRecipients(a, null);
    await d.store.policyWidened(a.id, false);
    return true;
  } catch (err) {
    d.log.error("airdrop: restoring the base wallet policy failed", { agentId: a.id, err });
    await d.store.event(a.id, "error", "SECURITY: restoring the wallet's base policy after a holder airdrop failed; retried on the next run").catch(() => undefined);
    return false;
  }
}

/** Plans a round with the anti-sniping minimum and drops recipients that cannot receive SOL (M1), re-planning so their share is re-spread. */
async function plan(a: AirdropAgent, d: AirdropDeps, prior: ReadonlyMap<string, bigint>): Promise<Plan> {
  const snap = await d.chain.snapshot(a.mint);
  const exclude = excludeSet(a, d);
  const checked = new Set<string>();
  for (let pass = 0; ; pass++) {
    const p = planAirdrop({ accounts: snap.accounts, supply: snap.supply, pool: a.holdersPool, exclude, isWallet: d.chain.isWallet, dustBps: d.dustBps, max: Math.min(d.max, AIRDROP_HARD_CAP), minLamports: RENT_EXEMPT_MIN, prior });
    const fresh = p.recipients.map((r) => r.to).filter((o) => !checked.has(o));
    if (!fresh.length) return p;
    const ok = await d.chain.payable(fresh);
    fresh.forEach((o) => checked.add(o));
    const bad = fresh.filter((o) => !ok.has(o));
    if (!bad.length) return p;
    d.log.warn("airdrop: recipients that cannot receive SOL dropped", { agentId: a.id, bad });
    bad.forEach((o) => exclude.add(o));
    if (pass >= 4) return planAirdrop({ accounts: snap.accounts, supply: snap.supply, pool: a.holdersPool, exclude, isWallet: d.chain.isWallet, dustBps: d.dustBps, max: Math.min(d.max, AIRDROP_HARD_CAP), minLamports: RENT_EXEMPT_MIN, prior });
  }
}

/** Plans (if due) or resumes the agent's round and pays what is left of it. Throws on a payment error; the round stays resumable. */
export async function runAirdrop(a: AirdropAgent, d: AirdropDeps, now = Date.now()): Promise<AirdropResult> {
  await restorePolicy(a, d);
  let round = await d.store.openRound(a.id);
  let capped = 0;
  if (!round) {
    const killed = a.status === "killed";
    if (!airdropDue({ pool: a.holdersPool, lastAt: a.holdersAirdropAt, now, min: minFor(a, d), killed })) return "idle";
    const prior = await d.store.priorSnapshot(a.id, now - PRIOR_SNAPSHOT_MAX_AGE_MS, now - PRIOR_SNAPSHOT_MIN_AGE_MS, (d.random ?? Math.random)());
    if (!prior) return "waiting"; // the first round waits until an earlier snapshot exists
    const p = await plan(a, d, prior);
    d.log.info("airdrop plan", { agentId: a.id, recipients: p.recipients.length, total: p.total.toString(), skipped: p.skipped });
    if (p.recipients.length === 0) {
      if (killed) {
        await d.store.releaseHoldersPool(a.id);
        await d.store.event(a.id, "fee", `final holder airdrop: nobody eligible, ${sol(a.holdersPool)} SOL returned with the bankroll`);
      }
      return "nothing";
    }
    capped = p.skipped.overCap;
    round = await d.store.createRound(a.id, p, d.batchSize ?? AIRDROP_BATCH);
    if (!round) return "busy";
  }

  // Settle batches whose signature is known but whose outcome is not (H1 rule: never re-pay on "unknown").
  for (const b of round.batches) {
    if (b.status !== "sending" || !b.sig) continue;
    const s = await d.chain.settle(b.sig, b.lastValidBlockHeight ?? Number.MAX_SAFE_INTEGER);
    if (s === "landed") await d.store.markBatch(b.id, "sent", b.sig);
    else if (s === "failed" || s === "notLanded") await d.store.markBatch(b.id, "planned");
    else return "waiting"; // may still land / cannot be proven dead: never pay it again
  }

  const roundId = round.id;
  for (let pass = 0; pass < 64; pass++) {
    const cur = await d.store.openRound(a.id);
    const todo = (cur?.batches ?? []).filter((b) => b.status === "planned").sort((x, y) => x.idx - y.idx);
    if (!todo.length) break;
    await d.store.policyWidened(a.id, true);
    await d.chain.allowRecipients(a, todo.flatMap((b) => b.transfers.map((t) => t.to)));
    try {
      for (const b of todo) {
        let sig: string;
        try {
          sig = await d.chain.payBatch({ walletId: a.walletId, wallet: a.wallet, transfers: b.transfers, onSigned: (s, lvbh) => d.store.markSending(b.id, s, lvbh) });
        } catch (err) {
          if (!provablyNotPaid(err)) {
            await d.store.event(a.id, "error", `airdrop batch ${b.idx + 1} sent but not confirmed; it is checked before anything is paid again`);
            throw err;
          }
          const attempts = await d.store.markBatch(b.id, "planned");
          if (rejected(err) && b.transfers.length > 1) {
            await d.store.splitBatch(b.id); // bisect toward the recipient that makes it fail
            continue;
          }
          if (rejected(err) || attempts >= AIRDROP_BATCH_MAX_ATTEMPTS) {
            const lamports = b.transfers.reduce((t, x) => t + x.lamports, 0n);
            const why = rejected(err) ? `recipient ${b.transfers[0]?.to} cannot be paid` : `failed ${attempts} times`;
            await d.store.dropBatch(b.id, why);
            await d.store.event(a.id, "error", `airdrop batch ${b.idx + 1} dropped (${why}): ${sol(lamports)} SOL back to the holders pool`);
            continue;
          }
          throw err;
        }
        await d.store.markBatch(b.id, "sent", sig);
      }
    } finally {
      await restorePolicy(a, d);
    }
  }
  const final = (await d.store.openRound(a.id)) ?? round;
  const paid = final.batches.filter((b) => b.status === "sent");
  const lamports = paid.reduce((t, b) => t + b.transfers.reduce((x, y) => x + y.lamports, 0n), 0n);
  const people = paid.reduce((t, b) => t + b.transfers.length, 0);
  await d.store.finishRound(roundId);
  await d.store.event(a.id, "fee", `airdropped ${sol(lamports)} SOL to ${people} holders of $${a.ticker}${capped ? ` (capped at the top ${people}; ${capped} smaller holders above the dust line were not paid this round)` : ""}`);
  return "done";
}
