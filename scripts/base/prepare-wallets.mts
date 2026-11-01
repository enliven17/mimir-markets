/** Creates/validates Base mainnet Circle wallets; never transfers funds or changes .env.local. */
import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { activePersonas } from "../../agents/council/personas";
import { createWallets, type CouncilWallets } from "../../lib/server/circle-w3s";

const output = process.argv[process.argv.indexOf("--output") + 1];
if (!process.argv.includes("--output") || !output || !output.endsWith(".env")) throw new Error("--output <ignored mainnet .env file> is required");
if (process.env.BASE_NETWORK !== "mainnet" || !process.env.CIRCLE_API_KEY?.startsWith("LIVE_API_KEY:")) throw new Error("Base mainnet + Circle LIVE credentials required");
const env = parseEnv(readFileSync(output, "utf8"));
const council = JSON.parse(env.BASE_COUNCIL_WALLETS || "{}") as CouncilWallets;
let creator = env.BASE_CREATOR_WALLET ? JSON.parse(env.BASE_CREATOR_WALLET) as { id: string; address: string } : null;
const save = () => {
  env.BASE_COUNCIL_WALLETS = JSON.stringify(council);
  if (creator) env.BASE_CREATOR_WALLET = JSON.stringify(creator);
  writeFileSync(output, Object.entries(env).map(([k, v]) => `${k}='${v.replaceAll("'", "\\'")}'`).join("\n") + "\n");
};
// Recheck every persisted wallet: a Sepolia ID/address must never be reused as mainnet.
async function validate(id: string, address: string) {
  const response = await fetch(`https://api.circle.com/v1/w3s/wallets/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${process.env.CIRCLE_API_KEY}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("Cannot verify Circle mainnet wallet");
  const body = await response.json();
  const wallet = body.data?.wallet;
  if (wallet?.blockchain !== "BASE" || wallet.address.toLowerCase() !== address.toLowerCase()) throw new Error("Circle wallet is not on Base mainnet");
}
for (const wallet of Object.values(council)) await validate(wallet.id, wallet.address);
if (creator) await validate(creator.id, creator.address);
for (const persona of activePersonas()) {
  if (council[persona.slug]) continue;
  const [wallet] = await createWallets([persona.slug], "BASE", "mimir-base-mainnet-council");
  council[persona.slug] = { id: wallet.id, address: wallet.address };
  save();
}
if (!creator) {
  const [wallet] = await createWallets(["house"], "BASE", "mimir-base-mainnet-creator");
  creator = { id: wallet.id, address: wallet.address };
  save();
}
console.log(JSON.stringify({ blockchain: "BASE", councilCount: Object.keys(council).length, creator: creator.address, fundingSent: false, output }));
