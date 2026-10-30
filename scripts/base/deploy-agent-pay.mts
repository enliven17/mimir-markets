/**
 * Deploy contracts/MimirAgentPay.sol (pay an agent for one Mimir API call in USDC) on Base, and print the env line
 * lib/launch/paid-call.ts reads. The contract has no owner and no settings: the deployer key only pays the gas.
 *
 *   forge build
 *   BASE_DEPLOYER_KEY=0x… node --import tsx scripts/base/deploy-agent-pay.mts                       # Base Sepolia
 *   BASE_NETWORK=mainnet BASE_CONFIRM_MAINNET=1 BASE_RPC_URL=https://… BASE_DEPLOYER_KEY_FILE=… \
 *     node --import tsx scripts/base/deploy-agent-pay.mts                                           # Base mainnet
 *
 * Env:
 *   BASE_DEPLOYER_KEY       0x + 64 hex, or BASE_DEPLOYER_KEY_FILE: a file holding it (never a Solana keypair)
 *   BASE_NETWORK            sepolia (default) | mainnet; mainnet also needs BASE_CONFIRM_MAINNET=1
 *   BASE_RPC_URL            default the public endpoint of the network (rate limited)
 *   BASE_USDC_ADDRESS       default Circle's USDC on the network
 *   BASE_BUILDER_CODE       base.dev Builder Code (or its hex suffix): ERC-8021 suffix on the deploy calldata
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, encodeDeployData, getAddress, http, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

import { builderSuffixFromEnv, withBuilderSuffix } from "../../lib/base/builder-code";

const USDC = { mainnet: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", sepolia: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" } as const;

const e = process.env;
const root = fileURLToPath(new URL("../../", import.meta.url));
const network = (e.BASE_NETWORK?.trim() || "sepolia") as keyof typeof USDC;
if (!(network in USDC)) throw new Error("BASE_NETWORK must be sepolia or mainnet");
if (network === "mainnet" && e.BASE_CONFIRM_MAINNET !== "1") throw new Error("mainnet deploy: set BASE_CONFIRM_MAINNET=1");
const chain = network === "mainnet" ? base : baseSepolia;

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

const transport = http(e.BASE_RPC_URL?.trim() || chain.rpcUrls.default.http[0]);
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });
if ((await pub.getChainId()) !== chain.id) throw new Error(`RPC is not ${chain.name} (${chain.id})`);
if ((await pub.getCode({ address: usdc })) === undefined) throw new Error(`no contract at USDC ${usdc} on ${chain.name}`);

const art = JSON.parse(readFileSync(join(root, "forge-out/MimirAgentPay.sol/MimirAgentPay.json"), "utf8"));
// ERC-8021: the suffix trails the init code; the constructor decodes its one argument and ignores the rest.
const data = withBuilderSuffix(encodeDeployData({ abi: art.abi, bytecode: art.bytecode.object, args: [usdc] }), suffix);

const bal = await pub.getBalance({ address: account.address });
console.log(`${chain.name}: deployer ${account.address} (${Number(bal) / 1e18} ETH), USDC ${usdc}, builder code ${suffix ? "on" : "off"}`);
const hash = await wallet.sendTransaction({ data });
const rc = await pub.waitForTransactionReceipt({ hash });
if (rc.status !== "success" || !rc.contractAddress) throw new Error(`deploy failed ${hash}`);
const read = await pub.readContract({ address: rc.contractAddress, abi: art.abi, functionName: "usdc" });
if (getAddress(read as string) !== usdc) throw new Error(`deployed contract reads usdc ${read}, expected ${usdc}`);

console.log(`  MimirAgentPay ${rc.contractAddress} block ${rc.blockNumber} tx ${hash} (${Number(rc.gasUsed * rc.effectiveGasPrice) / 1e18} ETH)
  ${chain.blockExplorers?.default.url}/address/${rc.contractAddress}

BASE_AGENT_PAY_ADDRESS=${getAddress(rc.contractAddress)}`);
