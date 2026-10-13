import { test } from "node:test";
import assert from "node:assert/strict";
import { AIRDROP_BATCH_MAX_ATTEMPTS, AIRDROP_EVERY_MS, airdropDue, airdropSettings, batches, planAirdrop, RENT_EXEMPT_MIN, runAirdrop, takeSnapshot, type AirdropAgent, type AirdropChain, type AirdropStore, type RoundView } from "../../lib/launch/airdrop";
import { silentLog } from "../../lib/launch/worker/log";

const SUPPLY = 1_000_000_000_000_000n; // 1e9 tokens, 6 decimals
const AGENT = "AgentWallet11111111111111111111111111111111";
const CURVE = "CurvePda111111111111111111111111111111111111";
const POOL_PDA = "PumpSwapPool1111111111111111111111111111111";
const h = (n: number) => `Holder${String(n).padStart(3, "0")}`.padEnd(44, "1");
const pct = (p: number) => (SUPPLY * BigInt(Math.round(p * 10_000))) / 1_000_000n; // p percent of supply
const base = { supply: SUPPLY, exclude: new Set([AGENT, CURVE]), isWallet: (o: string) => o !== POOL_PDA, dustBps: 1, max: 100, minLamports: RENT_EXEMPT_MIN };

test("excludes the agent wallet, the curve, program-owned (off-curve) pools and dust; pro-rata in integer lamports", () => {
  const plan = planAirdrop({
    ...base,
    pool: 1_000_000_000n,
    accounts: [
      { owner: AGENT, amount: pct(5) },
      { owner: CURVE, amount: pct(60) },
      { owner: POOL_PDA, amount: pct(20) },
      { owner: h(1), amount: pct(3) },
      { owner: h(2), amount: pct(1) },
      { owner: h(3), amount: pct(0.009) }, // below 0.01% of supply: dust
    ],
  });
  assert.deepEqual(plan.recipients.map((r) => [r.to, r.lamports]), [[h(1), 750_000_000n], [h(2), 250_000_000n]]);
  assert.equal(plan.total, 1_000_000_000n);
  assert.deepEqual(plan.skipped, { excluded: 3, dust: 1, belowRent: 0, overCap: 0 });
});

test("one owner with several token accounts counts once; caps to the top N by balance", () => {
  const accounts = [
    { owner: h(1), amount: pct(1) },
    { owner: h(1), amount: pct(1) },
    ...Array.from({ length: 5 }, (_, i) => ({ owner: h(10 + i), amount: pct(1.5 - i * 0.1) })),
  ];
  const plan = planAirdrop({ ...base, max: 3, pool: 600_000_000n, accounts });
  assert.deepEqual(plan.recipients.map((r) => r.to), [h(1), h(10), h(11)]); // 2%, 1.5%, 1.4%
  assert.equal(plan.skipped.overCap, 3);
  // shares are of the capped set only: 2 : 1.5 : 1.4
  assert.deepEqual(plan.recipients.map((r) => r.lamports), [244_897_959n, 183_673_469n, 171_428_571n]);
  assert.ok(plan.total <= 600_000_000n);
});

test("shares below the rent-exempt minimum are skipped and their lamports roll into the next round", () => {
  const plan = planAirdrop({ ...base, pool: 100_000_000n, accounts: [{ owner: h(1), amount: pct(99) }, { owner: h(2), amount: pct(0.5) }] });
  // h(2) would get ~502_512 lamports < 890_880: skipped, not re-spread
  assert.deepEqual(plan.recipients.map((r) => r.to), [h(1)]);
  assert.equal(plan.skipped.belowRent, 1);
  assert.equal(plan.total, 99_497_487n);
  assert.ok(plan.total < 100_000_000n, "the rest stays in the pool");
  assert.equal(RENT_EXEMPT_MIN, 890_880n);
});

test("batches of 20", () => {
  const b = batches(Array.from({ length: 45 }, (_, i) => i), 20);
  assert.deepEqual(b.map((x) => x.length), [20, 20, 5]);
});

test("due: pool at the minimum and at most once per 24h; a killed agent's last round ignores the wait", () => {
  const now = 1_800_000_000_000;
  const min = 100_000_000n;
  assert.equal(AIRDROP_EVERY_MS, 24 * 3600_000);
  assert.equal(airdropDue({ pool: min - 1n, lastAt: null, now, min, killed: false }), false);
  assert.equal(airdropDue({ pool: min, lastAt: null, now, min, killed: false }), true);
  assert.equal(airdropDue({ pool: min, lastAt: now - AIRDROP_EVERY_MS + 1, now, min, killed: false }), false);
  assert.equal(airdropDue({ pool: min, lastAt: now - AIRDROP_EVERY_MS, now, min, killed: false }), true);
  assert.equal(airdropDue({ pool: min, lastAt: now - 1000, now, min, killed: true }), true);
});

