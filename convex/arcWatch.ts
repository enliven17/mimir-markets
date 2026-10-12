"use node";

// The watchdog: every 5 minutes, look for what needs a human and message the admin Telegram (TELEGRAM_BOT_TOKEN to each
// TELEGRAM_ADMIN_IDS chat; the admin must have sent /start to the bot once). Each problem is sent once per its quiet period.
// Watches: a live proposal that is not our oracle's verdict (a stolen oracle key), a participant's dispute (the Safe must
// rule), a paused contract or a changed/queued role, the oracle and creator running low on USDC, a stopped job, a market
// the oracle keeps failing on. Rules: lib/arc/watch.ts.
import { formatEther, parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { arcPublicClient } from "../lib/arc/chain";
import { arcConfig } from "../lib/arc/config";
import { proposalProblem, roleProblems, type Problem } from "../lib/arc/watch";

const HOUR = 3_600_000;
const MARKET = parseAbi([
  "function owner() view returns (address)",
  "function arbiter() view returns (address)",
  "function oracle() view returns (address)",
  "function paused() view returns (bool)",
  "function feeRecipient() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function pendingOracle() view returns (address)",
  "function pendingFeeRecipient() view returns (address)",
  "function proposals(uint256) view returns (uint8 winnerSide, uint8 confidence, uint64 proposedAt, uint64 disputedAt, address disputer, uint256 bond, bytes32 evidenceHash, string summary)",
  "function getProposal(uint256) view returns (uint8 proposed, uint256 proposedAt, uint256 disputedAt, address disputer, uint256 bond, bytes32 evidenceHash)",
]);
const FEES = parseAbi(["function owner() view returns (address)", "function pendingOwner() view returns (address)", "function pendingSigner() view returns (address)"]);
// How long a job may be silent before it counts as stopped (its cron interval plus slack).
const STALE_MS: Record<string, number> = { "arc-sync": 5 * 60_000, "arc-oracle": 10 * 60_000, "arc-creator": 3 * HOUR };

async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chats = (process.env.TELEGRAM_ADMIN_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!token || !chats.length) return false;
  let ok = false;
  for (const chat_id of chats) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id, text: text.slice(0, 4000), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(15_000),
      });
      ok ||= res.ok;
      if (!res.ok) console.warn(`[watch] telegram ${chat_id}: ${res.status}`);
    } catch (err) {
      console.warn(`[watch] telegram ${chat_id}:`, err instanceof Error ? err.message : err);
    }
  }
  return ok;
}

function creatorAddress(): Address | undefined {
  try {
    return JSON.parse(process.env.ARC_CREATOR_WALLET ?? "null")?.address as Address | undefined;
  } catch {
    return undefined;
  }
}

const utc = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 16).replace("T", " ");

