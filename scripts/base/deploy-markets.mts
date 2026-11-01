/**
 * Deploy MimirFees, then MimirV3Erc20 (VS) and MimirPoolErc20 (two-sided) wired to it and to Circle's USDC, on Base
 * (Sepolia or mainnet), and print the env lines for the app. The Base twin of scripts/arc/deploy.mjs: the same roles
 * and checks, read from BASE_* instead of ARC_*. The Arc deployment is untouched.
 *
 *   forge build
 *   BASE_DEPLOYER_KEY=0x… BASE_ORACLE=0x… node --import tsx scripts/base/deploy-markets.mts              # Base Sepolia
 *   BASE_NETWORK=mainnet BASE_CONFIRM_MAINNET=1 BASE_RPC_URL=https://… BASE_DEPLOYER_KEY_FILE=… \
 *     BASE_OWNER=… BASE_ARBITER=… BASE_ORACLE=… BASE_FEE_RECIPIENT=… BASE_FEE_SIGNER=… \
 *     node --import tsx scripts/base/deploy-markets.mts                                                 # Base mainnet
 *
 * Roles (each its own address; set at deploy, nothing is left on the deployer key):
 *   BASE_OWNER          admin: pause, caps, veto, revoke the oracle/signer, timelocked changes (a Safe on mainnet)
 *   BASE_ARBITER        rules disputed and vetoed proposals (a Safe on mainnet; may be the owner's Safe only with
 *                       BASE_ARBITER_IS_OWNER=1)
 *   BASE_ORACLE         the settlement hot key; never owner, arbiter or fee recipient (the contracts refuse it)
 *   BASE_FEE_RECIPIENT  receives entry fees, the copy-trade platform share and forfeited bonds (the owner's Safe as
 *                       the treasury only with BASE_FEE_TO_IS_OWNER=1)
 *   BASE_FEE_SIGNER     MimirFees' ticket signer
 * Other env:
 *   BASE_DEPLOYER_KEY   0x + 64 hex, or BASE_DEPLOYER_KEY_FILE: a file holding it (never a Solana keypair). Pays ETH gas.
 *   BASE_NETWORK        sepolia (default) | mainnet; mainnet also needs BASE_CONFIRM_MAINNET=1
 *   BASE_RPC_URL        default the public endpoint of the network (rate limited)
 *   BASE_USDC_ADDRESS   default Circle's USDC on the network
 *   BASE_DISPUTE_WINDOW seconds; default 86400 on mainnet (the contracts refuse less off Base Sepolia), 3600 on Sepolia
 *   BASE_MIN_STAKE      USDC, default 0.1 (0.01 to 100, fixed at deploy; the dispute bond stays 2 USDC)
 *   BASE_STRICT_ROLES=1 applies the mainnet role checks on Sepolia too (a rehearsal of the mainnet setup)
 *   BASE_BUILDER_CODE   base.dev Builder Code (or its hex suffix): ERC-8021 suffix on the deploy calldata
 * Mainnet refuses to run unless every role is set, none is the deployer, they do not collide, and the owner and
 * arbiter are contracts (the Safe deployed first). Sepolia fills missing roles with the deployer, except the oracle.
 * Amounts are USDC's 6 decimals: caps set later with setCaps(market, account) are raw units too (1 USDC = 1e6).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  getAddress,
  http,
  isAddress,
  parseUnits,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

import { builderSuffixFromEnv, withBuilderSuffix } from "../../lib/base/builder-code";

const USDC = { mainnet: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", sepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" } as const;
const SEPOLIA_ID = 84532; // the only chain besides a local one where the contracts accept a dispute window under a day

const e = process.env;
const root = fileURLToPath(new URL("../../", import.meta.url));
const network = (e.BASE_NETWORK?.trim() || "sepolia") as keyof typeof USDC;
if (!(network in USDC)) throw new Error("BASE_NETWORK must be sepolia or mainnet");
const mainnet = network === "mainnet";
if (mainnet && e.BASE_CONFIRM_MAINNET !== "1") throw new Error("mainnet deploy: set BASE_CONFIRM_MAINNET=1");
const chain = mainnet ? base : baseSepolia;

const keyFile = e.BASE_DEPLOYER_KEY_FILE?.trim();
if (keyFile && /solana|id\.json$/i.test(keyFile)) throw new Error("BASE_DEPLOYER_KEY_FILE must hold an EVM key, not a Solana keypair");
const key = (keyFile ? readFileSync(keyFile, "utf8") : (e.BASE_DEPLOYER_KEY ?? "")).trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("BASE_DEPLOYER_KEY (or BASE_DEPLOYER_KEY_FILE) must be 0x + 64 hex");
const account = privateKeyToAccount(key as Hex);

const usdcRaw = e.BASE_USDC_ADDRESS?.trim() || USDC[network];
if (!isAddress(usdcRaw, { strict: false })) throw new Error("BASE_USDC_ADDRESS is not an address");
const usdc = getAddress(usdcRaw);
const suffix = builderSuffixFromEnv(e.BASE_BUILDER_CODE);
if (e.BASE_BUILDER_CODE?.trim() && !suffix) throw new Error("BASE_BUILDER_CODE is not a valid code or ERC-8021 suffix");

const role = (name: string, fallback: Address | undefined): Address | undefined => {
  const v = e[name]?.trim();
  if (v) {
    if (!isAddress(v, { strict: false })) throw new Error(`${name} is not an address`);
    return getAddress(v);
  }
  if (mainnet) throw new Error(`${name} is required on mainnet`);
  return fallback;
};
const owner = role("BASE_OWNER", account.address)!;
const arbiter = role("BASE_ARBITER", owner)!;
const oracle = role("BASE_ORACLE", undefined);
if (!oracle) throw new Error("BASE_ORACLE is required (the oracle key may not be the owner, so it cannot default to the deployer)");
const feeTo = role("BASE_FEE_RECIPIENT", account.address)!;
const feeSigner = role("BASE_FEE_SIGNER", account.address)!;

const window = BigInt(e.BASE_DISPUTE_WINDOW ?? (mainnet ? 86400 : 3600));
if (window < 0n || window > 7n * 86400n) throw new Error("BASE_DISPUTE_WINDOW must be 0..604800 seconds");
if (chain.id !== SEPOLIA_ID && window < 86400n) throw new Error("off Base Sepolia the dispute window must be at least 86400 seconds");
const minStakeText = (e.BASE_MIN_STAKE ?? "0.1").trim();
if (!/^\d+(\.\d{1,6})?$/.test(minStakeText)) throw new Error("BASE_MIN_STAKE must be USDC like 0.1 (at most 6 decimals)");
const minStake = parseUnits(minStakeText, 6);
if (minStake < 10_000n || minStake > 100_000_000n) throw new Error("BASE_MIN_STAKE must be 0.01 to 100 USDC");

if ([owner, arbiter, feeTo].includes(oracle)) throw new Error("the oracle may not also be the owner, arbiter or fee recipient");

const transport = http(e.BASE_RPC_URL?.trim() || chain.rpcUrls.default.http[0]);
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });
if ((await pub.getChainId()) !== chain.id) throw new Error(`RPC is not ${chain.name} (${chain.id})`);
if ((await pub.getCode({ address: usdc })) === undefined) throw new Error(`no contract at USDC ${usdc} on ${chain.name}`);
const decimals = await pub.readContract({
  address: usdc,
  abi: [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }],
  functionName: "decimals",
});
if (decimals !== 6) throw new Error(`USDC ${usdc} reports ${decimals} decimals; the contracts' constants assume 6`);

if (mainnet || e.BASE_STRICT_ROLES === "1") {
  const roles = { owner, arbiter, oracle, feeTo, feeSigner };
  for (const [name, a] of Object.entries(roles)) {
    if (a === account.address) throw new Error(`strict roles: ${name} may not be the deployer key`);
  }
  const distinct: Address[] = [oracle, feeSigner, owner];
  if (e.BASE_ARBITER_IS_OWNER !== "1") distinct.push(arbiter);
  else if (arbiter !== owner) throw new Error("BASE_ARBITER_IS_OWNER=1 but the arbiter differs from the owner");
  if (e.BASE_FEE_TO_IS_OWNER !== "1") distinct.push(feeTo);
  else if (feeTo !== owner) throw new Error("BASE_FEE_TO_IS_OWNER=1 but the fee recipient differs from the owner");
  if (new Set(distinct).size !== distinct.length) throw new Error("strict roles: owner, arbiter, oracle, fee recipient and fee signer must all differ");
  for (const [name, a] of [["owner", owner], ["arbiter", arbiter]] as const) {
    const code = await pub.getCode({ address: a });
    if (!code || code === "0x") throw new Error(`strict roles: the ${name} ${a} has no code; deploy the Safe first`);
  }
}

const bal = await pub.getBalance({ address: account.address });
console.log(`${chain.name}: deployer ${account.address} (${Number(bal) / 1e18} ETH), USDC ${usdc}, builder code ${suffix ? "on" : "off"}
  owner ${owner}  arbiter ${arbiter}  oracle ${oracle}  fees to ${feeTo}  fee signer ${feeSigner}
  window ${window}s  min stake ${minStakeText} USDC (${minStake} units)`);

type Artifact = { abi: Abi; bytecode: { object: Hex } };
const art = (n: string): Artifact => JSON.parse(readFileSync(join(root, `forge-out/${n}.sol/${n}.json`), "utf8"));

const deploy = async (name: string, args: unknown[]) => {
  const a = art(name);
  // ERC-8021: the suffix trails the init code; the constructor decodes its arguments and ignores the rest.
  const data = withBuilderSuffix(encodeDeployData({ abi: a.abi, bytecode: a.bytecode.object, args }), suffix);
  const hash = await wallet.sendTransaction({ data });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success" || !rc.contractAddress) throw new Error(`${name} deploy failed ${hash}`);
  console.log(`  ${name} ${rc.contractAddress} block ${rc.blockNumber} (${Number(rc.gasUsed * rc.effectiveGasPrice) / 1e18} ETH)`);
  return { address: getAddress(rc.contractAddress), block: rc.blockNumber, abi: a.abi };
};

const fees = await deploy("MimirFees", [owner, feeSigner]);
const v3 = await deploy("MimirV3Erc20", [owner, arbiter, oracle, feeTo, fees.address, window, minStake, usdc]);
const pool = await deploy("MimirPoolErc20", [owner, arbiter, oracle, feeTo, fees.address, window, minStake, usdc]);

// Read back what the market contracts were built with.
for (const c of [v3, pool]) {
  const [u, f, m] = await Promise.all(
    (["usdc", "fees", "MIN_STAKE"] as const).map((fn) => pub.readContract({ address: c.address, abi: c.abi, functionName: fn })),
  );
  if (getAddress(u as string) !== usdc || getAddress(f as string) !== fees.address || m !== minStake) {
    throw new Error(`${c.address} reads usdc ${u}, fees ${f}, min stake ${m}: not what was deployed`);
  }
}

console.log(`
  ${chain.blockExplorers?.default.url}/address/${v3.address}

NEXT_PUBLIC_MIMIR_BASE_FEES_ADDRESS=${fees.address}
NEXT_PUBLIC_MIMIR_BASE_V3_ADDRESS=${v3.address}
NEXT_PUBLIC_MIMIR_BASE_POOL_ADDRESS=${pool.address}
NEXT_PUBLIC_MIMIR_BASE_USDC_ADDRESS=${usdc}
NEXT_PUBLIC_MIMIR_BASE_FROM_BLOCK=${fees.block}
NEXT_PUBLIC_MIMIR_BASE_MIN_STAKE=${minStakeText}`);
