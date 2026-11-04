"use node";

import { Keypair, PublicKey } from "@solana/web3.js";
import { BorshCoder, EventParser } from "@coral-xyz/anchor";
import { randomUUID } from "node:crypto";
import { internal } from "./_generated/api";
import { internalAction, type ActionCtx } from "./_generated/server";
import { MimirSolanaClient, mimirIdl } from "../lib/solana/client";
import { MIMIR_PROGRAM_ID, USDC_MINT, ST_ACTIVE, ST_OPEN, ST_RESOLVED, ST_CANCELLED, ST_PROPOSED, BOND_REFUND_DUE } from "../lib/solana/config";
import { assertDevnetGenesis } from "../lib/solana/devnet-connection";
import { decisionClaim, indexedClaim, indexedPositions, INDEX_SCALE } from "../lib/solana/index-snapshot";
import { operatorKey } from "../lib/solana/worker-key";
import { decide } from "../agents/oracle/decide";
import { applyPayoutPolicy } from "../lib/oracle-payout-policy";
import roster from "../config/solana-roster.json";
import { creatorGross, challengerGross } from "../lib/solana/fees";

const side = { CREATOR_WINS: 1, CHALLENGERS_WIN: 2, DRAW: 3, UNRESOLVABLE: 4 } as const;
export async function run(ctx: ActionCtx, name: string, f: () => Promise<string>): Promise<null> {
  if (process.env.MIMIR_BACKEND_OFF === "1") return null;
  const token = randomUUID();
  if (!(await ctx.runMutation(internal.solanaDb.lease, { name, token, ttlMs: 540_000 }))) return null;
  try {
    const note = await f();
    await ctx.runMutation(internal.solanaDb.finish, { name, token, ok: true, note });
  } catch (e) {
    // Provider errors may include request context; keep the public health record free of it.
    console.warn(`[${name}] ${e instanceof Error ? e.name : "Error"}`);
    await ctx.runMutation(internal.solanaDb.finish, { name, token, ok: false, note: e instanceof Error ? e.name : "Error" });
    throw e;
  }
  return null;
}

export const sync = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => run(ctx, "indexer", async () => {
    const client = new MimirSolanaClient(Keypair.generate()); // read-only; this key is never funded or stored
    await assertDevnetGenesis(client.baseConnection.rpcEndpoint);
    const cfg = await client.getConfig();
    if (!cfg || !cfg.usdcMint.equals(USDC_MINT)) throw new Error("Devnet config/mint mismatch");
    const count = Number(cfg.claimCount);
    if (!Number.isSafeInteger(count) || count > 100_000) throw new Error("Invalid claim counter");
    const slot = await client.baseConnection.getSlot("confirmed");
    const known = new Set(await ctx.runQuery(internal.solanaDb.recentSignatures, {}));
    const events: Array<{ chain: "solana"; layer: "base" | "er"; kind: "vs"; marketId: number; name: string; user?: string; amount?: string; txHash: string; logIndex: number; block: number; at?: number; side?: number }> = [];
    const parser = new EventParser(MIMIR_PROGRAM_ID, new BorshCoder(mimirIdl()));
    for (const connection of [client.baseConnection, client.erConnection]) {
      const recent = await connection.getSignaturesForAddress(MIMIR_PROGRAM_ID, { limit: 20 }).catch(() => []);
      for (const sig of recent.filter(s => !s.err && !known.has(s.signature)).slice(0, 8)) {
        const tx = await connection.getTransaction(sig.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
        if (!tx?.meta || tx.meta.err || !tx.meta.logMessages) continue;
        let i = 0;
        for (const event of parser.parseLogs(tx.meta.logMessages)) {
          const d = event.data as Record<string, any>;
          if (d.id === undefined) continue;
          const user = d.creator ?? d.challenger ?? d.disputer ?? d.owner;
          events.push({ chain: "solana", layer: connection === client.erConnection ? "er" : "base", kind: "vs", marketId: Number(d.id.toString()), name: event.name,
            ...(user ? { user: user.toBase58() } : {}), ...(d.stake ? { amount: (BigInt(d.stake.toString()) * INDEX_SCALE).toString() } : {}),
            txHash: sig.signature, logIndex: i++, block: sig.slot, ...(sig.blockTime ? { at: sig.blockTime } : {}),
            ...(d.winnerSide !== undefined ? { side: Number(d.winnerSide) } : event.name === "ClaimChallenged" ? { side: 2 } : event.name === "ClaimCreated" ? { side: 1 } : {}),
          });
        }
      }
    }
    // Keep each mutation below Convex's transaction size limit as the program grows.
    let seen = 0;
    for (let start = 1; start <= count; start += 100) {
      const ids = Array.from({ length: Math.min(100, count - start + 1) }, (_, i) => BigInt(start + i));
      const rows = await client.getClaims(ids);
      const claims = rows.map(r => r.claim); seen += claims.length;
      await ctx.runMutation(internal.arc.apply, { name: "solana", block: slot,
        markets: claims.map(c => indexedClaim(c, slot)), positions: claims.flatMap(indexedPositions), events: start === 1 ? events : [],
      });
    }
    if (seen !== count) throw new Error(`Incomplete snapshot (${seen}/${count})`);
    await ctx.runMutation(internal.solanaDb.beat, { name: "solana-indexer" });
    return `${seen} claims indexed at slot ${slot}`;
  }),
});

