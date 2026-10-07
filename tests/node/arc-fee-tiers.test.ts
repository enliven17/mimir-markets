import assert from "node:assert/strict";
import test from "node:test";
import { parseEther, recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { entryFee, FEE_TICKET_TYPES, feeTicketDomain, feeTierFor, feeTierThresholds } from "../../lib/arc/fee-tiers";

test("tiers: 5M and 10M $MIMIR, env can move them", () => {
  const t = feeTierThresholds({});
  assert.equal(feeTierFor(4_999_999, t), 0);
  assert.equal(feeTierFor(5_000_000, t), 1);
  assert.equal(feeTierFor(10_000_000, t), 2);
  assert.equal(feeTierFor(2_000, feeTierThresholds({ MIMIR_FEE_HOLDER_MIN: "1000", MIMIR_FEE_WHALE_MIN: "5000" })), 1);
});

test("entry fee: 0.5% / 0.25% / 0.1% of the gross stake", () => {
  assert.equal(entryFee(parseEther("10"), 0), parseEther("0.05"));
  assert.equal(entryFee(parseEther("10"), 1), parseEther("0.025"));
  assert.equal(entryFee(parseEther("10"), 2), parseEther("0.01"));
});

test("a signed ticket recovers to the signer, and not for another account", async () => {
  const signer = privateKeyToAccount(generatePrivateKey());
  const domain = feeTicketDomain(5042002, "0x00000000000000000000000000000000000000aa");
  const message = { account: "0x00000000000000000000000000000000000000bb", tier: 2, expires: 1_800_000_000n } as const;
  const signature = await signer.signTypedData({ domain, types: FEE_TICKET_TYPES, primaryType: "FeeTicket", message });
  assert.equal(await recoverTypedDataAddress({ domain, types: FEE_TICKET_TYPES, primaryType: "FeeTicket", message, signature }), signer.address);
  const other = { ...message, account: "0x00000000000000000000000000000000000000cc" } as const;
  assert.notEqual(await recoverTypedDataAddress({ domain, types: FEE_TICKET_TYPES, primaryType: "FeeTicket", message: other, signature }), signer.address);
});
