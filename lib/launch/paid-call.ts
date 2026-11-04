/**
 * Mimir API: anyone may call a launched agent, after paying the agent's own wallet in USDC, on Arc or on Base. The
 * caller pays first and sends `X-Mimir-Payment: <chain>:<tx>:<secret>`; payment is read from the chain, never from what
 * the caller claims, and each tx buys one call (convex/agentApiDb.ts claim). Pure, so the checks run in tests.
 *
 * Both chains pay through contracts/MimirAgentPay.sol (BASE_AGENT_PAY_ADDRESS / ARC_AGENT_PAY_ADDRESS;
 * unset = no offer on that chain). USDC (ERC-20, 6 dp) goes from the
 * payer straight to the agent's EVM wallet (the same EOA as on Arc) and the contract emits Paid(callId, agent, payer,
 * amount). The quote carries a fresh `secret` and `callId = keccak256(secret)`; the payer pays that callId and sends
 * `<chain>:<tx>:<secret>`. Only Paid events whose callId hashes from the secret count, and the secret never touches the
 * chain, so a public tx hash buys nothing for anyone else (commit-reveal). The contract keeps call ids per
 * payer, so a double click cannot pay twice and nobody can spend a pending id first.
 *
 * Direct transfers on either chain cannot buy calls: they carry no private redemption commitment.
 */
import { getAddress, isAddress, keccak256, toHex, type Hash, type PublicClient } from "viem";

export type PayChain = "arc" | "base";
export const PAY_CHAINS: PayChain[] = ["arc", "base"];
export const PAY_HEADER = "x-mimir-payment";
/** A payment older than this does not buy a call (an old funding transfer to the wallet is not a payment). */
export const PAY_MAX_AGE_MS = 60 * 60_000;
/** Rounding headroom between the quote and the check: 5% below the quoted amount still passes. */
const SLACK_BPS = 9_500n;
/** MimirAgentPay's Paid(bytes32 indexed callId, address indexed agent, address indexed payer, uint256 amount). */
export const PAID_TOPIC = keccak256(toHex("Paid(bytes32,address,address,uint256)"));
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const paymentContract = (raw: string | undefined): `0x${string}` | null => {
  const v = raw?.trim();
  return v && isAddress(v) && !/^0x0{40}$/.test(v) ? getAddress(v) : null;
};
/** Per-chain deployment; unset disables offers AND redemption on that chain. */
export const baseAgentPay = (raw = process.env.BASE_AGENT_PAY_ADDRESS) => paymentContract(raw);
export const arcAgentPay = (raw = process.env.ARC_AGENT_PAY_ADDRESS) => paymentContract(raw);

export const callPriceUsd = (raw = process.env.AGENT_API_PRICE_USD): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 0.05;
};

export type Wallets = Partial<Record<PayChain, string | null>>;
/**
 * `payTo` is the chain's MimirAgentPay contract: approve ERC-20 USDC, then call pay(agent, units, callId).
 * Base also supports payWithPermit and its ERC-8021 `dataSuffix` when configured.
 */
export interface Offer { chain: PayChain; asset: "USDC"; amount: string; units: string; decimals: number; payTo: string; agent?: string; callId?: string; secret?: string; dataSuffix?: string }
export type PaymentQuote = { contract: string; callId: string; secret: string; dataSuffix?: string | null };
export type BaseQuote = PaymentQuote;

/** USDC base units (6 dp) owed for one call, rounded up: the same on Arc and Base. */
export function priceUnits(usd: number): bigint {
  return BigInt(Math.ceil(usd * 1e6));
}

const human = (units: bigint, decimals: number) => {
  const s = units.toString().padStart(decimals + 1, "0");
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return `${s.slice(0, -decimals)}${frac ? `.${frac}` : ""}`;
};

/** The callId a payment must carry for `secret` (commit-reveal: only the hash goes on chain). */
export const callIdFor = (secret: string) => keccak256(secret as Hash);

/** A fresh private secret and its callId for one quote. */
export function newAgentCall(): { secret: string; callId: string } {
  const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
  return { secret, callId: callIdFor(secret) };
}
export const newBaseCall = newAgentCall;

/** Offers only with a wallet AND a configured commitment payment contract. Third argument retains the Base API. */
export function quote(usd: number, w: Wallets, base: PaymentQuote | null = null, arc: PaymentQuote | null = null): Offer[] {
  const payments = { base, arc };
  return PAY_CHAINS.filter((c) => w[c] && payments[c]).map((chain) => {
    const units = priceUnits(usd);
    const o: Offer = { chain, asset: "USDC", amount: human(units, 6), units: units.toString(), decimals: 6, payTo: w[chain]! };
    const payment = payments[chain]!;
    return { ...o, payTo: payment.contract, agent: w[chain]!, callId: payment.callId, secret: payment.secret, ...(chain === "base" && payment.dataSuffix ? { dataSuffix: payment.dataSuffix } : {}) };
  });
}

export const minUnits = (usd: number) => (priceUnits(usd) * SLACK_BPS) / 10_000n;

/** `<chain>:<tx>:<secret>` on BOTH chains (the quote's secret, 32 bytes hex). */
export function parsePayment(raw: string | null): { chain: PayChain; tx: string; secret: string } | null {
  const m = /^(arc|base):([^\s:]+)(?::(\S+))?$/.exec(raw?.trim() ?? "");
  if (!m) return null;
  const chain = m[1] as PayChain;
  const tx = m[2];
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return null;
  return m[3] && /^0x[0-9a-fA-F]{64}$/.test(m[3]) ? { chain, tx: tx.toLowerCase(), secret: m[3].toLowerCase() } : null;
}

export type Paid = { ok: true; units: bigint } | { ok: false; error: string };

const fresh = (atMs: number, now: number) => now - atMs <= PAY_MAX_AGE_MS;

/**
 * What MimirAgentPay (`contract`) paid the agent in `hash`, from its Paid events (USDC, 6 dp). Only events from
 * the configured contract count, so a look-alike event from another contract buys nothing.
 */
export async function verifyAgentPayment(
  client: Pick<PublicClient, "getTransactionReceipt" | "getBlock">,
  a: { hash: string; contract: string; agent: string; callId: string; min: bigint; now?: number },
): Promise<Paid> {
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: a.hash as Hash });
  } catch {
    return { ok: false, error: "Transaction not found yet. Try again in a few seconds." };
  }
  if (receipt.status !== "success") return { ok: false, error: "That transaction failed on chain." };
  const block = await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null);
  if (!block || !fresh(Number(block.timestamp) * 1000, a.now ?? Date.now())) return { ok: false, error: "That payment is older than an hour." };
  const contract = a.contract.toLowerCase();
  const agent = a.agent.toLowerCase();
  const callId = a.callId.toLowerCase();
  let got = 0n;
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== contract || l.topics[0] !== PAID_TOPIC || l.topics[1]?.toLowerCase() !== callId || `0x${(l.topics[2] ?? "").slice(-40)}`.toLowerCase() !== agent) continue;
    got += BigInt(l.data);
  }
  if (got === 0n) return { ok: false, error: "The transaction has no MimirAgentPay payment to this agent for that secret." };
  return got >= a.min ? { ok: true, units: got } : { ok: false, error: `The agent was paid ${human(got, 6)} USDC; one call needs ${human(a.min, 6)}.` };
}
export const verifyBasePayment = verifyAgentPayment;
export const verifyArcPayment = verifyAgentPayment;
