/**
 * Admin CLI for the V3 program (signed by the admin keypair).
 *
 *   status                                   config, fees, pending governance, disputed claims
 *   pause | unpause                          stop / resume new claims, challenges and proposals
 *   settle <claimId> <creator|challengers|draw|unresolvable> "<summary>" [confidence]
 *                                            arbiter ruling on a DISPUTED claim
 *   withdraw-fees [usdc]                     move accrued platform fees to the fee recipient
 *   windows <disputeSeconds> <graceSeconds>  set windows for claims created from now on
 *   propose-admin <pubkey>                   hand admin to <pubkey> (e.g. a Squads vault); it must accept
 *   accept-admin-ix <pubkey>                 print the accept_admin instruction <pubkey> has to sign
 *   queue-oracle <pubkey> | cancel-oracle    queue / drop an oracle rotation (2-day timelock)
 *   execute-oracle                           apply a queued oracle once its timelock passed (permissionless)
 *   queue-fee-policy <platformBps> <agentBps> <recipient> | cancel-fee-policy
 *                                            queue / drop a fee change (2-day timelock)
 *   execute-fee-policy                       apply a queued fee policy once its timelock passed (permissionless)
 *
 * Every command but status / accept-admin-ix writes: on mainnet it needs --yes.
 *
 * Run: npx tsx --env-file-if-exists=.env.local scripts/solana/admin.ts <command> [...] [--yes]
 */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { MimirSolanaClient } from "../../lib/solana/client";
import { loadAgentKeypair } from "../../lib/solana/keypair";
import { validateFeePolicy } from "../../lib/solana/fees";
import {
  SIDE_CHALLENGERS,
  SIDE_CREATOR,
  SIDE_DRAW,
  SIDE_UNRESOLVABLE,
  STATE_LABELS,
  ST_DISPUTED,
  configPda,
  fromUsdcUnits,
  toUsdcUnits,
} from "../../lib/solana/config";
import { explorer } from "./shared";
import { positional, requireMainnetConfirm } from "./guards";

const SIDES: Record<string, number> = {
  creator: SIDE_CREATOR,
  challengers: SIDE_CHALLENGERS,
  draw: SIDE_DRAW,
  unresolvable: SIDE_UNRESOLVABLE,
};

const READ_ONLY = new Set(["status", "accept-admin-ix", undefined]);

async function status(client: MimirSolanaClient): Promise<void> {
  const c = await client.getConfig();
  if (!c) throw new Error("program not initialized");
  const eta = (t: number) => (t ? new Date(t * 1000).toISOString() : "-");
  console.log(`program        ${client.base.programId.toBase58()}`);
  console.log(`admin          ${c.admin.toBase58()}  (pending: ${c.pendingAdmin.equals(PublicKey.default) ? "-" : c.pendingAdmin.toBase58()})`);
  console.log(`oracle         ${c.oracle.toBase58()}  (queued: ${c.pendingOracleEta ? `${c.pendingOracle.toBase58()} at ${eta(c.pendingOracleEta)}` : "-"})`);
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
        `  #${id} ${STATE_LABELS[claim.state]} proposed=${claim.proposedSide} by disputer ${claim.disputer.toBase58()}: "${claim.question.slice(0, 60)}"`
      );
    }
  }
}

function pubkeyArg(value: string | undefined, usage: string): PublicKey {
  if (!value) throw new Error(`usage: ${usage}`);
  return new PublicKey(value);
}

/**
 * The accept_admin instruction the proposed admin signs. For a Squads vault:
 * create a vault transaction (Transaction Builder / custom instruction) with
 * exactly this program id, account list and data, get it approved to
 * threshold and execute it; the vault PDA signs as `new_admin`.
 */
async function printAcceptAdmin(client: MimirSolanaClient, next: PublicKey): Promise<void> {
  const ix = await client.base.methods.acceptAdmin().accounts({ newAdmin: next }).instruction();
  console.log(`\nNext: ${next.toBase58()} must sign accept_admin. For a Squads multisig, add a vault transaction with:`);
  console.log(`  program  ${ix.programId.toBase58()}`);
  for (const k of ix.keys) {
    const role = k.pubkey.equals(next) ? "new_admin" : k.pubkey.equals(configPda()) ? "config" : "account";
    console.log(`  account  ${k.pubkey.toBase58()}  ${role}${k.isSigner ? " · signer" : ""}${k.isWritable ? " · writable" : ""}`);
  }
  console.log(`  data     ${ix.data.toString("hex")} (hex) / ${ix.data.toString("base64")} (base64)`);
  console.log("Approve it to threshold and execute; then `admin.ts status` shows the vault as admin and no pending admin.");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = positional(rest);
  if (!READ_ONLY.has(cmd)) requireMainnetConfirm(`admin ${cmd}`);
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
    case "propose-admin": {
      const next = pubkeyArg(args[0], "propose-admin <pubkey>");
      console.log(`proposed admin: ${explorer(await client.proposeAdmin(next))}`);
      return printAcceptAdmin(client, next);
    }
    case "accept-admin-ix":
      return printAcceptAdmin(client, pubkeyArg(args[0], "accept-admin-ix <pubkey>"));
    case "queue-oracle": {
      const next = pubkeyArg(args[0], "queue-oracle <pubkey>");
      console.log(`queued oracle ${next.toBase58()}: ${explorer(await client.queueOracle(next))}`);
      return console.log("After the 2-day timelock anyone can run `admin.ts execute-oracle`.");
    }
    case "cancel-oracle":
      return console.log(explorer(await client.cancelOracle()));
    case "execute-oracle":
      return console.log(explorer(await client.executeOracle()));
    case "queue-fee-policy": {
      const [platformArg, agentArg, recipientArg] = args;
      const usage = "queue-fee-policy <platformBps> <agentBps> <recipient>";
      const platformFeeBps = Number(platformArg);
      const agentFeeBps = Number(agentArg);
      const recipient = pubkeyArg(recipientArg, usage);
      if (!Number.isInteger(platformFeeBps) || !Number.isInteger(agentFeeBps)) throw new Error(`usage: ${usage}`);
      validateFeePolicy({ platformFeeBps, agentOwnerFeeBps: agentFeeBps, platformRecipient: recipient.toBase58() });
      console.log(explorer(await client.queueFeePolicy(platformFeeBps, agentFeeBps, recipient)));
      return console.log("After the 2-day timelock anyone can run `admin.ts execute-fee-policy`.");
    }
    case "cancel-fee-policy":
      return console.log(explorer(await client.cancelFeePolicy()));
    case "execute-fee-policy":
      return console.log(explorer(await client.executeFeePolicy()));
    default:
      throw new Error(`unknown command ${cmd}`);
  }
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
