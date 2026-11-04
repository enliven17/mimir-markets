import assert from "node:assert/strict";
import test from "node:test";
import type { PublicClient } from "viem";
import { parseInviteWallets, readClaimInvitation } from "../../lib/chains/invites";
import { actionCalls, kindOfAction, pullOf, type MarketAction } from "../../lib/chains/calls";
import { marketChains } from "../../lib/chains/registry";
import { sendMarketAction } from "../../lib/chains/send";

const alice = "0x00000000000000000000000000000000000000a1" as const;
const bob = "0x00000000000000000000000000000000000000b0" as const;
const creator = "0x00000000000000000000000000000000000000c0" as const;
const contract = "0x0000000000000000000000000000000000000001" as const;

test("wallet batches normalize duplicates, reject malformed/zero/creator wallets and cap unique entries", () => {
  assert.deepEqual(parseInviteWallets(`${alice}, ${bob}\n${alice}`, creator).map(a => a.toLowerCase()), [alice, bob]);
  for (const text of ["", "alice.eth", "0x123", "0x0000000000000000000000000000000000000000", creator]) assert.throws(() => parseInviteWallets(text, creator));
  const many = Array.from({ length: 101 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`).join("\n");
  assert.throws(() => parseInviteWallets(many), /100/);
});

test("invitation reads bind the exact contract/claim/caller and never accept an unreadable legacy deployment", async () => {
  const reads: any[] = [];
  const client = { readContract: async (input: any) => { reads.push(input); return true; } } as unknown as PublicClient;
  assert.equal(await readClaimInvitation(client, contract, 7, alice), true);
  assert.equal(reads[0].address, contract);
  assert.equal(reads[0].functionName, "invited");
  assert.deepEqual(reads[0].args, [7n, alice]);
  for (const response of [undefined, "true", 1]) await assert.rejects(readClaimInvitation({ readContract: async () => response } as unknown as PublicClient, contract, 7, alice));
  await assert.rejects(readClaimInvitation({ readContract: async () => { throw new Error("missing selector"); } } as unknown as PublicClient, contract, 7, alice));
});

test("grant action uses VS with zero stake and no allowance/permit on either chain", async () => {
  const chains = marketChains({ arc: { mimirV3: contract, mimirPool: bob }, base: { mimirV3: contract, mimirPool: bob } }).chains;
  const action: MarketAction = { type: "invite", marketId: 7, accounts: [alice], allowed: true };
  assert.equal(kindOfAction(action), "vs");
  assert.equal(pullOf(action), 0n);
  for (const chain of [chains.base, chains.arc]) {
    assert.equal(actionCalls(chain, action, 0n).length, 1);
    assert.equal(actionCalls(chain, action, 0n)[0].value, undefined);
    let sent = 0;
    await sendMarketAction(chain, { address: creator, sendCalls: async (calls) => { sent++; assert.equal(calls.length, 1); return { txHash: "0x01", txHashes: ["0x01"] }; } }, action, { allowance: async () => { throw new Error("must not approve"); }, signTypedData: async () => { throw new Error("must not sign permit"); }, gasBalance: async () => 1n });
    assert.equal(sent, 1);
  }
});
