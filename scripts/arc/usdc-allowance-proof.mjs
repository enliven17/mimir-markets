// Proof on Arc TESTNET that the USDC ERC-20 interface (0x3600…, 6 dp) moves the NATIVE balance (18 dp):
// owner approves a spender, the spender pulls with transferFrom, both native balances change.
// Keys: the testnet-rehearsal file (never funded on mainnet). Usage: node scripts/arc-poc/_allowance-proof.mjs <keys file>
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, erc20Abi, formatEther, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const file = readFileSync(process.argv[2], "utf8");
const keyAfter = (label) => {
  const block = file.slice(file.indexOf(`== ${label} ==`));
  const k = /Private key:\s*(0x)?([0-9a-fA-F]{64})/.exec(block)[2];
  return privateKeyToAccount(`0x${k}`);
};
const arcTestnet = defineChain({ id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } } });
const pub = createPublicClient({ chain: arcTestnet, transport: http() });
const chainId = await pub.getChainId();
const chain = { ...arcTestnet, id: chainId };
const USDC = "0x3600000000000000000000000000000000000000";
const owner = keyAfter("DEPLOYER"), spender = keyAfter("ORACLE");
const ow = createWalletClient({ account: owner, chain, transport: http("https://rpc.testnet.arc.network") });
const sp = createWalletClient({ account: spender, chain, transport: http("https://rpc.testnet.arc.network") });
const AMOUNT = 50_000n; // 0.05 USDC in 6 dp

const bal = async () => [await pub.getBalance({ address: owner.address }), await pub.getBalance({ address: spender.address })];
const [o0, s0] = await bal();
console.log("chain", chainId, "| owner", formatEther(o0), "| spender", formatEther(s0));
const decimals = await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "decimals" });
console.log("interface decimals", decimals, "| owner balanceOf", (await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner.address] })).toString());

const a = await ow.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [spender.address, AMOUNT] });
const ar = await pub.waitForTransactionReceipt({ hash: a });
console.log("approve", ar.status, a, "allowance", (await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [owner.address, spender.address] })).toString());

const [o1, s1] = await bal();
const t = await sp.writeContract({ address: USDC, abi: erc20Abi, functionName: "transferFrom", args: [owner.address, spender.address, AMOUNT] });
const tr = await pub.waitForTransactionReceipt({ hash: t });
const [o2, s2] = await bal();
const gas = tr.gasUsed * tr.effectiveGasPrice;
console.log("transferFrom", tr.status, t);
console.log("owner native Δ", formatEther(o2 - o1), "(expect -0.05)");
console.log("spender native Δ + gas", formatEther(s2 - s1 + gas), "(expect +0.05)");
console.log("allowance left", (await pub.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [owner.address, spender.address] })).toString());