// ---------------- the round runner ----------------

test("M2: everyone above the dust line is paid, up to the hard cap (default 500); over it, the top 500 pro-rata", () => {
  assert.equal(airdropSettings({}).max, 500);
  assert.throws(() => airdropSettings({ HOLDER_AIRDROP_MAX: "501" }), /1\.\.500/);
  const accounts = Array.from({ length: 600 }, (_, i) => ({ owner: h(i + 1), amount: pct(0.1) + BigInt(600 - i) }));
  const plan = planAirdrop({ ...base, max: 500, pool: 100n * 1_000_000_000n, accounts });
  assert.equal(plan.recipients.length, 500);
  assert.equal(plan.skipped.overCap, 100);
});

test("M2: anti-sniping: eligibility is the MIN balance across the planning snapshot and the earlier one", () => {
  const prior = new Map([[h(1), pct(3)], [h(2), pct(1)]]); // h(3) bought after the earlier snapshot
  const plan = planAirdrop({
    ...base,
    pool: 1_000_000_000n,
    prior,
    accounts: [{ owner: h(1), amount: pct(1) }, { owner: h(2), amount: pct(1) }, { owner: h(3), amount: pct(50) }],
  });
  // h(1) sold down to 1%: counts 1%. h(2) held 1%. h(3) was not there: 0, not paid.
  assert.deepEqual(plan.recipients.map((r) => [r.to, r.lamports]), [[h(1), 500_000_000n], [h(2), 500_000_000n]]);
});

// ---------------- the round runner ----------------

type Batch = RoundView["batches"][number] & { attempts?: number };
type Settle = "landed" | "failed" | "pending" | "notLanded" | "unknown";

function harness(o: { pool?: bigint; holders?: number; payFails?: (n: number, transfers: { to: string }[]) => Error | null; settle?: (sig: string) => Settle; prior?: boolean; unpayable?: string[]; policyFails?: boolean; status?: AirdropAgent["status"] } = {}) {
  const st = {
    pool: o.pool ?? 200_000_000n,
    lastAt: null as number | null,
    round: null as (RoundView & { done: boolean; batches: Batch[] }) | null,
    paid: [] as { to: string; lamports: bigint }[],
    policy: [] as (string[] | null)[],
    events: [] as string[],
    payCalls: 0,
    snapshots: 0,
    saved: [] as { owner: string; amount: bigint }[][],
    released: 0n,
    widened: false,
  };
  let nextBatch = 100;
  const store: AirdropStore = {
    async openRound() { return st.round && !st.round.done ? structuredClone(st.round) : null; },
    async createRound(_id, plan, size) {
      if ((st.round && !st.round.done) || plan.total > st.pool) return null;
      st.pool -= plan.total;
      st.round = { id: "r1", total: plan.total, recipients: plan.recipients.length, done: false, batches: batches(plan.recipients, size).map((t, i) => ({ id: `b${i}`, idx: i, transfers: t.map((r) => ({ to: r.to, lamports: r.lamports })), status: "planned" as const })) };
      return structuredClone(st.round);
    },
    async markSending(bid, sig, lvbh) { const b = st.round!.batches.find((x) => x.id === bid)!; Object.assign(b, { status: "sending", sig, lastValidBlockHeight: lvbh }); },
    async markBatch(bid, status, sig) {
      const b = st.round!.batches.find((x) => x.id === bid)!;
      b.status = status;
      if (status === "planned") { delete b.sig; delete b.lastValidBlockHeight; b.attempts = (b.attempts ?? 0) + 1; } else b.sig = sig;
      return b.attempts ?? 0;
    },
    async splitBatch(bid) {
      const r = st.round!;
      const b = r.batches.find((x) => x.id === bid)!;
      const half = Math.ceil(b.transfers.length / 2);
      const second = { id: `b${nextBatch++}`, idx: b.idx + 0.5, transfers: b.transfers.slice(half), status: "planned" as const };
      b.transfers = b.transfers.slice(0, half);
      b.attempts = 0;
      r.batches.push(second);
    },
    async dropBatch(bid) {
      const b = st.round!.batches.find((x) => x.id === bid)!;
      b.status = "failed";
      st.pool += b.transfers.reduce((s, t) => s + t.lamports, 0n);
    },
    async finishRound() { st.round!.done = true; st.lastAt = 1; },
    async event(_a, kind, text) { st.events.push(`${kind}:${text}`); },
    async priorSnapshot() { return o.prior === false ? null : new Map(holders.map((x) => [x.owner, x.amount])); },
    async saveSnapshot(_a, _at, balances) { st.saved.push(balances); },
    async releaseHoldersPool() { st.released += st.pool; st.pool = 0n; },
    async policyWidened(_a, open) { st.widened = open; },
  };
  const holders = Array.from({ length: o.holders ?? 25 }, (_, i) => ({ owner: h(i + 1), amount: pct(1) }));
  const chain: AirdropChain = {
    async snapshot() { st.snapshots++; return { accounts: [{ owner: AGENT, amount: pct(10) }, ...holders], supply: SUPPLY }; },
    isWallet: () => true,
    curveAccount: () => CURVE,
    async payable(owners) { return new Set(owners.filter((x) => !(o.unpayable ?? []).includes(x))); },
    async settle(sig) { return o.settle?.(sig) ?? "unknown"; },
    async allowRecipients(_a, list) {
      if (o.policyFails) throw new Error("privy 500");
      st.policy.push(list);
    },
    async payBatch(a) {
      st.payCalls++;
      const sig = `sig${st.payCalls}`;
      await a.onSigned(sig, 500);
      const err = o.payFails?.(st.payCalls, a.transfers);
      if (err) throw err;
      st.paid.push(...a.transfers);
      return sig;
    },
  };
  const agent: AirdropAgent = { id: "aa", ticker: "AA", mint: "Mintaa", walletId: "w", wallet: AGENT, creator: "C", treasury: "T", status: o.status ?? "live", holdersPool: st.pool, holdersAirdropAt: null };
  const cfg = { store, chain, minLamports: 100_000_000n, finalMinLamports: 10_000_000n, max: 100, dustBps: 1, batchSize: 20, log: silentLog, random: () => 0.5 };
  return { st, store, chain, agent, cfg };
}

