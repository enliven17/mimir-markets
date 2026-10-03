import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

import { MimirSolanaClient, agentFeeAllowlistFromEnv } from "../../lib/solana/client";

test("payout legs recreate a closed recipient ATA idempotently", () => {
  const client = new MimirSolanaClient(Keypair.generate());
  const owner = Keypair.generate().publicKey;
  const ix = client.ensureAtaIx(owner);
  assert.ok(ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
  assert.deepEqual([...ix.data], [1], "CreateIdempotent");
  assert.ok(ix.keys[1].pubkey.equals(client.usdcAta(owner)));
});

test("fee-account rent is paid only for allowlisted agents", () => {
  assert.deepEqual([...agentFeeAllowlistFromEnv(" a, b ,,c ")], ["a", "b", "c"]);
  assert.equal(agentFeeAllowlistFromEnv(undefined).size, 0);
});

test("only active fee-earning registry agents join the crank's fee allowlist", async () => {
  const { feeEarnerWallets } = await import("../../agents/oracle/lifecycle");
  assert.deepEqual(
    feeEarnerWallets([
      { status: "active", capabilities: ["fee_earner"], payoutWallet: "A" },
      { status: "suspended", capabilities: ["fee_earner"], payoutWallet: "B" },
      { status: "active", capabilities: ["stake"], payoutWallet: "C" },
    ]),
    ["A"],
  );
});
