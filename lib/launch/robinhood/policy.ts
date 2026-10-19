/**
 * The Privy policy on a Robinhood agent's wallet (chain_type "ethereum"). Pure: the JSON for POST /v1/policies.
 * Default DENY; it may only sign transactions on Robinhood Chain that
 *   - launch on the Pons factory, claim from the Pons fee escrow, or swap through the Uniswap UniversalRouter;
 *   - call a Pons curve's buy or sell paying out to the wallet itself, or sweepFees (each launch has its own curve,
 *     so curves are matched by function and recipient, not address);
 *   - approve a spender (a curve or Permit2 pulls the tokens on a sell) or let Permit2 hand the router an allowance;
 *   - send to the owner or the treasury (the shutdown sweep).
 * ponytail: approve is open to any spender; it exposes only the memecoins the wallet holds, never its ETH. Narrow it
 * with a condition set of known curves if that ever matters.
 * Docs: https://docs.privy.io/controls/policies/example-policies/ethereum.md (ethereum_transaction to/chain_id,
 * ethereum_calldata <function>.<argument> and function_name, with an abi).
 */
import { ROBINHOOD_CHAIN } from "../../robinhood/chain";
import { PONS_FACTORY, PONS_FEE_ESCROW } from "./pons";
import { PERMIT2, UNIVERSAL_ROUTER } from "./v4";

type Condition = { field_source: "ethereum_transaction" | "ethereum_calldata"; field: string; operator: "eq" | "in"; value: string | string[]; abi?: unknown[] };
type Rule = { name: string; method: "eth_signTransaction"; conditions: Condition[]; action: "ALLOW" };
export type EvmPolicyInput = { version: "1.0"; name: string; chain_type: "ethereum"; rules: Rule[] };

const onChain: Condition = { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: String(ROBINHOOD_CHAIN.id) };
const fn = (name: string, inputs: Array<[string, string]>) => ({ type: "function", name, stateMutability: "nonpayable", inputs: inputs.map(([n, type]) => ({ name: n, type })), outputs: [] });
const CURVE_ABI = [fn("buy", [["quoteIn", "uint256"], ["minTokensOut", "uint256"], ["recipient", "address"]]), fn("sell", [["tokensIn", "uint256"], ["minQuoteOut", "uint256"], ["recipient", "address"]]), fn("sweepFees", [["minBuybackTokensOut", "uint256"]])];
const APPROVE_ABI = [fn("approve", [["spender", "address"], ["amount", "uint256"]])];

export function robinhoodAgentPolicy(wallet: string, owner: string, treasury: string | null): EvmPolicyInput {
  const lower = (a: string) => a.toLowerCase();
  const rule = (name: string, ...conditions: Condition[]): Rule => ({ name, method: "eth_signTransaction", conditions: [onChain, ...conditions], action: "ALLOW" });
  const call = (field: string, operator: "eq" | "in", value: string | string[], abi: unknown[]): Condition => ({ field_source: "ethereum_calldata", field, operator, value, abi });
  return {
    version: "1.0",
    name: `Mimir RH agent ${wallet.slice(0, 10)}`,
    chain_type: "ethereum",
    rules: [
      rule("Pons factory, fee escrow, router, Permit2", { field_source: "ethereum_transaction", field: "to", operator: "in", value: [PONS_FACTORY, PONS_FEE_ESCROW, UNIVERSAL_ROUTER, PERMIT2].map(lower) }),
      rule("Curve buy to itself", call("buy.recipient", "eq", lower(wallet), CURVE_ABI)),
      rule("Curve sell to itself", call("sell.recipient", "eq", lower(wallet), CURVE_ABI)),
      rule("Sweep its curve's fees", call("function_name", "eq", "sweepFees", CURVE_ABI)),
      rule("Approve a token spender", call("function_name", "eq", "approve", APPROVE_ABI)),
      rule("Pay the owner or the treasury", { field_source: "ethereum_transaction", field: "to", operator: "in", value: [owner, ...(treasury ? [treasury] : [])].map(lower) }),
    ],
  };
}
