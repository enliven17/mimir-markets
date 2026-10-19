/**
 * Mimir Launch: give every council persona a Robinhood Chain wallet next to its Solana and Arc ones (Privy, chain_type
 * ethereum, policy-locked by lib/launch/robinhood/policy.ts: it may trade on Pons and Uniswap and send ETH only to
 * COUNCIL_RH_PAYOUT). Wallets only: nothing is funded or launched here. The public record goes to lib/launch/council.json.
 *
 *   COUNCIL_RH_PAYOUT=0x… node --env-file=.env.local --import tsx scripts/launch/council-robinhood.mts [slug ...]
 *
 * Env: PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_AUTHORIZATION_KEY (the same app the mainnet backend uses).
 * Idempotent: a persona that already has a Robinhood wallet is skipped.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { getAddress, isAddress } from "viem";

import { robinhoodAgentPolicy } from "../../lib/launch/robinhood/policy";
import { createPrivy } from "../../lib/launch/solana/privy";

const FILE = "lib/launch/council.json";
const e = process.env;
const payoutRaw = e.COUNCIL_RH_PAYOUT?.trim() ?? "";
if (!isAddress(payoutRaw)) throw new Error("COUNCIL_RH_PAYOUT must be a 0x address");
const payout = getAddress(payoutRaw);
const privy = createPrivy({ appId: e.PRIVY_APP_ID ?? "", appSecret: e.PRIVY_APP_SECRET ?? "", authKey: e.PRIVY_AUTHORIZATION_KEY || undefined });

const record = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, { name: string; robinhood?: { walletId: string; address: string; payout: string } }>;
const only = new Set(process.argv.slice(2));
for (const [slug, entry] of Object.entries(record)) {
  if (only.size && !only.has(slug)) continue;
  if (entry.robinhood) {
    console.log(`${slug}: has ${entry.robinhood.address}`);
    continue;
  }
  const w = await privy.createWalletWithPolicy((address) => robinhoodAgentPolicy(address, payout, null), "ethereum");
  entry.robinhood = { walletId: w.id, address: getAddress(w.address), payout };
  // Saved after every wallet, so a failure part-way loses nothing already made.
  writeFileSync(FILE, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`${slug}: ${entry.robinhood.address}`);
}
