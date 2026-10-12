import assert from "node:assert/strict";
import test from "node:test";

import { rpcUrls } from "../../lib/server/mainnet";

test("mainnet RPC list: own URLs in order, junk dropped, public endpoint last and never twice", () => {
  assert.deepEqual(rpcUrls(" https://a.example/?api-key=1 , http://plain , https://b.example "), [
    "https://a.example/?api-key=1",
    "https://b.example",
    "https://api.mainnet-beta.solana.com",
  ]);
  assert.deepEqual(rpcUrls(undefined), ["https://api.mainnet-beta.solana.com"]);
  assert.deepEqual(rpcUrls("https://api.mainnet-beta.solana.com"), ["https://api.mainnet-beta.solana.com"]);
});