test("a due round snapshots, reserves the pool, opens the policy for exactly this round's recipients, pays in batches, closes the policy", async () => {
  const { st, agent, cfg } = harness();
  assert.equal(await runAirdrop(agent, cfg, 1_800_000_000_000), "done");
  assert.equal(st.paid.length, 25);
  assert.equal(st.payCalls, 2); // 20 + 5
  assert.deepEqual(st.paid.map((p) => p.lamports), Array(25).fill(8_000_000n));
  assert.equal(st.pool, 0n);
  assert.deepEqual(st.policy.map((p) => p?.length ?? null), [null, 25, null], "restored at the start, opened, closed");
  assert.equal(st.widened, false);
  assert.ok(!st.paid.some((p) => p.to === AGENT));
  assert.match(st.events.at(-1) ?? "", /^fee:airdropped 0\.200 SOL to 25 holders/);
});

test("M3: every run starts by restoring the base policy, even with nothing due", async () => {
  const { st, agent, cfg } = harness({ pool: 50_000_000n });
  assert.equal(await runAirdrop({ ...agent, holdersPool: 50_000_000n }, cfg, 1), "idle");
  assert.equal(st.payCalls, 0);
  assert.deepEqual(st.policy, [null]);
  assert.equal(st.snapshots, 0);
});

test("M3: a failed restore is logged and alerted; the policy is not marked closed", async () => {
  const { st, agent, cfg } = harness({ pool: 50_000_000n, policyFails: true });
  st.widened = true;
  assert.equal(await runAirdrop({ ...agent, holdersPool: 50_000_000n }, cfg, 1), "idle");
  assert.ok(st.events.some((e) => /^error:SECURITY: .*policy/.test(e)));
  assert.equal(st.widened, true);
});

test("M2: the first round waits until an earlier snapshot (6-18h old) exists; no current snapshot is taken", async () => {
  const { st, agent, cfg } = harness({ prior: false });
  assert.equal(await runAirdrop(agent, cfg, 1), "waiting");
  assert.equal(st.snapshots, 0);
  assert.equal(st.round, null);
});

test("M2: takeSnapshot stores one aggregated, eligible balance per owner", async () => {
  const { st, agent, cfg } = harness({ holders: 3 });
  await takeSnapshot(agent, cfg, 1);
  assert.deepEqual(st.saved[0].map((x) => x.owner), [h(1), h(2), h(3)]);
});

test("M1: recipients that cannot receive SOL (executable / program-owned accounts) are dropped at plan time; their share is re-spread", async () => {
  const { st, agent, cfg } = harness({ holders: 4, unpayable: [h(2)] });
  assert.equal(await runAirdrop(agent, cfg, 1), "done");
  assert.deepEqual(st.paid.map((p) => p.to), [h(1), h(3), h(4)]);
  assert.equal(st.paid[0].lamports, 66_666_666n);
});

test("M1: a batch rejected by simulation is bisected; the one bad recipient is dropped and refunded, everyone else is paid", async () => {
  const bad = h(7);
  const rejected = Object.assign(new Error("simulation failed: InstructionError"), { notLanded: true, code: "TX_REJECTED" });
  const { st, agent, cfg } = harness({ payFails: (_n, t) => (t.some((x) => x.to === bad) ? rejected : null) });
  assert.equal(await runAirdrop(agent, cfg, 1), "done");
  assert.equal(st.paid.length, 24);
  assert.ok(!st.paid.some((p) => p.to === bad));
  assert.equal(st.pool, 8_000_000n, "the dropped share went back to the pool");
  assert.equal(st.round!.done, true);
});

