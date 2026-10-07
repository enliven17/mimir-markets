import assert from "node:assert/strict";
import test from "node:test";

import { ask, jevEnabled } from "../../lib/jev";
import { RESOLVABLE_SKIP_AT, SPAM_SKIP_AT, skipTake, triageMarket } from "../../lib/jev-triage";
import { JEV_ALLOW_AT, JEV_BLOCK_AT, jevModeration } from "../../lib/moderation/jev-moderation";

async function withKey<T>(key: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.TYPESAFE_API_KEY;
  if (key === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = key;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = prev;
  }
}

/** A fetch that answers with the given replies in turn and records each request. */
function mockFetch(...replies: Array<{ status?: number; body?: unknown } | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const NOUL = { q: { type: "noul" as const, instructions: "is it?" } };
const MARKET = { question: "Will BTC close above $90k on Friday?", labelA: "Yes", labelB: "No", resolutionUrl: "https://www.coingecko.com/en/coins/bitcoin", category: "crypto", deadline: 1_800_000_000 };

test("off without a key: null, and no request is made", async () => {
  await withKey(undefined, async () => {
    const f = mockFetch({ body: { answers: { q: { noul: 0.9 } } } });
    assert.equal(jevEnabled(), false);
    assert.equal(await ask("state", NOUL, { fetchImpl: f.impl }), null);
    assert.equal(await triageMarket(MARKET, { fetchImpl: f.impl }), null);
    assert.equal(await jevModeration({ question: "q", creator_position: "a", opponent_position: "b", category: "crypto", settlement_rule: "r", resolution_url: "u" }, "v1", { fetchImpl: f.impl }), null);
    assert.equal(f.calls.length, 0);
  });
});

test("typed answers for noul, choice and score; the key is sent as a bearer token", async () => {
  await withKey("sk-test", async () => {
    const f = mockFetch({
      body: {
        model: "jev-1.13.0",
        answers: {
          yes: { noul: 0.73 },
          pick: { choice: "b", probabilities: { a: 0.1, b: 0.9 }, confidence: 0.92 },
          rate: { score: 1.4, probabilities: [0.1, 0.5, 0.4], confidence: 0.8 },
        },
      },
    });
    const a = await ask(
      "state",
      {
        yes: { type: "noul", instructions: "?" },
        pick: { type: "choice", instructions: "?", criteria: { a: "A", b: "B" } },
        rate: { type: "score", instructions: "?", criteria: ["low", "mid", "high"] },
      },
      { fetchImpl: f.impl },
    );
    assert.ok(a);
    assert.equal(a.yes.noul, 0.73);
    assert.equal(a.pick.choice, "b");
    assert.equal(a.rate.score, 1.4);
    assert.equal(f.calls[0].url, "https://api.typesafe.ai/v1/systemone");
    assert.equal((f.calls[0].init.headers as Record<string, string>).authorization, "Bearer sk-test");
  });
});

test("failures are null: an off-list choice, a 401, a timeout; 429 is retried once", async () => {
  await withKey("sk-test", async () => {
    const offList = mockFetch({ body: { answers: { pick: { choice: "z", probabilities: {}, confidence: 1 } } } });
    assert.equal(await ask("s", { pick: { type: "choice", instructions: "?", criteria: { a: "A" } } }, { fetchImpl: offList.impl }), null);

    const denied = mockFetch({ status: 401, body: { error: "bad key" } });
    assert.equal(await ask("s", NOUL, { fetchImpl: denied.impl }), null);
    assert.equal(denied.calls.length, 1);

    const timeout = mockFetch(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
    assert.equal(await ask("s", NOUL, { fetchImpl: timeout.impl }), null);

    const busy = mockFetch({ status: 429 }, { body: { answers: { q: { noul: 0.2 } } } });
    assert.deepEqual(await ask("s", NOUL, { fetchImpl: busy.impl }), { q: { noul: 0.2 } });
    assert.equal(busy.calls.length, 2);

    const twice = mockFetch({ status: 529 }, { status: 529 });
    assert.equal(await ask("s", NOUL, { fetchImpl: twice.impl }), null);
    assert.equal(twice.calls.length, 2);
  });
});

test("triage: the council skips only what Jev is sure about", async () => {
  assert.equal(skipTake(null), false, "no triage (Jev off) never skips");
  assert.equal(skipTake({ spam: SPAM_SKIP_AT, resolvable: 0.9 }), true);
  assert.equal(skipTake({ spam: 0.1, resolvable: RESOLVABLE_SKIP_AT }), true);
  assert.equal(skipTake({ spam: SPAM_SKIP_AT - 0.01, resolvable: RESOLVABLE_SKIP_AT + 0.01 }), false);
  await withKey("sk-test", async () => {
    const f = mockFetch({ body: { answers: { resolvable: { noul: 0.9 }, spam: { noul: 0.02 }, category: { choice: "crypto", probabilities: { crypto: 0.95 }, confidence: 0.95 } } } });
    assert.deepEqual(await triageMarket(MARKET, { fetchImpl: f.impl }), { resolvable: 0.9, spam: 0.02, category: "crypto", categoryConfidence: 0.95 });
  });
});

test("moderation: confident clean allows, confident violation blocks, anything else falls through to the model", async () => {
  const input = { question: "Will it rain in Paris tomorrow?", creator_position: "Yes", opponent_position: "No", category: "weather", settlement_rule: "Météo-France", resolution_url: "https://meteofrance.com" };
  const reply = (choice: string, p: number) => mockFetch({ body: { answers: { policy: { choice, probabilities: { [choice]: p }, confidence: p } } } });
  await withKey("sk-test", async () => {
    const clean = await jevModeration(input, "v1", { fetchImpl: reply("none", JEV_ALLOW_AT).impl });
    assert.equal(clean?.decision, "allow");
    assert.equal(clean?.policyVersion, "jev+v1");

    const bad = await jevModeration(input, "v1", { fetchImpl: reply("doxxing_personal_data", JEV_BLOCK_AT).impl });
    assert.deepEqual([bad?.decision, bad?.violationCodes], ["block", ["doxxing_personal_data"]]);

    assert.equal(await jevModeration(input, "v1", { fetchImpl: reply("none", JEV_ALLOW_AT - 0.01).impl }), null);
    assert.equal(await jevModeration(input, "v1", { fetchImpl: reply("hate_harassment", JEV_BLOCK_AT - 0.01).impl }), null);
    assert.equal(await jevModeration(input, "v1", { fetchImpl: mockFetch({ status: 500 }).impl }), null);
  });
});
