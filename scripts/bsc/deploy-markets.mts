/**
 * Deploy MimirBscFees (with on-chain Binance Agent ID .ai 0% fee), MimirV3Erc20 (VS) and MimirPoolErc20 (pool)
 * on BNB Smart Chain (Testnet 97 or Mainnet 56), and print the exact .env.local, Convex env, and BscScan verify commands.
 *
 * Testnet (with optional MockUsdc18 + MockAgentId for end-to-end testing):
 *   forge build
 *   BSC_DEPLOYER_KEY=0x... ORACLE_ADDRESS=0x... BSC_DEPLOY_MOCKS=1 node --import tsx scripts/bsc/deploy-markets.mts
 *
 * Mainnet (canonical Binance-Peg USDC + Binance Agent ID 0x60b9...022f):
 *   BSC_NETWORK=mainnet BSC_CONFIRM_MAINNET=1 BSC_RPC_URL=https://... BSC_DEPLOYER_KEY=0x... \
 *     BSC_OWNER=0x... BSC_ARBITER=0x... ORACLE_ADDRESS=0x... BSC_FEE_RECIPIENT=0x... BSC_FEE_SIGNER=0x... \
 *     node --import tsx scripts/bsc/deploy-markets.mts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeDeployData,
  getAddress,
  http,
  isAddress,
  parseAbi,
  parseUnits,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";

import { BSC_AGENT_ID_MAINNET } from "../../lib/bsc/agent-id";
import { BSC_USDC } from "../../lib/chains/registry";
import { oracleRole } from "../lib/oracle-role.mjs";

const TESTNET_ID = 97;

const e = process.env;
const root = fileURLToPath(new URL("../../", import.meta.url));
const network = (e.BSC_NETWORK?.trim() || "testnet") as "testnet" | "mainnet";
if (network !== "testnet" && network !== "mainnet") throw new Error("BSC_NETWORK must be testnet or mainnet");
const mainnet = network === "mainnet";
const checkOnly = process.argv.includes("--check-only");
const deployMocks = !mainnet && e.BSC_DEPLOY_MOCKS === "1";

if (mainnet && !checkOnly && e.BSC_CONFIRM_MAINNET !== "1") {
  throw new Error("mainnet deploy: set BSC_CONFIRM_MAINNET=1");
}

const chain = mainnet ? bsc : bscTestnet;
const keyFile = e.BSC_DEPLOYER_KEY_FILE?.trim();
const key = (keyFile ? readFileSync(keyFile, "utf8") : (e.BSC_DEPLOYER_KEY ?? "")).trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("BSC_DEPLOYER_KEY (or BSC_DEPLOYER_KEY_FILE) must be 0x + 64 hex");
const account = privateKeyToAccount(key as Hex);

const role = (name: string, fallback: Address | undefined): Address => {
  const v = e[name]?.trim();
  if (v) {
    if (!isAddress(v, { strict: false })) throw new Error(`${name} is not an address`);
    return getAddress(v);
  }
  if (mainnet) throw new Error(`${name} is required on mainnet`);
  return fallback!;
};

const owner = role("BSC_OWNER", account.address);
const arbiter = role("BSC_ARBITER", owner);
const oracleChoice = oracleRole(e, "BSC_ORACLE");
for (const w of oracleChoice.warnings) console.warn(`warning: ${w}`);
const oracle = oracleChoice.address as Address;
const feeTo = role("BSC_FEE_RECIPIENT", account.address);
const feeSigner = role("BSC_FEE_SIGNER", account.address);

if ([owner, arbiter, feeTo].includes(oracle)) {
  throw new Error("the oracle may not also be the owner, arbiter or fee recipient");
}

const window = BigInt(e.BSC_DISPUTE_WINDOW ?? (mainnet ? 86400 : 3600));
if (window < 0n || window > 7n * 86400n) throw new Error("BSC_DISPUTE_WINDOW must be 0..604800 seconds");
if (chain.id !== TESTNET_ID && window < 86400n) {
  throw new Error("off BSC Testnet the dispute window must be at least 86400 seconds");
}

const minStakeText = (e.BSC_MIN_STAKE ?? "0.1").trim();
if (!/^\d+(\.\d{1,6})?$/.test(minStakeText)) throw new Error("BSC_MIN_STAKE must be USDC like 0.1");
const minStake = parseUnits(minStakeText, 18);
if (minStake < 10n ** 16n || minStake > 100n * 10n ** 18n) {
  throw new Error("BSC_MIN_STAKE must be 0.01 to 100 USDC");
}

const rpcUrl =
  e.BSC_RPC_URL?.trim() ||
  (mainnet ? "https://bsc-dataseed.binance.org" : "https://data-seed-prebsc-1-s1.bnbchain.org:8545");
const transport = http(rpcUrl);
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });

if ((await pub.getChainId()) !== chain.id) throw new Error(`RPC is not ${chain.name} (${chain.id})`);

if (mainnet || e.BSC_STRICT_ROLES === "1") {
  const roles = { owner, arbiter, oracle, feeTo, feeSigner };
  for (const [name, a] of Object.entries(roles)) {
    if (a === account.address) throw new Error(`strict roles: ${name} may not be the deployer key`);
  }
  const distinct: Address[] = [oracle, feeSigner, owner];
  if (e.BSC_ARBITER_IS_OWNER !== "1") distinct.push(arbiter);
  else if (arbiter !== owner) throw new Error("BSC_ARBITER_IS_OWNER=1 but the arbiter differs from the owner");
  if (e.BSC_FEE_TO_IS_OWNER !== "1") distinct.push(feeTo);
  else if (feeTo !== owner) throw new Error("BSC_FEE_TO_IS_OWNER=1 but the fee recipient differs from the owner");
  if (new Set(distinct).size !== distinct.length) {
    throw new Error("strict roles: owner, arbiter, oracle, fee recipient and fee signer must all differ");
  }
  const safeAbi = parseAbi(["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"]);
  for (const [name, a] of [["owner", owner], ["arbiter", arbiter]] as const) {
    const code = await pub.getCode({ address: a });
    if (!code || code === "0x") throw new Error(`strict roles: the ${name} ${a} has no code; deploy the Safe first`);
    const [owners, threshold] = await Promise.all([
      pub.readContract({ address: a, abi: safeAbi, functionName: "getOwners" }),
      pub.readContract({ address: a, abi: safeAbi, functionName: "getThreshold" }),
    ]);
    if (owners.length < 3 || threshold < 2n || threshold > BigInt(owners.length)) {
      throw new Error(`strict roles: ${name} must be a Safe with at least three owners and a threshold of at least two`);
    }
  }
}

type Artifact = { abi: Abi; bytecode: { object: Hex } };
const art = (solFile: string, name = solFile): Artifact =>
  JSON.parse(readFileSync(join(root, `forge-out/${solFile}.sol/${name}.json`), "utf8"));

if (checkOnly) {
  for (const [f, n] of [
    ["MimirBscFees", "MimirBscFees"],
    ["MimirV3Erc20", "MimirV3Erc20"],
    ["MimirPoolErc20", "MimirPoolErc20"],
  ]) {
    if (!art(f, n).bytecode.object) throw new Error(`Missing bytecode for ${n}; run forge build`);
  }
  console.log(`Preflight passed for ${chain.name} (${chain.id}).`);
  process.exit(0);
}

const deploy = async (solFile: string, name: string, args: unknown[]) => {
  const a = art(solFile, name);
  const data = encodeDeployData({ abi: a.abi, bytecode: a.bytecode.object, args });
  const hash = await wallet.sendTransaction({ data });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success" || !rc.contractAddress) throw new Error(`${name} deploy failed ${hash}`);
  const gasBnb = Number(rc.gasUsed * rc.effectiveGasPrice) / 1e18;
  console.log(`  ${name} ${rc.contractAddress} block ${rc.blockNumber} (${gasBnb.toFixed(6)} BNB)`);
  for (let i = 0; !(await pub.getCode({ address: rc.contractAddress })); i++) {
    if (i > 30) throw new Error(`${name} code not visible at ${rc.contractAddress}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { address: getAddress(rc.contractAddress), block: rc.blockNumber, abi: a.abi };
};

const bal = await pub.getBalance({ address: account.address });
console.log(`${chain.name} (${chain.id}): deployer ${account.address} (${(Number(bal) / 1e18).toFixed(5)} BNB)`);
console.log(`  owner ${owner}  arbiter ${arbiter}  oracle ${oracle}  fees to ${feeTo}  fee signer ${feeSigner}`);
console.log(`  window ${window}s  min stake ${minStakeText} USDC (${minStake} wei)`);

let usdc: Address;
let agentIdRegistry: Address;

if (deployMocks) {
  console.log("\nDeploying testnet mocks (MockUsdc18 + MockAgentId)...");
  const mockUsdc = await deploy("BscErc20.t", "MockUsdc18", []);
  const mockAgentId = await deploy("BscErc20.t", "MockAgentId", []);
  usdc = mockUsdc.address;
  agentIdRegistry = mockAgentId.address;
  // Mint 1000 test USDC and grant Agent ID to deployer for immediate testing
  const mintHash = await wallet.writeContract({
    address: usdc,
    abi: mockUsdc.abi,
    functionName: "mint",
    args: [account.address, parseUnits("1000", 18)],
  });
  await pub.waitForTransactionReceipt({ hash: mintHash });
  const grantHash = await wallet.writeContract({
    address: agentIdRegistry,
    abi: mockAgentId.abi,
    functionName: "grant",
    args: [account.address],
  });
  await pub.waitForTransactionReceipt({ hash: grantHash });
  console.log(`  Minted 1000 MockUsdc18 + granted MockAgentId to deployer ${account.address}`);
} else {
  const usdcRaw = e.BSC_USDC_ADDRESS?.trim() || BSC_USDC[network];
  if (!isAddress(usdcRaw, { strict: false })) throw new Error("BSC_USDC_ADDRESS is not an address");
  usdc = getAddress(usdcRaw);
  if (mainnet && usdc !== getAddress(BSC_USDC.mainnet)) {
    throw new Error("Mainnet markets must use canonical Binance-Peg USDC on BSC");
  }
  if ((await pub.getCode({ address: usdc })) === undefined) throw new Error(`no contract at USDC ${usdc}`);
  const dec = await pub.readContract({
    address: usdc,
    abi: [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }],
    functionName: "decimals",
  });
  if (dec !== 18) throw new Error(`USDC ${usdc} reports ${dec} decimals; BSC deployment expects 18`);

  const agentRaw = e.BSC_AGENT_ID_ADDRESS?.trim() || (mainnet ? BSC_AGENT_ID_MAINNET : "");
  agentIdRegistry = agentRaw ? getAddress(agentRaw) : zeroAddress;
  if (agentIdRegistry !== zeroAddress && (await pub.getCode({ address: agentIdRegistry })) === undefined) {
    throw new Error(`no contract at Agent ID registry ${agentIdRegistry}`);
  }
}

console.log(`\nDeploying Mimir contracts (USDC=${usdc}, AgentID=${agentIdRegistry})...`);
const fees = await deploy("MimirBscFees", "MimirBscFees", [owner, feeSigner, agentIdRegistry]);
const v3 = await deploy("MimirV3Erc20", "MimirV3Erc20", [owner, arbiter, oracle, feeTo, fees.address, window, minStake, usdc]);
const pool = await deploy("MimirPoolErc20", "MimirPoolErc20", [owner, arbiter, oracle, feeTo, fees.address, window, minStake, usdc]);

const fromBlock = v3.block < pool.block ? v3.block : pool.block;

console.log("\n=== .env.local (BSC-only, Base & Arc disabled) ===");
console.log(`NEXT_PUBLIC_MARKET_CHAINS=bsc`);
console.log(`NEXT_PUBLIC_DEFAULT_MARKET_CHAIN=bsc`);
console.log(`NEXT_PUBLIC_BSC_NETWORK=${network}`);
console.log(`NEXT_PUBLIC_BSC_RPC=${rpcUrl}`);
console.log(`NEXT_PUBLIC_MIMIR_BSC_V3_ADDRESS=${v3.address}`);
console.log(`NEXT_PUBLIC_MIMIR_BSC_POOL_ADDRESS=${pool.address}`);
console.log(`NEXT_PUBLIC_MIMIR_BSC_FEES_ADDRESS=${fees.address}`);
console.log(`NEXT_PUBLIC_MIMIR_BSC_USDC_ADDRESS=${usdc}`);
console.log(`NEXT_PUBLIC_MIMIR_BSC_FROM_BLOCK=${fromBlock}`);
console.log(`NEXT_PUBLIC_MIMIR_BSC_MIN_STAKE=${minStakeText}`);
if (agentIdRegistry !== zeroAddress) {
  console.log(`NEXT_PUBLIC_BSC_AGENT_ID_ADDRESS=${agentIdRegistry}`);
}

console.log("\n=== Convex env commands ===");
const convexPairs: Array<[string, string]> = [
  ["MARKET_CHAINS", "bsc"],
  ["DEFAULT_MARKET_CHAIN", "bsc"],
  ["BSC_NETWORK", network],
  ["BSC_RPC", rpcUrl],
  ["MIMIR_BSC_V3_ADDRESS", v3.address],
  ["MIMIR_BSC_POOL_ADDRESS", pool.address],
  ["MIMIR_BSC_FEES_ADDRESS", fees.address],
  ["MIMIR_BSC_USDC_ADDRESS", usdc],
  ["MIMIR_BSC_FROM_BLOCK", String(fromBlock)],
  ["MIMIR_BSC_MIN_STAKE", minStakeText],
];
for (const [k, v] of convexPairs) {
  console.log(`npx convex env set ${k} ${v}`);
}

const feesArgs = encodeAbiParameters(
  [{ type: "address" }, { type: "address" }, { type: "address" }],
  [owner, feeSigner, agentIdRegistry],
);
const marketArgs = encodeAbiParameters(
  [
    { type: "address" },
    { type: "address" },
    { type: "address" },
    { type: "address" },
    { type: "address" },
    { type: "uint256" },
    { type: "uint256" },
    { type: "address" },
  ],
  [owner, arbiter, oracle, feeTo, fees.address, window, minStake, usdc],
);

console.log("\n=== Guarded launch caps (recommended before opening to public) ===");
console.log(`# Example: 500 USDC max per market, 50 USDC max per account (18 decimals)`);
console.log(`cast send ${pool.address} "setCaps(uint256,uint256)" 500000000000000000000 50000000000000000000 --rpc-url ${rpcUrl}`);
console.log(`cast send ${v3.address} "setCaps(uint256,uint256)" 500000000000000000000 50000000000000000000 --rpc-url ${rpcUrl}`);

console.log("\n=== BscScan verification commands ===");
console.log(`forge verify-contract --chain-id ${chain.id} --constructor-args ${feesArgs} ${fees.address} contracts/MimirBscFees.sol:MimirBscFees --etherscan-api-key $BSCSCAN_API_KEY`);
console.log(`forge verify-contract --chain-id ${chain.id} --constructor-args ${marketArgs} ${v3.address} contracts/MimirV3Erc20.sol:MimirV3Erc20 --etherscan-api-key $BSCSCAN_API_KEY`);
console.log(`forge verify-contract --chain-id ${chain.id} --constructor-args ${marketArgs} ${pool.address} contracts/MimirPoolErc20.sol:MimirPoolErc20 --etherscan-api-key $BSCSCAN_API_KEY`);
