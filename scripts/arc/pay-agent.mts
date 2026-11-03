/** Pay a private-commitment API quote on Arc using ERC-20 USDC (6 dp), never native value.
 * ARC_PAYER_KEY=... ARC_NETWORK=mainnet ARC_RPC=... node --import tsx scripts/arc/pay-agent.mts <agent-slug>
 * Testnet smoke: ARC_PAYER_KEY=... ARC_AGENT_PAY_ADDRESS=... node --import tsx scripts/arc/pay-agent.mts <0xagent> <units>
 * Prints the private redemption header: do not publish it. No Base builder suffix on Arc.
 */
import { randomBytes } from "node:crypto";
import { createPublicClient, createWalletClient, encodeFunctionData, getAddress, isAddress, parseAbi, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcChain, arcTransport } from "../../lib/arc/chain";
import { arcConfig } from "../../lib/arc/config";
import { arcAgentPay, callIdFor } from "../../lib/launch/paid-call";

const e = process.env;
const network = e.ARC_NETWORK?.trim() || "testnet";
if (network !== "testnet" && network !== "mainnet") throw Error("ARC_NETWORK must be testnet or mainnet");
const cfg = arcConfig({ network, rpcUrl: e.ARC_RPC });
const chain = arcChain(cfg);
const key = e.ARC_PAYER_KEY?.trim() ?? "";
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw Error("ARC_PAYER_KEY must be an EVM private key");
const account = privateKeyToAccount(key as Hex);
const [target, unitsArg] = process.argv.slice(2);
if (!target) throw Error("usage: pay-agent.mts <agent-slug> | <0xagent> <units>");
let contract: Hex, agent: Hex, units: bigint, secret: Hex, callId: Hex;
if (isAddress(target, { strict: false })) {
  const configured = arcAgentPay();
  if (!configured || !/^\d+$/.test(unitsArg ?? "")) throw Error("ARC_AGENT_PAY_ADDRESS and <units> are required");
  secret = toHex(randomBytes(32));
  [contract, agent, units, callId] = [configured, getAddress(target), BigInt(unitsArg), callIdFor(secret)];
} else {
  if (network !== "mainnet") throw Error("API quotes are mainnet-only; use an explicit agent address for testnet smoke tests");
  const url = `${(e.MIMIR_URL?.trim() || "https://mimirmarkets.xyz").replace(/\/$/, "")}/api/launch/${encodeURIComponent(target)}/call`;
  const q = await (await fetch(url)).json() as { accepts?: Array<{ chain: string; payTo: string; agent?: string; units: string; callId?: string; secret?: string }> };
  const o = q.accepts?.find(o => o.chain === "arc");
  if (!o?.agent || !o.callId || !o.secret || !/^0x[0-9a-fA-F]{64}$/.test(o.secret)) throw Error("No Arc commitment offer");
  if (callIdFor(o.secret) !== o.callId) throw Error("Quote callId does not hash from its secret");
  [contract, agent, units, callId, secret] = [getAddress(o.payTo), getAddress(o.agent), BigInt(o.units), o.callId as Hex, o.secret as Hex];
}
if (units <= 0n) throw Error("Payment must be positive, in 6-decimal USDC units");
const pub = createPublicClient({ chain, transport: arcTransport(cfg) });
const wallet = createWalletClient({ account, chain, transport: arcTransport(cfg) });
if (await pub.getChainId() !== chain.id) throw Error(`RPC is not ${chain.name} (${chain.id})`);
const PAY = parseAbi(["function usdc() view returns (address)", "function pay(address,uint256,bytes32)"]);
const TOKEN = parseAbi(["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const usdc = await pub.readContract({ address: contract, abi: PAY, functionName: "usdc" });
if (getAddress(usdc) !== getAddress(cfg.usdc)) throw Error("Payment contract uses a different token");
const send = async (to: Hex, data: Hex) => {
  const hash = await wallet.sendTransaction({ to, data });
  if ((await pub.waitForTransactionReceipt({ hash })).status !== "success") throw Error(`transaction failed ${hash}`);
  return hash;
};
if (await pub.readContract({ address: usdc, abi: TOKEN, functionName: "allowance", args: [account.address, contract] }) < units) {
  console.log(`approve ${await send(usdc, encodeFunctionData({ abi: TOKEN, functionName: "approve", args: [contract, units] }))}`);
}
const tx = await send(contract, encodeFunctionData({ abi: PAY, functionName: "pay", args: [agent, units, callId] }));
console.log(`X-Mimir-Payment: arc:${tx}:${secret}`);
