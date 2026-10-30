/**
 * The Privy policy on a Base agent's wallet (chain_type "ethereum"). Pure: the JSON for POST /v1/policies.
 * Default DENY; it may only sign transactions on Base (8453) that
 *   - call the Clanker v4 factory (its own token's launch) or the ClankerFeeLocker (claiming its creator fees);
 *   - unwrap WETH (withdraw on the WETH contract: the fees arrive as WETH);
 *   - send to the owner's payout address or the treasury (withdrawals and the shutdown sweep).
 * No trading yet, so no router or approvals: when Base trading lands, its routes are added here.
 * ponytail: the factory rule does not pin msg.value to 0 (a dev buy). Only Mimir's server signs and never sends one.
 * Docs: https://docs.privy.io/controls/policies/example-policies/ethereum.md
 */
import { BASE_CHAIN } from "../../base/chain";
import type { EvmPolicyInput } from "../robinhood/policy";
import { BASE_WETH, CLANKER_FACTORY, CLANKER_FEE_LOCKER } from "./clanker";

type Condition = EvmPolicyInput["rules"][number]["conditions"][number];

const onBase: Condition = { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: String(BASE_CHAIN.id) };
const WITHDRAW_ABI = [{ type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "wad", type: "uint256" }], outputs: [] }];

export function baseAgentPolicy(wallet: string, payout: string, treasury: string | null): EvmPolicyInput {
  const lower = (a: string) => a.toLowerCase();
  const rule = (name: string, ...conditions: Condition[]) => ({ name, method: "eth_signTransaction" as const, conditions: [onBase, ...conditions], action: "ALLOW" as const });
  const to = (value: string[]): Condition => ({ field_source: "ethereum_transaction", field: "to", operator: "in", value: value.map(lower) });
  return {
    version: "1.0",
    name: `Mimir Base agent ${wallet.slice(0, 10)}`,
    chain_type: "ethereum",
    rules: [
      rule("Clanker factory and fee locker", to([CLANKER_FACTORY, CLANKER_FEE_LOCKER])),
      rule("Unwrap WETH", { field_source: "ethereum_transaction", field: "to", operator: "eq", value: lower(BASE_WETH) }, { field_source: "ethereum_calldata", field: "function_name", operator: "eq", value: "withdraw", abi: WITHDRAW_ABI }),
      rule("Pay the owner or the treasury", to([payout, ...(treasury ? [treasury] : [])])),
    ],
  };
}