export const oracle = internalAction({
  args: {},
  handler: async (ctx): Promise<null> => run(ctx, "oracle", async () => {
    if (process.env.MIMIR_PAUSE_ORACLE === "1") return "paused";
    const client = new MimirSolanaClient(operatorKey());
    const cfg = await client.getConfig();
    if (!cfg || cfg.oracle.toBase58() !== client.publicKey.toBase58() || !cfg.usdcMint.equals(USDC_MINT)) throw new Error("Oracle authority/mint mismatch");
    const claims = await client.getAllClaims();
    const now = Math.floor(Date.now() / 1000);
    let changes = 0, decisions = 0, payouts = 0, failures = 0;
    const house = new Set([roster.creator, ...Object.values(roster.council)]);
    const queued = await ctx.runQuery(internal.arc.oracleWork, { chain: "solana", now });
    const ready = new Set(queued.decide.map(m => m.marketId));
    for (const c of claims.sort((a, b) => a.deadline - b.deadline)) {
      if (changes >= 5) break;
      try {
        if (c.state === ST_CANCELLED) continue;
        if (c.state === ST_RESOLVED) {
          const owed = (!c.creatorPaid && creatorGross(c.winnerSide, c.creatorStake, c.totalChallengerStake)) || c.challengers.some(p => !p.paid && challengerGross(c.winnerSide, p.stake, c.creatorStake, c.totalChallengerStake)) || c.bondState === BOND_REFUND_DUE;
          if (payouts >= 3 || !owed) continue;
          const paid = await client.crankPayouts(c.id); payouts++; changes += paid.paid > 0 ? 1 : 0;
          if (paid.failed.length) throw new Error("Native payout legs failed");
          continue;
        }
        if (c.state === ST_PROPOSED) {
          if (c.disputableUntil <= now && !cfg.paused) {
            if (!(await client.ensureClaimOnBase(c.id))) continue;
            await client.finalizeResolution(c.id); changes++;
            if ((await client.crankPayouts(c.id)).failed.length) throw new Error("Native payout legs failed");
          }
          continue;
        }
        if ((c.disputedAt || c.deadline) + c.resolutionGrace <= now) {
          if (!(await client.ensureClaimOnBase(c.id))) continue;
          await client.refundExpired(c.id); changes++;
          if ((await client.crankPayouts(c.id)).failed.length) throw new Error("Native refund legs failed");
          continue;
        }
        if (cfg.paused) continue;
        if (c.state === ST_OPEN && c.deadline <= now && c.creator.equals(client.publicKey)) {
          // An uncontested claim has no opposing stake to win; return its seed without asking a model.
          if (!(await client.ensureClaimOnBase(c.id))) continue;
          await client.cancelClaim(c.id); changes++; continue;
        }
        if (c.state !== ST_ACTIVE || c.deadline > now || !ready.has(Number(c.id)) || decisions >= 2) continue;
        decisions++;
        const raw = await decide({ oracle: client.publicKey.toBase58(), house, jury: null }, decisionClaim(c));
        if (!raw) { await ctx.runMutation(internal.arc.deferMarket, { chain: "solana", kind: "vs", marketId: Number(c.id) }); continue; }
        const d = applyPayoutPolicy(raw, false, []);
        if (!(await client.ensureClaimOnBase(c.id))) continue;
        const tx = await client.proposeResolution(c.id, side[d.verdict.verdict], d.verdict.explanation.slice(0, 500), d.verdict.confidence, d.evidenceHash);
        await ctx.runMutation(internal.arc.saveVerdict, { chain: "solana", kind: "vs", marketId: Number(c.id), side: side[d.verdict.verdict],
          confidence: d.verdict.confidence, summary: d.verdict.explanation.slice(0, 500), evidenceHash: Buffer.from(d.evidenceHash).toString("hex"), bundle: JSON.stringify(d.bundle), txHash: tx });
        changes++;
      } catch (e) {
        failures++;
        console.warn(`[oracle] claim ${c.id}: ${e instanceof Error ? e.name : "Error"}`);
        await ctx.runMutation(internal.arc.deferMarket, { chain: "solana", kind: "vs", marketId: Number(c.id), error: "Native instruction or evidence check failed" });
      }
    }
    if (changes) await ctx.scheduler.runAfter(0, internal.solanaWorkers.sync, {});
    await ctx.runMutation(internal.solanaDb.beat, { name: "solana-oracle" });
    if (failures && !changes) throw new Error("Lifecycle operations failed; inspect operator logs");
    return `${decisions} decisions, ${changes} lifecycle changes, ${failures} failed`;
  }),
});
