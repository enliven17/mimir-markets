"use node";

// Mimir Launch on Argus: the hourly fee round for agents whose token launched on Arc (lib/launch/argus-fees.ts). Each
// agent runs under its lease (launchSolDb.acquire), so no stake or withdrawal spends from its Arc wallet meanwhile.
// Env: LAUNCH_FEES=1 to run (off with MIMIR_BACKEND_OFF=1), LAUNCH_ARC_TREASURY (Mimir's Arc address for the platform +
// AI share), ARC_NETWORK/ARC_RPC; optional LAUNCH_ARGUS_MIN_CLAIM_USDC (default 2), LAUNCH_ARGUS_MIN_TREASURY_USDC (1).
import { encodeFunctionData, formatUnits, isAddress, type Address } from "viem";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { arcPublicClient } from "../lib/arc/chain";
import { arcConfig } from "../lib/arc/config";
import { ARGUS_LOCKER_ABI, ARGUS_SPLITTER_ABI } from "../lib/launch/argus";
import { argusFeeRound, type ArgusFeeDeps } from "../lib/launch/argus-fees";
import { circleTxState, executeContract, submitContract, submitTransfer, waitForCircleTx } from "../lib/server/circle-w3s";
import { createConsoleLogger } from "../lib/launch/worker/log";

const log = createConsoleLogger({ level: process.env.LOG_LEVEL, base: { svc: "launch-argus" } });
// Each agent may wait on up to four Circle txs (90 s each): five per run stays inside the action time limit.
const MAX_AGENTS = 5;

const usdc6 = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return BigInt(Math.round((Number.isFinite(n) && n > 0 ? n : fallback) * 1e6));
};

export const round = internalAction({
  args: {},
  handler: async (ctx) => {
    const e = process.env;
    if (e.MIMIR_BACKEND_OFF === "1" || e.LAUNCH_FEES !== "1") return;
    const treasury = e.LAUNCH_ARC_TREASURY?.trim();
    if (!treasury || !isAddress(treasury)) return log.warn("LAUNCH_ARC_TREASURY is not set: Argus fee round skipped");
    const cfg = arcConfig({ network: e.ARC_NETWORK, rpcUrl: e.ARC_RPC });
    if (cfg.network !== "mainnet") return; // Argus is on Arc mainnet only
    const client = arcPublicClient(cfg);
    const deps: Omit<ArgusFeeDeps, "now"> = {
      intervalMs: 24 * 60 * 60_000,
      minClaim6: usdc6("LAUNCH_ARGUS_MIN_CLAIM_USDC", 2),
      minTreasury6: usdc6("LAUNCH_ARGUS_MIN_TREASURY_USDC", 1),
      claimable6: (a) => client.readContract({ address: a.splitter as Address, abi: ARGUS_SPLITTER_ABI, functionName: "claimableQuote6", args: [a.wallet as Address] }),
      poke: async (a) => {
        for (const [address, data] of [
          [a.locker, encodeFunctionData({ abi: ARGUS_LOCKER_ABI, functionName: "collect" })],
          [a.splitter, encodeFunctionData({ abi: ARGUS_SPLITTER_ABI, functionName: "distribute" })],
        ] as const) {
          // Skip a call that would revert (nothing to collect or distribute): it would only burn gas.
          const ok = await client.call({ account: a.wallet as Address, to: address as Address, data }).then(() => true, () => false);
          if (ok) await executeContract({ walletId: a.walletId, contractAddress: address as Address, callData: data }).catch((err) => log.warn("argus poke failed", { agent: a.id, err: String(err) }));
        }
      },
      submitClaim: (a, key) =>
        submitContract({ walletId: a.walletId, contractAddress: a.splitter as Address, callData: encodeFunctionData({ abi: ARGUS_SPLITTER_ABI, functionName: "claim", args: [a.wallet as Address] }) }, key),
      submitTreasury: (a, amount6, key) => submitTransfer({ walletId: a.walletId, to: treasury as Address, amount: formatUnits(amount6, 6), blockchain: "ARC" }, key),
      state: circleTxState,
      wait: (id) => waitForCircleTx(id),
      save: (id, fees) => ctx.runMutation(internal.launchArgusDb.save, { id: id as Id<"launchAgents">, fees }).then(() => undefined),
      event: (id, text, tx) => ctx.runMutation(internal.launchArgusDb.event, { id: id as Id<"launchAgents">, text, ...(tx ? { tx } : {}) }).then(() => undefined),
    };
    // ponytail: agents run one after another; fan out per agent (like launchFeeDb.feeAll) if this outgrows the action timeout.
    for (const a of await ctx.runQuery(internal.launchArgusDb.due, { max: MAX_AGENTS })) {
      const id = a.id as Id<"launchAgents">;
      const token = await ctx.runMutation(internal.launchSolDb.acquire, { id });
      if (token === null) continue; // busy: next hour
      try {
        await argusFeeRound(a, { ...deps, now: Date.now() });
      } catch (err) {
        log.warn("argus fee round failed", { agent: a.id, err: String(err) });
      } finally {
        await ctx.runMutation(internal.launchSolDb.release, { id, token });
      }
    }
  },
});
