import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";

import {
  COPY_ID_PATTERN,
  DEFAULT_COPY_FORM,
  buildCopyDraft,
  copyDraftError,
  copyDraftFromBody,
  copyGrantBody,
  expiresAtFromDate,
  suggestCopyId,
  type CopyFormValues,
} from "../../lib/copy-form";
import { copyPermissionMessage } from "../../lib/copy-trading";

const FOLLOWER = Keypair.generate().publicKey.toBase58();
const NOW = new Date("2026-01-10T12:00:00").getTime();

function form(over: Partial<CopyFormValues> = {}): CopyFormValues {
  return {
    ...DEFAULT_COPY_FORM,
    id: "copy-stat-via-exec-abc",
    signalAgentId: "statistician",
    executionAgentId: "my-agent",
    expiresOn: "2026-02-01",
    ...over,
  };
}

test("the POSTed body rebuilds, through the route's own parser, to the exact signed message", () => {
  const draft = buildCopyDraft(form({ allowedCategories: ["crypto", "sports"] }), FOLLOWER, NOW);
  const body = JSON.parse(JSON.stringify(copyGrantBody(draft, "sig")));
  assert.equal(copyPermissionMessage(copyDraftFromBody(body, FOLLOWER)), copyPermissionMessage(draft));
  assert.equal(body.signature, "sig");
  assert.equal(body.signedAt, NOW);
});

test("categories are ordered canonically, not by click order", () => {
  const draft = buildCopyDraft(form({ allowedCategories: ["custom", "sports"] }), FOLLOWER, NOW);
  assert.deepEqual(draft.allowedCategories, ["sports", "custom"]);
});

test("the base58 follower is kept exactly as given", () => {
  assert.equal(buildCopyDraft(form(), FOLLOWER, NOW).follower, FOLLOWER);
});

test("expiry is the end of the chosen local day, and junk is 0", () => {
  assert.equal(expiresAtFromDate("2026-02-01"), new Date("2026-02-01T23:59:59").getTime());
  assert.equal(expiresAtFromDate(""), 0);
  assert.equal(expiresAtFromDate("tomorrow"), 0);
});

test("client validation reports what the server would reject", () => {
  const err = (over: Partial<CopyFormValues>) => copyDraftError(buildCopyDraft(form(over), FOLLOWER, NOW), NOW) ?? "";
  assert.equal(err({}), "");
  assert.match(err({ id: "X" }), /id must be/);
  assert.match(err({ executionAgentId: "statistician" }), /both the signal and the executor/);
  assert.match(err({ expiresOn: "" }), /expire in the future/);
  assert.match(err({ expiresOn: "2026-06-01" }), /at most 90 days/);
  assert.match(err({ maxPerPositionUsdc: "50" }), /exceed the daily cap/);
  assert.match(err({ maxPerPositionUsdc: "1" }), /minimum stake/);
  assert.match(err({ minPayoutRatio: "0.9" }), /guaranteed loss/);
  const unknown = copyDraftFromBody({ ...buildCopyDraft(form(), FOLLOWER, NOW), allowedCategories: ["memes"] }, FOLLOWER);
  assert.match(copyDraftError(unknown, NOW) ?? "", /unknown category/);
});

test("suggested ids always satisfy the server pattern", () => {
  const cases: Array<[string, string, string]> = [
    ["statistician", "my-agent", "k3x9"],
    ["Weird Name!!", "__exec__", "1"],
    ["", "", ""],
    ["a".repeat(80), "b".repeat(80), "zz"],
  ];
  for (const [s, e, suffix] of cases) {
    const id = suggestCopyId(s, e, suffix);
    assert.ok(COPY_ID_PATTERN.test(id), `${id} should be valid`);
  }
  assert.equal(suggestCopyId("statistician", "my-agent", "k3x9"), "copy-statistician-via-my-agent-k3x9");
});

// ── SDK: the follower and executor calls the server's own checks accept ────

test("the sdk grant is a body the route rebuilds to the message it signed", async () => {
  const { MimirAgentClient } = await import("../../sdk/agents");
  const { verifyAgentSignature } = await import("../../lib/agents/signature");
  const { validateAgentRequestEnvelope, agentRequestMessage } = await import("../../lib/agents/api");
  const operator = Keypair.generate();
  const sent: Array<{ url: string; method?: string; body?: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    sent.push({ url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ ok: true, copy: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  const client = new MimirAgentClient({ baseUrl: "http://mimir.test", agentId: "my-agent", operator, fetchImpl });

  const { follower: _f, signedAt: _s, active: _a, ...terms } = buildCopyDraft(form(), FOLLOWER, NOW);
  await client.grantCopyPermission({ ...terms, expiresAt: Date.now() + 86_400_000 });
  const body = sent[0].body!;
  const follower = operator.publicKey.toBase58();
  assert.equal(sent[0].url, "http://mimir.test/api/copy/permissions");
  assert.equal(body.follower, follower);
  assert.equal(
    verifyAgentSignature({
      address: follower,
      message: copyPermissionMessage(copyDraftFromBody(body, follower)),
      signature: String(body.signature),
    }),
    true,
  );

  await client.revokeCopyPermission("perm-1");
  const revoke = new URL(sent[1].url);
  assert.equal(sent[1].method, "DELETE");
  assert.equal(revoke.searchParams.get("id"), "perm-1");

  await client.copySignals();
  assert.equal(sent[2].url, "http://mimir.test/api/copy/signals");
  const env = validateAgentRequestEnvelope(sent[2].body, { action: "heartbeat" });
  assert.equal(
    verifyAgentSignature({ address: follower, message: agentRequestMessage(env), signature: env.signature ?? "" }),
    true,
    "the executor envelope is signed by the operator",
  );
});
