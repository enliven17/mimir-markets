/**
 * Admin CLI for the V3 program (signed by the admin keypair).
 *
 *   status                                   config, fees, pending governance, disputed claims
 *   pause | unpause                          stop / resume new claims, challenges and proposals
 *   settle <claimId> <creator|challengers|draw|unresolvable> "<summary>" [confidence]
 *                                            arbiter ruling on a DISPUTED claim
 *   withdraw-fees [usdc]                     move accrued platform fees to the fee recipient
 *   windows <disputeSeconds> <graceSeconds>  set windows for claims created from now on
 *
 * Run: npx tsx --env-file-if-exists=.env.local scripts/solana/admin.ts <command> [...]
 */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { MimirSolanaClient } from "../../lib/solana/client";
import { loadAgentKeypair } from "../../lib/solana/keypair";
import {
  SIDE_CHALLENGERS,
  SIDE_CREATOR,
  SIDE_DRAW,
  SIDE_UNRESOLVABLE,
  STATE_LABELS,
  ST_DISPUTED,
  fromUsdcUnits,
  toUsdcUnits,
} from "../../lib/solana/config";
import { explorer } from "./shared";

const SIDES: Record<string, number> = {
  creator: SIDE_CREATOR,
  challengers: SIDE_CHALLENGERS,
  draw: SIDE_DRAW,
  unresolvable: SIDE_UNRESOLVABLE,
};

async function status(client: MimirSolanaClient): Promise<void> {
  const c = await client.getConfig();
  if (!c) throw new Error("program not initialized");
  const eta = (t: number) => (t ? new Date(t * 1000).toISOString() : "—");
  console.log(`program        ${client.base.programId.toBase58()}`);
  console.log(`admin          ${c.admin.toBase58()}  (pending: ${c.pendingAdmin.equals(PublicKey.default) ? "—" : c.pendingAdmin.toBase58()})`);
  console.log(`oracle         ${c.oracle.toBase58()}  (queued: ${c.pendingOracleEta ? `${c.pendingOracle.toBase58()} at ${eta(c.pendingOracleEta)}` : "—"})`);
  console.log(`paused         ${c.paused}`);
  console.log(`windows        dispute ${c.disputeWindow}s, grace ${c.resolutionGrace}s`);
  console.log(`fees           ${c.platformFeeBps} bps platform → ${c.feeRecipient.toBase58()}, ${c.agentFeeBps} bps agent owner`);
  if (c.pendingFeeEta) {
    console.log(`queued fees    ${c.pendingPlatformFeeBps}/${c.pendingAgentFeeBps} bps → ${c.pendingFeeRecipient.toBase58()} at ${eta(c.pendingFeeEta)}`);
  }
  console.log(`fee pool       ${fromUsdcUnits(c.feesAccrued)} USDC outstanding (lifetime ${fromUsdcUnits(c.lifetimeFeesAccrued)} accrued, ${fromUsdcUnits(c.lifetimeFeesClaimed)} withdrawn)`);
  console.log(`claims         ${c.claimCount} (${c.totalResolved} resolved)`);
  for (let id = 1n; id <= c.claimCount; id++) {
    const claim = await client.getBaseClaim(id).catch(() => null);
    if (claim?.state === ST_DISPUTED) {
      console.log(
        `  #${id} ${STATE_LABELS[claim.state]} proposed=${claim.proposedSide} by disputer ${claim.disputer.toBase58()} — "${claim.question.slice(0, 60)}"`
      );
    }
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const client = new MimirSolanaClient(loadAgentKeypair());
  switch (cmd) {
    case "status":
    case undefined:
      return status(client);
    case "pause":
    case "unpause":
      return console.log(explorer(await client.setPaused(cmd === "pause")));
    case "settle": {
      const [idArg, sideArg, summary, conf] = args;
      const side = SIDES[sideArg?.toLowerCase() ?? ""];
      if (!idArg || !side || !summary) throw new Error('usage: settle <claimId> <creator|challengers|draw|unresolvable> "<summary>" [confidence]');
      const hash = createHash("sha256").update(`arbiter:${idArg}:${side}:${summary}`).digest();
      return console.log(explorer(await client.settleDispute(BigInt(idArg), side, summary.slice(0, 300), Number(conf ?? 100), hash)));
    }
    case "withdraw-fees": {
      const c = await client.getConfig();
      if (!c) throw new Error("program not initialized");
      const amount = args[0] ? toUsdcUnits(Number(args[0])) : c.feesAccrued;
      return console.log(explorer(await client.withdrawFees(amount, c.feeRecipient)));
    }
    case "windows": {
      const [dispute, grace] = args.map(Number);
      if (!Number.isFinite(dispute) || !Number.isFinite(grace)) throw new Error("usage: windows <disputeSeconds> <graceSeconds>");
      return console.log(explorer(await client.setWindows(dispute, grace)));
    }
    default:
      throw new Error(`unknown command ${cmd}`);
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
