/**
 * Council money rules (audit P0-2, P1-2, P2-4): personas stake only on
 * structured-API evidence, size at real pool odds, and rule personas only
 * touch house markets (and stay off on mainnet by default).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";

import { evaluatePersonaForClaim, runPersonaForClaim, type RunnerContext } from "../../agents/council/shared/persona-runner";
import { rulePersonaGate, sizeStakeUnits } from "../../agents/council/shared/persona-rules";
import { getPersonaBySlug } from "../../agents/council/personas";
import type { CouncilClaim, EvidenceCacheEntry } from "../../agents/council/shared/types";
import type { MimirSolanaClient } from "../../lib/solana/client";

const U = (usdc: number) => BigInt(Math.round(usdc * 1e6));
const persona = (slug: string) => getPersonaBySlug(slug)!;
const house = Keypair.generate().publicKey;

function claim(creatorStake: number, challengerStakes: number[], extra: Partial<CouncilClaim> = {}): CouncilClaim {
  return {
    id: 42n,
    creator: Keypair.generate().publicKey,
    question: "Will SOL close above $200?",
    creatorPosition: "Yes",
    counterPosition: "No",
    resolutionUrl: "https://example.com/price",
    category: "crypto",
    creatorStake: U(creatorStake),
    totalChallengerStake: U(challengerStakes.reduce((a, b) => a + b, 0)),
    deadline: 2_000_000_000,
    state: 1,
    maxChallengers: 16,
    challengers: challengerStakes.map((s) => ({ addr: Keypair.generate().publicKey, stake: U(s), paid: false, agent: PublicKey.default })),
    ...extra,
  };
}

function ctxWith(fetcher: string, opts: { llmCalls?: { n: number }; confidence?: number; record?: boolean } = {}): RunnerContext {
  const evidenceCache = new Map<string, EvidenceCacheEntry>([["42", { text: "SOL is at $150.", fetcher }]]);
  return {
    evidenceCache,
    throttle: async () => undefined,
    recordForecasts: opts.record ?? false,
    mainnet: false,
    houseCreator: house.toBase58(),
    llm: async () => {
      if (opts.llmCalls) opts.llmCalls.n++;
      return JSON.stringify({ verdict: "CHALLENGERS_WIN", confidence: opts.confidence ?? 90, explanation: "SOL is far below $200." });
    },
  };
}

// ── P0-2: no money on scraped evidence ───────────────────────────────────────

test("a persona never stakes on scraped (non-API) evidence, and skips the LLM when nothing is logged", async () => {
  for (const fetcher of ["direct", "jina"]) {
    const calls = { n: 0 };
    const d = await evaluatePersonaForClaim(persona("pessimist"), claim(10, []), ctxWith(fetcher, { llmCalls: calls }));
    assert.equal(d.shouldStake, false, fetcher);
    assert.equal(d.skipReason, "non-api-evidence");
    assert.equal(calls.n, 0, "no forecast to log: no LLM call");
  }
});

test("with forecasts on, a scraped page still gets a logged read but no stake", async () => {
  const calls = { n: 0 };
  const d = await evaluatePersonaForClaim(persona("pessimist"), claim(10, []), ctxWith("jina", { llmCalls: calls, record: true }));
  assert.equal(calls.n, 1);
  assert.equal(d.shouldStake, false);
  assert.equal(d.skipReason, "non-api-evidence");
  assert.equal(d.confidence, 90, "the persona's own read is kept for calibration");
});

test("structured API evidence (the oracle's API_FETCHERS) can be staked on", async () => {
  for (const fetcher of ["coingecko-api", "flashtrade-api", "espn-api"]) {
    const d = await evaluatePersonaForClaim(persona("pessimist"), claim(10, []), ctxWith(fetcher));
    assert.equal(d.shouldStake, true, fetcher);
  }
});

// ── P1-2: real pool odds ─────────────────────────────────────────────────────

function fakeClient(bankroll: number, stakes: bigint[]): MimirSolanaClient {
  const me = Keypair.generate().publicKey;
  return {
    publicKey: me,
    getBalance: async () => U(bankroll),
    challengeClaimER: async (_id: bigint, units: bigint) => {
      stakes.push(units);
      return "sig";
    },
  } as unknown as MimirSolanaClient;
}

test("a confident persona still sits out a pool where no stake is +EV", async () => {
  const stakes: bigint[] = [];
  // 2 USDC creator vs 20 USDC of challengers: b ≈ 0.09, 80% is not enough.
  const out = await runPersonaForClaim(persona("pessimist"), fakeClient(100, stakes), claim(2, [20]), ctxWith("coingecko-api", { confidence: 80 }));
  assert.equal(out.kind, "abstained", "remembered: the odds only get worse");
  assert.equal(out.kind === "abstained" && out.decision.skipReason, "negative-ev");
  assert.deepEqual(stakes, []);
});

test("a +EV pool is staked, capped at the creator's stake", async () => {
  const stakes: bigint[] = [];
  const out = await runPersonaForClaim(persona("pessimist"), fakeClient(1000, stakes), claim(3, []), ctxWith("coingecko-api", { confidence: 95 }));
  assert.equal(out.kind, "staked");
  assert.deepEqual(stakes, [U(3)], "≤ 1× the 3 USDC creator stake, not 10% of a 1000 bankroll");
});

test("Kelly sizing uses pool odds, the creator-multiple cap and the 10% bankroll share", () => {
  const size = (confidence: number, bankroll: number, creator: number, challengers = 0) =>
    sizeStakeUnits({
      baseUsdc: 2,
      confidence,
      bankrollUnits: U(bankroll),
      creatorStakeUnits: U(creator),
      totalChallengerStakeUnits: U(challengers),
      maxCreatorMultiple: 1,
    });
  assert.equal(size(95, 100, 100), U(10), "10% bankroll share");
  assert.equal(size(95, 1000, 3), U(3), "1× creator stake");
  assert.equal(size(52, 25, 2), U(2), "Kelly under the minimum, but the minimum is still +EV");
  assert.equal(size(80, 100, 2, 20), 0n, "no +EV stake");
  assert.equal(size(90, 100, 0), 0n, "no creator stake to win");
  assert.equal(sizeStakeUnits({ baseUsdc: 2, confidence: 95, bankrollUnits: U(100) }), 0n, "no pool given: never even odds by default");
});

// ── P2-4: rule personas ──────────────────────────────────────────────────────

test("rule personas only act on house markets, and are off on mainnet unless overridden", () => {
  const contrarian = persona("contrarian");
  const houseClaim = claim(6, [4], { creator: house });
  const userClaim = claim(6, [4]);
  const gate = (c: CouncilClaim, mainnet: boolean, mainnetOverride = false, houseCreator: string | null = house.toBase58()) =>
    rulePersonaGate(contrarian, c, { houseCreator, mainnet, mainnetOverride });

  assert.equal(gate(houseClaim, false), null);
  assert.equal(gate(userClaim, false)?.skipReason, "rule-persona-gated");
  assert.equal(gate(houseClaim, false, false, null)?.skipReason, "rule-persona-gated", "unknown house: sit out");
  assert.equal(gate(houseClaim, true)?.skipReason, "rule-persona-gated");
  assert.equal(gate(houseClaim, true, true), null, "COUNCIL_RULE_PERSONAS_MAINNET=1");
  assert.equal(gate(userClaim, true, true)?.skipReason, "rule-persona-gated", "override still means house markets only");
  assert.equal(rulePersonaGate(persona("optimist"), userClaim, { houseCreator: null, mainnet: true, mainnetOverride: false }), null);
});

test("the runner applies the rule gate before any pool rule", async () => {
  const d = await evaluatePersonaForClaim(persona("contrarian"), claim(6, [4]), ctxWith("jina"));
  assert.equal(d.skipReason, "rule-persona-gated");
  const onHouse = await evaluatePersonaForClaim(persona("contrarian"), claim(6, [4], { creator: house }), ctxWith("jina"));
  assert.equal(onHouse.shouldStake, true);
});
