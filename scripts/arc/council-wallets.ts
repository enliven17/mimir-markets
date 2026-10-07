/**
 * The council's Arc wallets (Circle developer-controlled, docs/ARC.md):
 *   1. collect the classic ten from CIRCLE_COUNCIL_<SLUG>_WALLET_ID / _ADDRESS
 *   2. create a wallet for every active persona still without one (the philosophers)
 *   3. top up any persona under MIN_USDC from the richest wallet
 *   4. write ARC_COUNCIL_WALLETS (slug → {id, address}) to .env.local; set it in Convex with
 *        npx convex env set ARC_COUNCIL_WALLETS "$(grep ^ARC_COUNCIL_WALLETS= .env.local | cut -d= -f2-)"
 * Idempotent: rerun it any time. Prints addresses and balances only.
 *   npx tsx --env-file=.env.local scripts/arc/council-wallets.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { formatEther, parseEther } from "viem";

import { activePersonas } from "../../agents/council/personas";
import { arcPublicClient } from "../../lib/arc/chain";
import { ARC } from "../../lib/arc/config";
import { createWallets, transferNative, type CouncilWallets } from "../../lib/server/circle-w3s";

const MIN_USDC = 5;
const TOP_UP_USDC = "8";
const BLOCKCHAIN = ARC.network === "mainnet" ? "ARC" : "ARC-TESTNET";
const envKey = (slug: string) => slug.toUpperCase().replace(/-/g, "_");

async function main() {
  const personas = activePersonas();
  const wallets: CouncilWallets = {};
  for (const p of personas) {
    const id = process.env[`CIRCLE_COUNCIL_${envKey(p.slug)}_WALLET_ID`]?.trim();
    const address = process.env[`CIRCLE_COUNCIL_${envKey(p.slug)}_ADDRESS`]?.trim();
    if (id && address) wallets[p.slug] = { id, address: address.toLowerCase() as `0x${string}` };
  }
  try {
    Object.assign(wallets, JSON.parse(process.env.ARC_COUNCIL_WALLETS ?? "{}"));
  } catch {}

  const missing = personas.map((p) => p.slug).filter((s) => !wallets[s]);
  if (missing.length) {
    console.log(`creating ${missing.length} wallets on ${BLOCKCHAIN}: ${missing.join(", ")}`);
    for (const w of await createWallets(missing, BLOCKCHAIN)) wallets[w.refId] = { id: w.id, address: w.address.toLowerCase() as `0x${string}` };
  }

  const client = arcPublicClient();
  const balances = new Map<string, bigint>();
  for (const [slug, w] of Object.entries(wallets)) balances.set(slug, await client.getBalance({ address: w.address }));
  for (const [slug, bal] of balances) {
    if (bal >= parseEther(String(MIN_USDC))) continue;
    const [donor] = [...balances].sort((a, b) => (b[1] > a[1] ? 1 : -1));
    if (!donor || donor[0] === slug || donor[1] < parseEther("20")) {
      console.warn(`${slug}: under ${MIN_USDC} USDC and no wallet can spare ${TOP_UP_USDC}`);
      continue;
    }
    const tx = await transferNative({ walletId: wallets[donor[0]].id, to: wallets[slug].address, amount: TOP_UP_USDC, blockchain: BLOCKCHAIN });
    balances.set(donor[0], donor[1] - parseEther(TOP_UP_USDC));
    balances.set(slug, bal + parseEther(TOP_UP_USDC));
    console.log(`${slug}: +${TOP_UP_USDC} USDC from ${donor[0]} ${tx}`);
  }
  for (const [slug, w] of Object.entries(wallets)) console.log(`${slug.padEnd(16)} ${w.address} ${formatEther(balances.get(slug) ?? 0n)} USDC`);

  const line = `ARC_COUNCIL_WALLETS=${JSON.stringify(wallets)}`;
  const envPath = ".env.local";
  const raw = readFileSync(envPath, "utf8");
  writeFileSync(envPath, /^ARC_COUNCIL_WALLETS=.*$/m.test(raw) ? raw.replace(/^ARC_COUNCIL_WALLETS=.*$/m, line) : `${raw.trimEnd()}\n${line}\n`);
  console.log(`wrote ARC_COUNCIL_WALLETS (${Object.keys(wallets).length} personas) to ${envPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
