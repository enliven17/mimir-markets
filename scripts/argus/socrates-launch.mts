// Launch the council persona Socrates' token on Arc through Argus, from Socrates' own Arc council wallet (Circle
// developer-controlled). Default is a dry run: pin the image, mine the hook salt, eth_call the launch from the wallet
// and print the cost. Nothing is sent unless --send is passed, and --send refuses when the wallet cannot pay the gas.
//
//   ARC_COUNCIL_WALLETS="$(npx convex env get ARC_COUNCIL_WALLETS --deployment hushed-orca-915)" \
//   node --env-file=.env.local --env-file=.env.mainnet.local --import tsx scripts/argus/socrates-launch.mts [--send]
//
// ARC_COUNCIL_WALLETS must be the MAINNET value (the dev deployment's holds testnet wallets). The result goes to
// lib/launch/council.json under socrates.argus; the Solana fields are left alone.
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, formatEther, http, type Address } from "viem";

import { COUNCIL_PERSONAS } from "../../agents/council/personas";
import { ARGUS, decodeLaunch, launchParams } from "../../lib/launch/argus";
import { pinImage, prepareLaunch, simulateLaunch } from "../../lib/launch/argus-chain";
import { DEFAULT_ALLOCATION } from "../../lib/launch/fees";
import { defaultTokenImage } from "../../lib/launch/token-image";
import { executeContract } from "../../lib/server/circle-w3s";

const SLUG = "socrates";
const FILE = "lib/launch/council.json";
const send = process.argv.includes("--send");
const rpc = process.env.ARC_RPC || "https://rpc.mainnet.arc.io";
const client = createPublicClient({ transport: http(rpc) });

const chainId = await client.getChainId();
if (chainId !== 5042) throw new Error(`not Arc mainnet (chain ${chainId})`);
const wallets = JSON.parse(process.env.ARC_COUNCIL_WALLETS ?? "{}") as Record<string, { id: string; address: string }>;
const w = wallets[SLUG];
if (!w) throw new Error("ARC_COUNCIL_WALLETS has no socrates wallet (use the mainnet value)");
const council = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Record<string, unknown>>;
if (council[SLUG]?.arc && String(council[SLUG].arc).toLowerCase() !== w.address.toLowerCase()) throw new Error("ARC_COUNCIL_WALLETS does not match council.json's mainnet Arc wallet: wrong deployment?");
if (council[SLUG]?.argus) throw new Error(`socrates already launched on Argus: ${JSON.stringify(council[SLUG].argus)}`);

const persona = COUNCIL_PERSONAS.find((p) => p.slug === SLUG)!;
const creator = w.address as Address;
const imageURI = await pinImage(await defaultTokenImage(SLUG), "SOCRATES.png");
const params = launchParams({
  name: "Socrates",
  symbol: "SOCRATES",
  description: `Socrates, an AI agent on Mimir's council. ${persona.bio} It stakes on Mimir markets from its own Arc wallet. mimirmarkets.xyz/launch/socrates`,
  imageURI,
  buyTaxBps: 200,
  sellTaxBps: 200,
  split: DEFAULT_ALLOCATION,
  devBuyUsdc6: 0n,
  website: "https://mimirmarkets.xyz/launch/socrates",
  twitter: "https://x.com/Mimir_Markets",
});
const prep = await prepareLaunch(client, creator, `council-${SLUG}`, params);
const sim = await simulateLaunch(client, prep);
const balance = await client.getBalance({ address: creator });
const need = (sim.costWei * 3n) / 2n; // 50% headroom over the estimate

console.log(JSON.stringify({
  creator, walletId: w.id, imageURI,
  params: { ...params.p, totalSupply: String(params.p.totalSupply), startFdvUsdc6: String(params.p.startFdvUsdc6), bondFdvUsdc6: String(params.p.bondFdvUsdc6), devBuyQuote: String(params.p.devBuyQuote) },
  meta: params.meta,
  salt: prep.salt, hookSalt: prep.hookSalt, minedIn: prep.tries,
  predicted: { splitter: prep.splitter, hook: prep.hook, token: prep.token, poolId: prep.poolId },
  simulation: { ok: true, returnedToken: sim.token, gas: String(sim.gas), gasPriceGwei: Number(sim.gasPrice) / 1e9, costUsdc: formatEther(sim.costWei) },
  wallet: { balanceUsdc: formatEther(balance), needUsdcWithHeadroom: formatEther(need), enough: balance >= need },
  calldataBytes: (prep.data.length - 2) / 2,
}, null, 2));
if (sim.token.toLowerCase() !== prep.token.toLowerCase()) throw new Error("simulation returned a different token than predicted");

if (!send) {
  console.log("dry run only: pass --send to launch");
  process.exit(0);
}
if (balance < need) throw new Error(`wallet holds ${formatEther(balance)} USDC, needs ~${formatEther(need)}: fund it first`);
const tx = await executeContract({ walletId: w.id, contractAddress: ARGUS.portal, callData: prep.data });
const receipt = await client.waitForTransactionReceipt({ hash: tx });
if (receipt.status !== "success") throw new Error(`launch reverted: ${tx}`);
const launched = decodeLaunch(receipt.logs);
if (!launched) throw new Error(`launch landed but its events were not found: ${tx}`);
council[SLUG] = { ...council[SLUG], argus: { token: launched.token, poolId: launched.poolId, hook: launched.hook, locker: launched.locker, splitter: launched.splitter, tx, buyTaxBps: 200, sellTaxBps: 200, creatorBps: params.p.creatorBps, burnBps: params.p.burnBps } };
writeFileSync(FILE, `${JSON.stringify(council, null, 2)}\n`);
console.log(`launched $SOCRATES on Argus: ${launched.token} (${tx})`);
