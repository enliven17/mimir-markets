// Mimir Launch review fixes: reserved slugs and copy-key namespaces (H1), the reconciler (H2), the $MIMIR-only gate
// (M3 + MIMIR-only), the pending fee claim (M6) and the 0-vault fallback (L2).
import assert from "node:assert/strict";
import { test } from "node:test";

import { holdsMimir } from "../../lib/launch/copy-gate";
import { copyKeyFor, councilCopyKey, isCouncilSlug, launchCopyKey, reservedLaunchSlug } from "../../lib/launch/copy-key";
import { claimAndSplit, type FeeAgent, type FeeDeps, type FeeExecutor, type FeeStore } from "../../lib/launch/fees";
import { reconcileItem, type ReconcileStore, type Unresolved } from "../../lib/launch/reconcile";
import { silentLog } from "../../lib/launch/worker/log";

// ---------------- H1 ----------------

test("H1: a launched agent can never take a persona's or a house name", () => {
  for (const s of ["socrates", "taleb", "ada", "lao-tzu", "oracle", "mimir", "s0crates"]) assert.equal(reservedLaunchSlug(s), true, s);
  for (const s of ["odin", "njord", "socrates-2"]) assert.equal(reservedLaunchSlug(s), false, s);
});

test("H1: copy subscriptions live in separate namespaces for personas and launched agents", () => {
  assert.equal(isCouncilSlug("socrates"), true);
  assert.equal(copyKeyFor("socrates"), "council:socrates");
  assert.equal(copyKeyFor("odin"), "launch:odin");
  assert.notEqual(councilCopyKey("socrates"), launchCopyKey("socrates"));
});

// ---------------- H2 ----------------

function recStore() {
  const out: string[] = [];
  const store: ReconcileStore = {
    payout: async (id, o, sig) => void out.push(`payout:${id}:${o}:${sig ?? ""}`),
    treasury: async (id, o, sig) => void out.push(`treasury:${id}:${o}:${sig ?? ""}`),
  };
  return { store, out };
}
const row = (over: Partial<Unresolved> = {}): Unresolved => ({ kind: "payout", id: "p1", agent: "a", sig: "S", lastValidBlockHeight: 10, status: "unknown", ...over });

test("H2: landed → sent; provably not landed or failed → failed (back to the pool / owed again); undecided stays open", async () => {
  const r = recStore();
  assert.equal(await reconcileItem(row(), async () => "landed", r.store), "sent");
  assert.equal(await reconcileItem(row({ kind: "treasury", id: "t1" }), async () => "notLanded", r.store), "failed");
  assert.equal(await reconcileItem(row({ id: "p2" }), async () => "failed", r.store), "failed");
  assert.equal(await reconcileItem(row({ id: "p3" }), async () => "unknown", r.store), "open");
  assert.equal(await reconcileItem(row({ id: "p4" }), async () => "pending", r.store), "open");
  assert.deepEqual(r.out, ["payout:p1:sent:S", "treasury:t1:failed:", "payout:p2:failed:"]);
});

test("H2: no signature: a 'sending' row never reached the wire (failed); an 'unknown' one needs a human (open)", async () => {
  const r = recStore();
  let asked = 0;
  const settle = async () => (asked++, "landed" as const);
  assert.equal(await reconcileItem(row({ sig: null, status: "sending" }), settle, r.store), "failed");
  assert.equal(await reconcileItem(row({ sig: null, status: "unknown" }), settle, r.store), "open");
  assert.equal(asked, 0);
});

// ---------------- the $MIMIR-only gate ----------------

test("gate: $MIMIR only, against the holder minimum; an ANSEM-only holder is refused", async () => {
  const env = { ...process.env };
  process.env.NEXT_PUBLIC_MIMIR_TOKEN_MINT = "MiMiRmintAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  try {
    const balances: Record<string, Record<string, number>> = {
      whale: { [process.env.NEXT_PUBLIC_MIMIR_TOKEN_MINT]: 50_000 },
      small: { [process.env.NEXT_PUBLIC_MIMIR_TOKEN_MINT]: 10 },
      ansemOnly: { "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump": 1_000_000 },
    };
    const read = async (w: string, mint: string) => {
      if (w === "down") throw new Error("rpc down");
      return balances[w]?.[mint] ?? 0;
    };
    const env2 = { MIMIR_TIER_HOLDER_MIN: "10000", ANSEM_HOLDER_MIN: "100" };
    assert.equal(await holdsMimir("whale", read, env2), "yes");
    assert.equal(await holdsMimir("small", read, env2), "no");
    assert.equal(await holdsMimir("ansemOnly", read, env2), "no");
    assert.equal(await holdsMimir("down", read, env2), "unknown");
    delete process.env.NEXT_PUBLIC_MIMIR_TOKEN_MINT;
    assert.equal(await holdsMimir("whale", read, env2), "unknown"); // no mint configured: fail closed, never "no"
  } finally {
    process.env = env;
  }
});

// ---------------- M6 / L2 / M5 ----------------

