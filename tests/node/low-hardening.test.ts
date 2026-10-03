import test from "node:test";
import assert from "node:assert/strict";

import { stripLinks } from "../../lib/verdict";
import { impersonatesReserved, isReservedAgentId } from "../../lib/agents/reserved";
import { publicRpcFor } from "../../lib/agents/public-rpc";

test("stripLinks removes links but not code words or resolver paths", () => {
  assert.equal(stripLinks("claim at evil.xyz/claim now"), "claim at [link removed] now");
  assert.equal(stripLinks("see t.me/scam"), "see [link removed]");
  assert.equal(stripLinks("Node.js reported events[0].status.type.completed"), "Node.js reported events[0].status.type.completed");
});

test("look-alike and leet spellings of house names are reserved", () => {
  assert.equal(isReservedAgentId("оracle"), true, "Cyrillic о");
  assert.equal(isReservedAgentId("0racle"), true);
  assert.equal(impersonatesReserved("The Oracle"), true);
  assert.equal(impersonatesReserved("Mimir Official Bot"), true);
  assert.equal(impersonatesReserved("Alice's momentum bot"), false);
});

test("agents get the app RPC only when it is a known public host", () => {
  assert.equal(publicRpcFor("base", { NEXT_PUBLIC_SOLANA_RPC: "https://x.solana-mainnet.quiknode.pro/SECRET/" }, true), "https://api.mainnet-beta.solana.com");
  assert.equal(publicRpcFor("base", { NEXT_PUBLIC_SOLANA_RPC: "https://api.mainnet-beta.solana.com" }, true), "https://api.mainnet-beta.solana.com");
  assert.equal(publicRpcFor("base", { AGENT_PUBLIC_RPC: "https://rpc.example.org" }, true), "https://rpc.example.org");
});

test("a flood of client keys cannot evict a deploy-wide cap in memory mode", async () => {
  const { allowRequest } = await import("../../lib/server/rate-limit");
  const prev = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const now = 1_000_000_000;
    assert.equal(await allowRequest("x-global", "all", 1, 60_000, now), true);
    for (let i = 0; i < 10_050; i++) await allowRequest("x", `ip${i}`, 5, 60_000, now);
    assert.equal(await allowRequest("x-global", "all", 1, 60_000, now), false, "still counted");
  } finally {
    if (prev !== undefined) process.env.DATABASE_URL = prev;
  }
});
