/** Deploy the existing ERC-20 MimirAgentPay on Arc. No owner or custody.
 * forge build
 * ARC_DEPLOYER_KEY_FILE=... node --import tsx scripts/arc/deploy-agent-pay.mts
 * Mainnet also requires ARC_NETWORK=mainnet ARC_CONFIRM_MAINNET=1 ARC_RPC=...
 * Prints ARC_AGENT_PAY_ADDRESS for BOTH the web server and Convex; never configures or deploys automatically.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, getAddress, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcChain, arcTransport } from "../../lib/arc/chain";
import { arcConfig } from "../../lib/arc/config";

const e = process.env;
const network = e.ARC_NETWORK?.trim() || "testnet";
if (network !== "testnet" && network !== "mainnet") throw Error("ARC_NETWORK must be testnet or mainnet");
if (network === "mainnet" && e.ARC_CONFIRM_MAINNET !== "1") throw Error("mainnet deploy: set ARC_CONFIRM_MAINNET=1");
const cfg = arcConfig({ network, rpcUrl: e.ARC_RPC });
const chain = arcChain(cfg);
const key = (e.ARC_DEPLOYER_KEY_FILE?.trim() ? readFileSync(e.ARC_DEPLOYER_KEY_FILE.trim(), "utf8") : e.ARC_DEPLOYER_KEY ?? "").trim();
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw Error("ARC_DEPLOYER_KEY or ARC_DEPLOYER_KEY_FILE must hold an EVM private key");
const account = privateKeyToAccount(key as Hex);
const pub = createPublicClient({ chain, transport: arcTransport(cfg) });
const wallet = createWalletClient({ account, chain, transport: arcTransport(cfg) });
if (await pub.getChainId() !== chain.id) throw Error(`RPC is not ${chain.name} (${chain.id})`);
const code = await pub.getCode({ address: cfg.usdc });
if (!code || code === "0x") throw Error("Arc USDC has no bytecode: this MimirAgentPay constructor is incompatible; do not deploy");
const decimals = await pub.readContract({ address: cfg.usdc, abi: parseAbi(["function decimals() view returns (uint8)"]), functionName: "decimals" });
if (decimals !== 6) throw Error("Arc payment contract requires the 6-decimal ERC-20 USDC interface");
const root = fileURLToPath(new URL("../../", import.meta.url));
const art = JSON.parse(readFileSync(join(root, "forge-out/MimirAgentPay.sol/MimirAgentPay.json"), "utf8"));
console.log(`${chain.name}: deployer ${account.address}, ERC-20 USDC ${cfg.usdc}`);
const hash = await wallet.deployContract({ abi: art.abi, bytecode: art.bytecode.object, args: [cfg.usdc] });
const rc = await pub.waitForTransactionReceipt({ hash });
if (rc.status !== "success" || !rc.contractAddress) throw Error(`deploy failed ${hash}`);
const actual = await pub.readContract({ address: rc.contractAddress, abi: art.abi, functionName: "usdc" });
if (getAddress(actual as string) !== getAddress(cfg.usdc)) throw Error("Deployed payment contract has unexpected USDC address");
console.log(`MimirAgentPay ${rc.contractAddress}, block ${rc.blockNumber}, tx ${hash}\nARC_AGENT_PAY_ADDRESS=${getAddress(rc.contractAddress)}`);
