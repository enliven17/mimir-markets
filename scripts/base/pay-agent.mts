/**
 * Pay a Mimir agent for one API call on Base through MimirAgentPay (approve if needed, then pay), with the Builder
 * Code suffix on both txs, and print the X-Mimir-Payment header. A smoke test for a fresh deploy.
 *
 *   BASE_PAYER_KEY=0x… node --import tsx scripts/base/pay-agent.mts <agent-slug>            # quote from MIMIR_URL
 *   BASE_PAYER_KEY=0x… BASE_AGENT_PAY_ADDRESS=0x… node --import tsx scripts/base/pay-agent.mts <0xagent> <units>
 *
 * Env: BASE_PAYER_KEY (0x + 64 hex), BASE_NETWORK sepolia|mainnet (default mainnet here: the API quotes mainnet),
 * BASE_RPC_URL, BASE_BUILDER_CODE, MIMIR_URL (default https://mimirmarkets.xyz).
 */
import { randomBytes } from "node:crypto";
import { createPublicClient, createWalletClient, encodeFunctionData, getAddress, http, isAddress, parseAbi, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

import { builderSuffixFromEnv, withBuilderSuffix } from "../../lib/base/builder-code";

const PAY_ABI = parseAbi(["function pay(address agent, uint256 amount, bytes32 callId)", "function usdc() view returns (address)"]);
const ERC20 = parseAbi(["function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);

const e = process.env;
const chain = e.BASE_NETWORK?.trim() === "sepolia" ? baseSepolia : base;
const key = e.BASE_PAYER_KEY?.trim() ?? "";
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("BASE_PAYER_KEY must be 0x + 64 hex");
const account = privateKeyToAccount(key as Hex);
const suffix = builderSuffixFromEnv(e.BASE_BUILDER_CODE);

const [target, unitsArg] = process.argv.slice(2);
if (!target) throw new Error("usage: pay-agent.mts <agent-slug> | <0xagent> <units>");
let contract: `0x${string}`, agent: `0x${string}`, units: bigint, callId: Hex;
if (isAddress(target, { strict: false })) {
  const c = e.BASE_AGENT_PAY_ADDRESS?.trim() ?? "";
  if (!isAddress(c, { strict: false }) || !/^\d+$/.test(unitsArg ?? "")) throw new Error("with an agent address: BASE_AGENT_PAY_ADDRESS and <units> are required");
  [contract, agent, units, callId] = [getAddress(c), getAddress(target), BigInt(unitsArg), toHex(randomBytes(32))];
} else {
  const url = `${(e.MIMIR_URL?.trim() || "https://mimirmarkets.xyz").replace(/\/$/, "")}/api/launch/${encodeURIComponent(target)}/call`;
  const q = (await (await fetch(url)).json()) as { accepts?: Array<{ chain: string; payTo: string; agent?: string; units: string; callId?: string }>; error?: string };
  const o = q.accepts?.find((x) => x.chain === "base");
  if (!o?.agent || !o.callId) throw new Error(`no Base offer from ${url}${q.error ? `: ${q.error}` : ""}`);
  [contract, agent, units, callId] = [getAddress(o.payTo), getAddress(o.agent), BigInt(o.units), o.callId as Hex];
}

const transport = http(e.BASE_RPC_URL?.trim() || chain.rpcUrls.default.http[0]);
const pub = createPublicClient({ chain, transport });
const wallet = createWalletClient({ account, chain, transport });
const usdc = await pub.readContract({ address: contract, abi: PAY_ABI, functionName: "usdc" });

const send = async (to: `0x${string}`, data: Hex) => {
  const hash = await wallet.sendTransaction({ to, data: withBuilderSuffix(data, suffix) });
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`tx failed ${hash}`);
  return hash;
};
if ((await pub.readContract({ address: usdc, abi: ERC20, functionName: "allowance", args: [account.address, contract] })) < units) {
  console.log(`approve ${await send(usdc, encodeFunctionData({ abi: ERC20, functionName: "approve", args: [contract, units] }))}`);
}
const tx = await send(contract, encodeFunctionData({ abi: PAY_ABI, functionName: "pay", args: [agent, units, callId] }));
console.log(`paid ${agent} ${units} USDC units (callId ${callId}), builder code ${suffix ? "on" : "off"}\nX-Mimir-Payment: base:${tx}`);
