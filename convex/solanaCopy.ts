"use node";
import { v } from "convex/values";
import { randomUUID } from "node:crypto";
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { secretMatches } from "../lib/internal-secrets";
import { openHostedWallet } from "../lib/solana/hosted-wallet";
import { MimirSolanaClient } from "../lib/solana/client";
import { freeUsdc, returnBalanceToBase, stakeNative } from "../lib/solana/worker-stake";
import { USDC_MINT } from "../lib/solana/config";

export const fanout = internalAction({
  args: { agent: v.string(), marketId: v.number(), leaderTx: v.string() },
  handler: async (ctx, a): Promise<null> => {
    if (process.env.MIMIR_BACKEND_OFF === "1") return null;
    const subs = await ctx.runQuery(internal.solanaCopyDb.subscribers, { agent: a.agent });
    for (const sub of subs) await ctx.scheduler.runAfter(0, internal.solanaCopy.one, { sub, marketId: a.marketId, leaderTx: a.leaderTx });
    return null;
  },
});
export const one = internalAction({
  args: { sub: v.id("launchCopies"), marketId: v.number(), leaderTx: v.string() },
  handler: async (ctx, a): Promise<null> => {
    if (process.env.MIMIR_BACKEND_OFF === "1") return null;
    const key = `${a.sub}:solana:${a.leaderTx}`;
    if (!(await ctx.runMutation(internal.launchCopy.claim, { key, sub: a.sub, chain: "solana" }))) return null;
    const name = `copy:${a.sub}`, token = randomUUID();
    if (!(await ctx.runMutation(internal.solanaDb.lease, { name, token, ttlMs: 540_000 }))) {
      await ctx.runMutation(internal.launchCopy.finish, { key, status: "skipped", note: "Copy wallet is busy" }); return null;
    }
    try {
      const sub = await ctx.runQuery(internal.solanaCopyDb.privateSub, { id: a.sub });
      if (!sub?.active || !sub.solana?.on) { await ctx.runMutation(internal.launchCopy.finish, { key, status: "skipped", note: "Copying stopped" }); return null; }
      const client = new MimirSolanaClient(openHostedWallet(sub.solana)), claim = await client.getClaim(BigInt(a.marketId));
      if (!claim) throw new Error("No market");
      const cap = BigInt(Math.floor(sub.solana.maxPerStakeUsdc * 1e6)), free = await freeUsdc(client), room = claim.creatorStake * 5n - claim.totalChallengerStake;
      const amount = [cap, free, room].reduce((a, b) => a < b ? a : b);
      if (amount < 2_000_000n || await client.baseConnection.getBalance(client.publicKey) < 500_000) {
        await ctx.runMutation(internal.launchCopy.finish, { key, status: "skipped", note: "Fund the copy wallet with devnet USDC and SOL" }); return null;
      }
      const tx = await stakeNative(client, BigInt(a.marketId), amount);
      await ctx.runMutation(internal.launchCopy.finish, { key, status: "done", note: tx });
      await ctx.scheduler.runAfter(0, internal.solanaWorkers.sync, {});
    } catch {
      // A timed-out signature may still land: no automatic second send.
      await ctx.runMutation(internal.launchCopy.finish, { key, status: "unknown", note: "Check the wallet's on-chain positions before retrying" });
    } finally { await ctx.runMutation(internal.solanaDb.finish, { name, token, ok: true, note: "Copy job completed" }); }
    return null;
  },
});
export const withdraw = action({
  args: { secret: v.string(), agent: v.string(), follower: v.string(), amount: v.number() },
  handler: async (ctx, a): Promise<{ tx: string }> => {
    if (!secretMatches("launch", a.secret)) throw new Error("Not authorized");
    if (!Number.isFinite(a.amount) || a.amount <= 0 || a.amount > 1_000_000) throw new Error("Invalid amount");
    const sub = await ctx.runQuery(internal.solanaCopyDb.walletForFollower, { agent: a.agent, follower: a.follower });
    if (!sub) throw new Error("No copy wallet");
    const name = `copy:${sub.id}`, token = randomUUID();
    if (!(await ctx.runMutation(internal.solanaDb.lease, { name, token, ttlMs: 540_000 }))) throw new Error("Copy wallet is busy");
    try {
      const key = openHostedWallet(sub.wallet), client = new MimirSolanaClient(key), to = new PublicKey(a.follower);
      const free = await client.getBalance();
      if (free) { await returnBalanceToBase(client); await client.withdraw(free); }
      const units = BigInt(Math.round(a.amount * 1e6)), source = getAssociatedTokenAddressSync(USDC_MINT, key.publicKey), target = getAssociatedTokenAddressSync(USDC_MINT, to, true);
      const held = BigInt((await client.baseConnection.getTokenAccountBalance(source)).value.amount);
      if (units <= 0n || units > held) throw new Error("Not enough free test USDC");
      const tx = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(key.publicKey, target, to, USDC_MINT)).add(createTransferCheckedInstruction(source, USDC_MINT, target, key.publicKey, units, 6));
      return { tx: await sendAndConfirmTransaction(client.baseConnection, tx, [key], { commitment: "confirmed" }) };
    } finally { await ctx.runMutation(internal.solanaDb.finish, { name, token, ok: true, note: "Owner withdrawal completed" }); }
  },
});