const SOL = 1_000_000_000n;
function feeKit(claimLamports = SOL) {
  const log: string[] = [];
  const executor: FeeExecutor = {
    async claimCreatorFees(a) { await a.onSigned?.("CLAIM", 5); log.push("claim"); return { sig: "CLAIM", lamports: claimLamports }; },
    async transferSol(a) { log.push(`transfer:${a.lamports}`); return "t"; },
    async buy(a) { log.push(`buy:${a.lamports}`); return { sig: "b", lamports: a.lamports, tokens: 1n, decimals: 6 }; },
    async burn() { log.push("burn"); return "burn"; },
    async spendable() { return 5n * SOL; },
  };
  const store: FeeStore = {
    markClaimed: async () => void log.push("marked"),
    claimSigned: async (_id, sig) => void log.push(`signed:${sig}`),
    clearPendingClaim: async (_id, sig) => void log.push(`cleared:${sig}`),
    recordClaim: async (_id, c) => (log.push(`record:${c.sig}:${c.lamports}:bankroll=${c.split.bankroll}:creator=${c.split.creatorPayout}`), { creatorPool: 0n, holdersPool: 0n }),
    recordBurn: async () => undefined,
    event: async () => undefined,
    beginCreatorPayout: async () => null,
    payoutSigned: async () => undefined,
    finishCreatorPayout: async () => undefined,
    owedTreasury: async () => [],
    treasurySigned: async () => undefined,
    finishTreasury: async () => undefined,
  };
  return { executor, store, log };
}
const agent = (over: Partial<FeeAgent> = {}): FeeAgent => ({
  id: "a", ticker: "A", mint: "Mint", creator: "Owner", walletId: "w", wallet: "W", status: "live", feesClaimedAt: null, slippageBps: 300,
  allocation: { bankroll: 100, buyback: 0, creatorPayout: 0, holders: 0 }, pendingAllocation: null, creatorPool: 0n, ...over,
});
const deps = (k: ReturnType<typeof feeKit>, accrued: bigint | null, settle?: FeeDeps["settleClaim"]): FeeDeps =>
  ({ store: k.store, executor: k.executor, accrued: async () => accrued, treasury: "T", minClaimLamports: 20_000_000n, creatorPayoutMinLamports: 10_000_000n, log: silentLog, ...(settle ? { settleClaim: settle } : {}) });

test("M6: the claim's signature is stored before broadcast", async () => {
  const k = feeKit();
  await claimAndSplit(agent(), deps(k, SOL));
  assert.deepEqual(k.log.slice(0, 3), ["marked", "signed:CLAIM", "claim"]);
});

test("M6: an earlier claim that landed unbooked is booked from its real deltas before any new claim", async () => {
  const k = feeKit();
  const out = await claimAndSplit(agent({ pendingClaim: { sig: "OLD", lastValidBlockHeight: 1 } }), deps(k, SOL, async () => ({ state: "landed", lamports: 300_000_000n })));
  assert.equal(out, 300_000_000n);
  assert.ok(k.log.includes("record:OLD:300000000:bankroll=240000000:creator=0"));
  assert.ok(k.log.includes("cleared:OLD"));
  assert.ok(!k.log.includes("claim"));
});

test("M6: an undecided earlier claim blocks a new one; a provably dead one is cleared and the round claims", async () => {
  const k = feeKit();
  assert.equal(await claimAndSplit(agent({ pendingClaim: { sig: "OLD", lastValidBlockHeight: 1 } }), deps(k, SOL, async () => ({ state: "unknown", lamports: 0n }))), 0n);
  assert.ok(!k.log.includes("claim"));
  const k2 = feeKit();
  assert.equal(await claimAndSplit(agent({ pendingClaim: { sig: "OLD", lastValidBlockHeight: 1 } }), deps(k2, SOL, async () => ({ state: "notLanded", lamports: 0n }))), SOL);
  assert.ok(k2.log.includes("cleared:OLD") && k2.log.includes("claim"));
});

test("L2: a vault read of 0 is not trusted: a stale agent claims on the 24h schedule; a small positive read waits", async () => {
  const k = feeKit();
  assert.equal(await claimAndSplit(agent({ feesClaimedAt: Date.now() - 25 * 3600_000 }), deps(k, 0n)), SOL);
  const k2 = feeKit();
  assert.equal(await claimAndSplit(agent({ feesClaimedAt: Date.now() - 25 * 3600_000 }), deps(k2, 1_000n)), 0n);
  const k3 = feeKit();
  assert.equal(await claimAndSplit(agent({ feesClaimedAt: Date.now() - 3600_000 }), deps(k3, 0n)), 0n);
});

test("M5: a shut-down agent still claims; its bankroll share goes to the owner", async () => {
  const k = feeKit();
  assert.equal(await claimAndSplit(agent({ status: "killed" }), deps(k, SOL)), SOL);
  assert.ok(k.log.includes("record:CLAIM:1000000000:bankroll=0:creator=800000000"));
});
