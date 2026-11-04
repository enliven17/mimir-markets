import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { OnchainClaim } from "../../lib/market-claim";
import type { decide as decideType } from "../../agents/oracle/decide";

/** Exercise the real decision pipeline/prompt construction. Only remote I/O is replaced. */
test("a creator's JSON predicate cannot short-circuit original-question agent evaluation", async t => {
  const root = await mkdtemp(join(tmpdir(), "mimir-json-fallback-"));
  const fixture = { prompts: [] as string[], evidenceUrls: [] as string[], body: {}, failModel: false, failEvidence: false, modelVerdict: "CHALLENGERS_WIN" };
  const globals = globalThis as typeof globalThis & { __mimirJsonFixture?: typeof fixture };
  const previousFixture = globals.__mimirJsonFixture;
  const originalFetch = globalThis.fetch;
  globals.__mimirJsonFixture = fixture;
  const summary = { header: { competitions: [{ date: "2026-10-01T18:00:00Z", status: { type: { completed: true, description: "Final" } }, competitors: [
    { team: { displayName: "Team A" }, score: "120", winner: true },
    { team: { displayName: "Team B" }, score: "115", winner: false },
  ] }] } };
  fixture.body = summary;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    assert.match(String(input), /^https:\/\/site\.api\.espn\.com\//, "unexpected external request");
    return new Response(JSON.stringify(summary), { status: 200 });
  }) as typeof fetch;
  const remote = {
    "lib/llm": `const f=globalThis.__mimirJsonFixture;
      export const pickGeminiModel=()=>"fixture";
      export const extractJson=t=>t;
      export async function callLLMWithMeta(prompt){f.prompts.push(prompt);if(f.failModel)throw Error("model temporarily unavailable");return {text:JSON.stringify({verdict:f.modelVerdict,confidence:95,explanation:"Final score is 235, below 250."}),provider:"fixture",model:"evidence"};}
      export const callLLM=async p=>(await callLLMWithMeta(p)).text;`,
    "lib/server/evidence-fetcher": `const f=globalThis.__mimirJsonFixture;
      export const BROWSER_USER_AGENT="fixture-browser";
      export class EvidenceFetchError extends Error {}
      export async function fetchEvidence(url){f.evidenceUrls.push(url);if(f.failEvidence)throw new EvidenceFetchError("source temporarily unavailable");return {text:JSON.stringify(f.body),fetcher:"espn-api"};}`,
    "lib/research/gateway": `export async function gatewayFetch(){return {status:200,body:JSON.stringify(globalThis.__mimirJsonFixture.body)};}`,
  };
  try {
    const outfile = join(root, "decide.mjs");
    const repo = resolve(import.meta.dirname, "../..");
    await build({ entryPoints: [resolve(repo, "agents/oracle/decide.ts")], outfile, bundle: true, platform: "node", format: "esm", define: { "process.env.ORACLE_LLM_THROTTLE_MS": '"0"' }, plugins: [{ name: "remote-boundaries", setup(b) {
      b.onResolve({ filter: /llm$|evidence-fetcher$|research\/gateway$/ }, args => {
        const path = resolve(args.resolveDir, args.path).slice(repo.length + 1).replaceAll("\\", "/");
        if (path in remote) return { path, namespace: "fixture" };
      });
      b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: remote[args.path as keyof typeof remote], loader: "js" }));
    } }] });
    const { decide } = await import(pathToFileURL(outfile).href) as { decide: typeof decideType };
    const url = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401234567";
    const deadline = Date.parse("2026-10-01T21:00:00Z") / 1000;
    const claim: OnchainClaim = {
      id: 1n, creator: "0x0000000000000000000000000000000000000001", question: "Will the final combined score exceed 250?", creatorPosition: "Yes", counterPosition: "No", resolutionUrl: url, category: "sports", creatorStake: 10n ** 18n, totalChallengerStake: 10n ** 18n,
      deadline, createdAt: deadline - 86400, state: 1, winnerSide: 0, resolutionSummary: "", confidence: 0, evidenceHash: new Uint8Array(32), maxChallengers: 100, creatorPaid: false,
      challengers: [{ addr: "0x0000000000000000000000000000000000000002", stake: 10n ** 18n, paid: false, agent: "" }], creatorAgent: "", feeRecipient: "", platformFeeBps: 0, agentFeeBps: 0, totalFees: 0n, disputeWindow: 3600, resolutionGrace: 604800, proposedSide: 0, proposedAt: 0, disputableUntil: 0, disputer: "", disputedAt: 0, bond: 0n, bondState: 0, resolvedAt: 0,
    };
    const ctx = { oracle: "0x0000000000000000000000000000000000000003", jury: null, now: () => (deadline + 60) * 1000 };
    for (const fragment of ["json:eq:true:header.competitions[0].status.type.completed", "json:gt:100:header.competitions[0].competitors[0].score"]) {
      await t.test(fragment, async () => {
        fixture.prompts.length = 0;fixture.evidenceUrls.length = 0;
        const c = { ...claim, resolutionUrl: `${url}#mimir=${fragment}` };
        const result = await decide(ctx, c);
        assert.equal(result?.verdict.verdict, "CHALLENGERS_WIN", "the true but unrelated predicate must not pay the Yes side");
        assert.equal(result?.bundle.model, "fixture/evidence");
        assert.equal(result?.bundle.resolver, undefined);
        assert.match(fixture.prompts[0], /Will the final combined score exceed 250\?/);
        assert.doesNotMatch(fixture.prompts[0], /#mimir=|json:eq:true|json:gt:100/);
        assert.deepEqual(fixture.evidenceUrls, [url]);
        assert.equal(result?.bundle.claim.resolutionUrl, c.resolutionUrl, "audit preserves the original URL");
      });
    }
    await t.test("temporary model failure defers instead of using the JSON predicate", async () => {
      fixture.failModel = true;
      assert.equal(await decide(ctx, { ...claim, resolutionUrl: `${url}#mimir=json:eq:true:header.competitions[0].status.type.completed` }), null);
      fixture.failModel = false;
    });
    await t.test("reversed Yes/No positions retain the model's side mapping", async () => {
      fixture.modelVerdict = "CREATOR_WINS";
      const result = await decide(ctx, { ...claim, creatorPosition: "No", counterPosition: "Yes", resolutionUrl: `${url}#mimir=json:eq:true:header.competitions[0].status.type.completed` });
      assert.equal(result?.verdict.verdict, "CREATOR_WINS");
      assert.match(fixture.prompts.at(-1)!, /Creator position \(Side A\): No/);
      fixture.modelVerdict = "CHALLENGERS_WIN";
    });
    await t.test("native ESPN beat resolver remains automatic", async () => {
      const count = fixture.prompts.length;
      const result = await decide(ctx, { ...claim, question: "Will Team A beat Team B?" });
      assert.equal(result?.verdict.verdict, "CREATOR_WINS");
      assert.equal(result?.bundle.model, "structured-resolver");
      assert.equal(fixture.prompts.length, count);
    });
    await t.test("unreadable evidence keeps the existing retry-then-refund policy", async () => {
      fixture.failEvidence = true;
      const c = { ...claim, resolutionUrl: `${url}#mimir=json:eq:true:header.competitions[0].status.type.completed` };
      assert.equal(await decide(ctx, c), null);
      const expired = await decide({ ...ctx, now: () => (deadline + 7 * 3600) * 1000 }, c);
      assert.equal(expired?.verdict.verdict, "UNRESOLVABLE");
      assert.equal(expired?.bundle.resolver, undefined);
      fixture.failEvidence = false;
    });
  } finally {
    globals.__mimirJsonFixture = previousFixture;
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
