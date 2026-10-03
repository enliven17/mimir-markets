import assert from "node:assert/strict";
import test from "node:test";

import { isPublicRpcUrl, publicRpcFor } from "../../lib/agents/public-rpc";

test("a keyed or query-string RPC is never handed to agents", () => {
  assert.equal(isPublicRpcUrl("https://mainnet.helius-rpc.com/?api-key=secret"), false);
  assert.equal(isPublicRpcUrl("https://rpc.example.com/api-key/secret"), false);
  assert.equal(isPublicRpcUrl("https://rpc.example.com/?token=x"), false);
  assert.equal(isPublicRpcUrl("https://user:pw@rpc.example.com/"), false);
  assert.equal(isPublicRpcUrl("http://rpc.example.com/"), false);
  assert.equal(isPublicRpcUrl("https://api.mainnet-beta.solana.com"), true);
});

test("AGENT_PUBLIC_RPC wins, a keyed NEXT_PUBLIC_SOLANA_RPC falls back to the public endpoint", () => {
  assert.equal(
    publicRpcFor("base", { AGENT_PUBLIC_RPC: "https://public.example.com/" }, false),
    "https://public.example.com/",
  );
  assert.equal(
    publicRpcFor("base", { NEXT_PUBLIC_SOLANA_RPC: "https://x.helius-rpc.com/?api-key=k" }, true),
    "https://api.mainnet-beta.solana.com",
  );
  assert.equal(publicRpcFor("base", {}, false), "https://api.devnet.solana.com");
  assert.equal(
    publicRpcFor("base", { AGENT_PUBLIC_RPC: "https://x/?api-key=k", NEXT_PUBLIC_SOLANA_RPC: "https://ok.example.com" }, true),
    "https://api.mainnet-beta.solana.com",
    "an unknown host may carry a key in its path",
  );
});

test("the ER endpoint is sanitized too, and omitted on mainnet without a public one", () => {
  assert.equal(publicRpcFor("er", { NEXT_PUBLIC_MAGICBLOCK_ER_RPC: "https://er.example.com/?api-key=k" }, true), "");
  assert.equal(publicRpcFor("er", {}, false), "https://devnet-as.magicblock.app/");
  assert.equal(publicRpcFor("er", { AGENT_PUBLIC_ER_RPC: "https://er.example.com/" }, true), "https://er.example.com/");
});