export const tick = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    if (process.env.MIMIR_BACKEND_OFF === "1") return; // this deployment is switched off (crons.ts)
    const e = process.env;
    const cfg = arcConfig({ network: e.ARC_NETWORK, rpcUrl: e.ARC_RPC, mimirV3: e.MIMIR_V3_ADDRESS, mimirPool: e.MIMIR_POOL_ADDRESS });
    const { mimirV3, mimirPool } = cfg.contracts;
    const fees = e.MIMIR_FEES_ADDRESS?.trim() as Address | undefined;
    const key = e.ARC_ORACLE_KEY?.trim();
    if (!mimirV3 || !mimirPool || !key) return;
    const oracle = privateKeyToAccount(key as `0x${string}`).address;
    const client = arcPublicClient(cfg);
    const now = Math.floor(Date.now() / 1000);
    const problems: Problem[] = [];
    const tag = cfg.network === "mainnet" ? "Mimir mainnet" : "Mimir testnet";

    try {
      // 1. Roles and pause on every contract.
      for (const [name, address] of [["MimirV3", mimirV3], ["MimirPool", mimirPool]] as const) {
        const read = (functionName: string) => client.readContract({ address, abi: MARKET, functionName } as never) as Promise<unknown>;
        const [owner, arbiter, orc, paused, feeRecipient, pOwner, pOracle, pFee] = await Promise.all(
          ["owner", "arbiter", "oracle", "paused", "feeRecipient", "pendingOwner", "pendingOracle", "pendingFeeRecipient"].map(read),
        );
        problems.push(
          ...roleProblems(
            {
              name, address, owner: String(owner), arbiter: String(arbiter), oracle: String(orc), paused: Boolean(paused), feeRecipient: String(feeRecipient),
              pending: { owner: String(pOwner), oracle: String(pOracle), "fee recipient": String(pFee) },
            },
            oracle,
          ),
        );
      }
      if (fees) {
        const read = (functionName: string) => client.readContract({ address: fees, abi: FEES, functionName } as never) as Promise<unknown>;
        const [owner, pOwner, pSigner] = await Promise.all(["owner", "pendingOwner", "pendingSigner"].map(read));
        problems.push(...roleProblems({ name: "MimirFees", address: fees, owner: String(owner), pending: { owner: String(pOwner), "fee signer": String(pSigner) } }, oracle));
      }

      // 2. Live proposals: the side on chain must be the verdict our oracle saved (under 3 minutes old: maybe not saved yet, skip).
      const snap = await ctx.runQuery(internal.arcWatchDb.snapshot, { now });
      for (const p of snap.proposed) {
        const [side, proposedAt] =
          p.kind === "vs"
            ? await client.readContract({ address: mimirV3, abi: MARKET, functionName: "proposals", args: [BigInt(p.marketId)] }).then((r) => [Number(r[0]), Number(r[2])])
            : await client.readContract({ address: mimirPool, abi: MARKET, functionName: "getProposal", args: [BigInt(p.marketId)] }).then((r) => [Number(r[0]), Number(r[1])]);
        if (now - proposedAt < 180) continue;
        const problem = proposalProblem(p, side);
        if (problem) problems.push(problem);
      }

      // 3. A participant disputed: the Safe has to rule (resolveDispute) before the refund opens.
      for (const d of snap.disputed.filter((d) => !d.vetoed))
        problems.push({
          key: `dispute:${d.kind}:${d.marketId}`,
          ttlMs: 24 * HOUR,
          text: `⚖️ Dispute on ${d.kind} #${d.marketId} "${d.question.slice(0, 120)}". The Safe must rule (resolveDispute) before ${utc(d.refundAt)} UTC, or everyone is refunded.`,
        });

      // 4. A market the oracle keeps failing on (reported at 6 tries, again at 12).
      for (const s of snap.stuck)
        problems.push({ key: `stuck:${s.kind}:${s.marketId}:${s.attempts >= 12 ? 12 : 6}`, ttlMs: 7 * 24 * HOUR, text: `⚠️ The oracle has failed ${s.attempts}× on ${s.kind} #${s.marketId}: ${s.lastError.slice(0, 300)}` });

      // 5. Stopped jobs.
      for (const [name, stale] of Object.entries(STALE_MS)) {
        const h = snap.heartbeats.find((b) => b.name === name);
        if (h && Date.now() - h.at > stale) problems.push({ key: `stale:${name}`, ttlMs: 2 * HOUR, text: `⚠️ Job ${name} last ran ${Math.round((Date.now() - h.at) / 60_000)} min ago.` });
      }

      // 6. Gas money.
      for (const [who, address, min] of [["Oracle", oracle, 0.5], ["Market creator", creatorAddress(), 0.3]] as const) {
        if (!address) continue;
        const bal = Number(formatEther(await client.getBalance({ address })));
        if (bal < min) problems.push({ key: `low:${address}`, ttlMs: 12 * HOUR, text: `🪫 ${who} ${address} has ${bal.toFixed(3)} USDC (under ${min}). Top it up.` });
      }
    } catch (err) {
      problems.push({ key: "watch-error", ttlMs: HOUR, text: `⚠️ The watchdog could not finish its checks: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}` });
    }

    for (const p of problems) {
      if (!(await ctx.runMutation(internal.arcWatchDb.claim, { key: p.key, ttlMs: p.ttlMs }))) continue;
      const sent = await sendTelegram(`${tag}\n${p.text}`);
      console.log(`[watch] ${sent ? "sent" : "NOT sent (Telegram env missing?)"}: ${p.text}`);
    }
  },
});
