"use node";
import { v } from "convex/values";
import { PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { secretMatches } from "../lib/internal-secrets";
import { openHostedWallet } from "../lib/solana/hosted-wallet";
import { MimirSolanaClient } from "../lib/solana/client";
import { SOLANA_RPC, USDC_MINT } from "../lib/solana/config";
import { assertDevnetGenesis, createDevnetConnection } from "../lib/solana/devnet-connection";

/** The web server has verified a fresh Ed25519 owner signature before calling this. */
export const withdraw = action({
  args: { secret: v.string(), slug: v.string(), owner: v.string(), amount: v.number(), asset: v.union(v.literal("usdc"), v.literal("sol")) },
  handler: async (ctx, a): Promise<{ tx: string }> => {
    if (!secretMatches("launch", a.secret)) throw new Error("Not authorized");
    if (!Number.isFinite(a.amount) || a.amount <= 0 || a.amount > 1_000_000) throw new Error("Invalid withdrawal amount");
    const w = await ctx.runQuery(internal.solanaAgentsDb.walletForOwner, { slug: a.slug, owner: a.owner });
    if (!w) throw new Error("No owned Solana agent");
    const lease = await ctx.runMutation(api.launch.leaseForOwner, { secret: a.secret, slug: a.slug, owner: a.owner });
    if (lease === null) throw new Error("The agent is busy. Try again shortly.");
    try {
      const key = openHostedWallet(w), to = new PublicKey(a.owner), connection = createDevnetConnection(SOLANA_RPC);
      await assertDevnetGenesis(SOLANA_RPC);
      const units = BigInt(Math.round(a.amount * (a.asset === "sol" ? 1e9 : 1e6)));
      if (units <= 0n) throw new Error("Amount is below one token unit");
      const tx = new Transaction();
      if (a.asset === "sol") {
        const held = BigInt(await connection.getBalance(key.publicKey));
        if (units + 50_000n > held) throw new Error("Leave a little SOL for transaction fees");
        tx.add(SystemProgram.transfer({ fromPubkey: key.publicKey, toPubkey: to, lamports: units }));
      } else {
        // Free program balance can be returned; open stakes are never withdrawn.
        const client = new MimirSolanaClient(key);
        const free = await client.getBalance();
        if (free > 0n) {
          if (await client.isBalanceDelegated()) {
            await client.undelegateBalance();
            for (let i = 0; i < 20 && await client.isBalanceDelegated(); i++) await new Promise(r => setTimeout(r, 750));
            if (await client.isBalanceDelegated()) throw new Error("Program balance is returning from the rollup; try again shortly");
          }
          await client.withdraw(free);
        }
        const source = getAssociatedTokenAddressSync(USDC_MINT, key.publicKey), target = getAssociatedTokenAddressSync(USDC_MINT, to, true);
        const held = BigInt((await connection.getTokenAccountBalance(source)).value.amount);
        if (units > held) throw new Error("Not enough free test USDC");
        tx.add(createAssociatedTokenAccountIdempotentInstruction(key.publicKey, target, to, USDC_MINT));
        tx.add(createTransferCheckedInstruction(source, USDC_MINT, target, key.publicKey, units, 6));
      }
      const signature = await sendAndConfirmTransaction(connection, tx, [key], { commitment: "confirmed" });
      return { tx: signature };
    } finally {
      await ctx.runMutation(api.launch.releaseForOwner, { secret: a.secret, slug: a.slug, token: lease });
    }
  },
});