test("M1: a batch that keeps failing (provably not landed) is not retried forever: dropped and refunded after the cap", async () => {
  const notLanded = Object.assign(new Error("privy 503"), { notLanded: true });
  const { st, agent, cfg } = harness({ holders: 5, payFails: () => notLanded });
  for (let i = 0; i < AIRDROP_BATCH_MAX_ATTEMPTS - 1; i++) await assert.rejects(runAirdrop(agent, cfg, 1));
  assert.equal(await runAirdrop(agent, cfg, 1), "done");
  assert.equal(st.paid.length, 0);
  assert.equal(st.pool, 200_000_000n);
  assert.ok(st.events.some((e) => /^error:airdrop batch 1 dropped/.test(e)));
});

test("crash after the second batch was signed and sent: resume finds it landed and never pays it twice", async () => {
  const crash = Object.assign(new Error("worker died mid-confirm"), { name: "AmbiguousSendError" });
  const h1 = harness({ payFails: (n) => (n === 2 ? crash : null) });
  await assert.rejects(runAirdrop(h1.agent, h1.cfg, 1));
  assert.deepEqual(h1.st.round!.batches.map((b: Batch) => b.status), ["sent", "sending"]);
  assert.deepEqual(h1.st.policy.at(-1), null, "policy closed even on failure");

  const paidBefore = h1.st.payCalls;
  const resume = { ...h1.cfg, chain: { ...h1.chain, settle: async (s: string) => (s === "sig2" ? ("landed" as const) : ("unknown" as const)) } };
  assert.equal(await runAirdrop(h1.agent, resume, 2), "done");
  assert.equal(h1.st.payCalls, paidBefore);
  assert.equal(h1.st.round!.done, true);
});

test("H1: resume re-sends a batch only when settle proves it never landed; unknown waits", async () => {
  const crash = Object.assign(new Error("timeout"), { name: "AmbiguousSendError" });
  const h1 = harness({ payFails: (n) => (n === 1 ? crash : null) });
  await assert.rejects(runAirdrop(h1.agent, h1.cfg, 1));
  assert.equal(h1.st.paid.length, 0);
  for (const s of ["unknown", "pending"] as const) {
    assert.equal(await runAirdrop(h1.agent, { ...h1.cfg, chain: { ...h1.chain, settle: async () => s } }, 2), "waiting");
    assert.equal(h1.st.payCalls, 1);
  }
  assert.equal(await runAirdrop(h1.agent, { ...h1.cfg, chain: { ...h1.chain, settle: async () => "notLanded" as const } }, 3), "done");
  assert.equal(h1.st.paid.length, 25);
  assert.equal(new Set(h1.st.paid.map((p) => p.to)).size, 25, "each holder paid exactly once");
});

test("a batch that provably did not land goes back to planned and the round resumes later", async () => {
  const notLanded = Object.assign(new Error("blockhash expired"), { notLanded: true, code: "EXPIRED" });
  const h1 = harness({ payFails: (n) => (n === 1 ? notLanded : null) });
  await assert.rejects(runAirdrop(h1.agent, h1.cfg, 1));
  assert.equal(h1.st.round!.batches[0].status, "planned");
  assert.equal(await runAirdrop(h1.agent, h1.cfg, 2), "done");
  assert.equal(h1.st.paid.length, 25);
});

test("nothing eligible (everyone below the rent minimum) → no round, the pool stays", async () => {
  const { st, agent, cfg } = harness({ pool: 100_000_000n, holders: 200 });
  assert.equal(await runAirdrop({ ...agent, holdersPool: 100_000_000n }, { ...cfg, max: 200 }, 1), "nothing");
  assert.equal(st.pool, 100_000_000n);
  assert.equal(st.round, null);
});

test("M6: a killed agent's holders pool below the normal minimum still gets a final round", async () => {
  const { st, agent, cfg } = harness({ pool: 50_000_000n, holders: 5, status: "killed" });
  assert.equal(await runAirdrop({ ...agent, holdersPool: 50_000_000n }, cfg, 1), "done");
  assert.equal(st.paid.length, 5);
});

test("M6: a killed agent whose final pool can pay nobody releases it, so the sweep can finish", async () => {
  const { st, agent, cfg } = harness({ pool: 20_000_000n, holders: 200, status: "killed" });
  assert.equal(await runAirdrop({ ...agent, holdersPool: 20_000_000n }, { ...cfg, max: 200 }, 1), "nothing");
  assert.equal(st.released, 20_000_000n);
});
