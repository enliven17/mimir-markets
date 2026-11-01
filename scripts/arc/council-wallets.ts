/**
 * The council's wallets on a market chain (Circle developer-controlled, docs/CHAINS.md). Arc by default; with
 * `--chain base` the Base wallets (BASE / BASE-SEPOLIA) and BASE_COUNCIL_WALLETS instead. On Base the script creates
 * and lists the wallets but does not top them up: Mimir funds each with USDC and a little ETH for gas by hand.
 * On Arc it does:
 *   1. collect the classic ten from CIRCLE_COUNCIL_<SLUG>_WALLET_ID / _ADDRESS
 *   2. create a wallet for every active persona still without one (the philosophers)
 *   3. top up any persona under MIN_USDC from the richest wallet
 *   4. write ARC_COUNCIL_WALLETS (slug → {id, address}) to .env.local; set it in Convex with
 *        npx convex env set ARC_COUNCIL_WALLETS "$(grep ^ARC_COUNCIL_WALLETS= .env.local | cut -d= -f2-)"
 * Idempotent: rerun it any time. Prints addresses and balances only.
 *   npx tsx --env-file=.env.local scripts/arc/council-wallets.ts [--chain base]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { formatEther, parseEther } from "viem";

import { activePersonas } from "../../agents/council/personas";
import { arcPublicClient } from "../../lib/arc/chain";
import { ARC } from "../../lib/arc/config";
import { createWallets, transferNative, type CouncilWallets } from "../../lib/server/circle-w3s";
import { indexToUsd } from "../../lib/chains/amounts";
import { gasBalanceWei, usdcBalanceWei } from "../../lib/chains/client";
import { circleBlockchain } from "../../lib/chains/house";
import { MARKET_CHAINS } from "../../lib/chains/registry";

const MIN_USDC = 5;
const TOP_UP_USDC = "8";
const ON_BASE = process.argv.includes("--chain") && process.argv[process.argv.indexOf("--chain") + 1] === "base";
const BLOCKCHAIN = ON_BASE ? circleBlockchain("base", MARKET_CHAINS.chains.base.network) : ARC.network === "mainnet" ? "ARC" : "ARC-TESTNET";
const ENV_NAME = ON_BASE ? "BASE_COUNCIL_WALLETS" : "ARC_COUNCIL_WALLETS";
const envKey = (slug: string) => slug.toUpperCase().replace(/-/g, "_");

async function main() {
  const personas = activePersonas();
  const wallets: CouncilWallets = {};
  if (ON_BASE) {
    try {
      Object.assign(wallets, JSON.parse(process.env.BASE_COUNCIL_WALLETS ?? "{}"));
    } catch {}
    const missing = personas.map((p) => p.slug).filter((s) => !wallets[s]);
    if (missing.length) {
      console.log(`creating ${missing.length} wallets on ${BLOCKCHAIN}: ${missing.join(", ")}`);
      for (const w of await createWallets(missing, BLOCKCHAIN)) wallets[w.refId] = { id: w.id, address: w.address.toLowerCase() as `0x${string}` };
    }
    const base = MARKET_CHAINS.chains.base;
    for (const [slug, w] of Object.entries(wallets)) {
      const [usdc, eth] = await Promise.all([usdcBalanceWei(base, w.address).catch(() => 0n), gasBalanceWei(base, w.address).catch(() => 0n)]);
      console.log(`${slug.padEnd(16)} ${w.address} ${indexToUsd(usdc).toFixed(2)} USDC ${formatEther(eth)} ETH${eth === 0n ? "  <- needs ETH for gas" : ""}`);
    }
    return writeEnv(wallets);
  }
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

  writeEnv(wallets);
}

function writeEnv(wallets: CouncilWallets) {
  const line = `${ENV_NAME}=${JSON.stringify(wallets)}`;
  const envPath = ".env.local";
  const raw = readFileSync(envPath, "utf8");
  const re = new RegExp(`^${ENV_NAME}=.*$`, "m");
  writeFileSync(envPath, re.test(raw) ? raw.replace(re, line) : `${raw.trimEnd()}\n${line}\n`);
  console.log(`wrote ${ENV_NAME} (${Object.keys(wallets).length} personas) to ${envPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
