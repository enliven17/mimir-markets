/**
 * Mimir API: anyone may call a launched agent, after paying the agent's own wallet on any chain it has one on, in
 * that chain's native money: USDC on Arc, SOL on Solana, ETH on Robinhood Chain, USDC on Base. The caller pays first and sends
 * `X-Mimir-Payment: <chain>:<tx>`; the transfer is read from the chain, never from what the caller claims, and each
 * tx buys one call (convex/agentApiDb.ts claim). Pure apart from the price fetch, so the checks run in tests.
 *
 * Base pays through contracts/MimirAgentPay.sol (BASE_AGENT_PAY_ADDRESS; unset = no Base offer): USDC goes from the
 * payer straight to the agent's EVM wallet (the same EOA as on Arc) and the contract emits Paid(callId, agent, payer,
 * amount). The quote carries a fresh callId the contract accepts once, so a double click cannot pay twice.
 *
 * ponytail: the payment is not bound to the request, so whoever sends a fresh tx hash first gets the call. Fine for
 * a few cents; a signed quote nonce (memo / calldata) is the upgrade if prices grow.
 */
import type { Connection } from "@solana/web3.js";
import { getAddress, isAddress, keccak256, toHex, type Hash, type PublicClient } from "viem";

export type PayChain = "arc" | "solana" | "robinhood" | "base";
export const PAY_CHAINS: PayChain[] = ["arc", "solana", "robinhood", "base"];
export const PAY_HEADER = "x-mimir-payment";
/** A payment older than this does not buy a call (an old funding transfer to the wallet is not a payment). */
export const PAY_MAX_AGE_MS = 60 * 60_000;
/** Price moves between the quote and the check: 5% below the live amount still passes. */
const SLACK_BPS = 9_500n;
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** MimirAgentPay's Paid(bytes32 indexed callId, address indexed agent, address indexed payer, uint256 amount). */
export const PAID_TOPIC = keccak256(toHex("Paid(bytes32,address,address,uint256)"));
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** The MimirAgentPay contract on Base, or null when Base payments are off. */
export const baseAgentPay = (raw = process.env.BASE_AGENT_PAY_ADDRESS): `0x${string}` | null => {
  const v = raw?.trim();
  return v && isAddress(v) ? getAddress(v) : null;
};

export const callPriceUsd = (raw = process.env.AGENT_API_PRICE_USD): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 0.05;
};

export type Wallets = Partial<Record<PayChain, string | null>>;
export type Prices = { SOL: number; ETH: number };
/** On Base `payTo` is the MimirAgentPay contract: call pay(agent, units, callId) (or payWithPermit) on it. */
export interface Offer { chain: PayChain; asset: "USDC" | "SOL" | "ETH"; amount: string; units: string; decimals: number; payTo: string; agent?: string; callId?: string }
export type BaseQuote = { contract: string; callId: string };

/** SOL and ETH in USD (Coinbase spot, keyless). */
export async function usdPrices(f: typeof fetch = fetch): Promise<Prices> {
  const one = async (pair: string) => {
    const r = await f(`https://api.coinbase.com/v2/prices/${pair}/spot`, { signal: AbortSignal.timeout(5_000) });
    const n = Number(((await r.json()) as { data?: { amount?: string } }).data?.amount);
    if (!r.ok || !Number.isFinite(n) || n <= 0) throw new Error(`no ${pair} price`);
    return n;
  };
  const [SOL, ETH] = await Promise.all([one("SOL-USD"), one("ETH-USD")]);
  return { SOL, ETH };
}

const DECIMALS: Record<PayChain, number> = { arc: 6, solana: 9, robinhood: 18, base: 6 };
const ASSET: Record<PayChain, Offer["asset"]> = { arc: "USDC", solana: "SOL", robinhood: "ETH", base: "USDC" };

/** Base units owed for one call on `chain`, rounded up. */
export function priceUnits(chain: PayChain, usd: number, p: Prices): bigint {
  if (chain === "arc" || chain === "base") return BigInt(Math.ceil(usd * 1e6));
  if (chain === "solana") return BigInt(Math.ceil((usd / p.SOL) * 1e9));
  return BigInt(Math.ceil((usd / p.ETH) * 1e9)) * 1_000_000_000n; // gwei precision is plenty
}

const human = (units: bigint, decimals: number) => {
  const s = units.toString().padStart(decimals + 1, "0");
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return `${s.slice(0, -decimals)}${frac ? `.${frac}` : ""}`;
};

/** A fresh call id for one Base quote (MimirAgentPay accepts each once). */
export const newCallId = () => toHex(crypto.getRandomValues(new Uint8Array(32)));

/** Offers on every chain the agent has a wallet on; Base only with `base` (the contract and a fresh callId). */
export function quote(usd: number, p: Prices, w: Wallets, base: BaseQuote | null = null): Offer[] {
  return PAY_CHAINS.filter((c) => w[c] && (c !== "base" || base)).map((chain) => {
    const units = priceUnits(chain, usd, p);
    const o: Offer = { chain, asset: ASSET[chain], amount: human(units, DECIMALS[chain]), units: units.toString(), decimals: DECIMALS[chain], payTo: w[chain]! };
    return chain === "base" ? { ...o, payTo: base!.contract, agent: w.base!, callId: base!.callId } : o;
  });
}

export const minUnits = (chain: PayChain, usd: number, p: Prices) => (priceUnits(chain, usd, p) * SLACK_BPS) / 10_000n;

export function parsePayment(raw: string | null): { chain: PayChain; tx: string } | null {
  const m = /^(arc|solana|robinhood|base):(\S+)$/.exec(raw?.trim() ?? "");
  if (!m) return null;
  const chain = m[1] as PayChain;
  const tx = m[2];
  const ok = chain === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(tx) : /^0x[0-9a-fA-F]{64}$/.test(tx);
  return ok ? { chain, tx: chain === "solana" ? tx : tx.toLowerCase() } : null;
}

export type Paid = { ok: true; units: bigint } | { ok: false; error: string };

const fresh = (atMs: number, now: number) => now - atMs <= PAY_MAX_AGE_MS;

/** SOL the agent wallet gained in `sig` (confirmed, no error, recent). */
export async function verifySolanaPayment(conn: Pick<Connection, "getParsedTransaction">, a: { sig: string; to: string; min: bigint; now?: number }): Promise<Paid> {
  let tx;
  try {
    tx = await conn.getParsedTransaction(a.sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  } catch {
    return { ok: false, error: "Could not read the transaction. Try again in a few seconds." };
  }
  if (!tx?.meta) return { ok: false, error: "Transaction not found yet. Try again in a few seconds." };
  if (tx.meta.err) return { ok: false, error: "That transaction failed on chain." };
  if (!tx.blockTime || !fresh(tx.blockTime * 1000, a.now ?? Date.now())) return { ok: false, error: "That payment is older than an hour." };
  const i = tx.transaction.message.accountKeys.findIndex((k) => k.pubkey.toBase58() === a.to);
  if (i < 0) return { ok: false, error: "The transaction does not pay the agent wallet." };
  const got = BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]);
  return got >= a.min ? { ok: true, units: got } : { ok: false, error: `The agent wallet received ${human(got > 0n ? got : 0n, 9)} SOL; one call needs ${human(a.min, 9)}.` };
}

/**
 * What the agent wallet got in `hash`: native value on Robinhood (wei); on Arc USDC in 6 dp, sent either as native
 * value (18 dp) or through the USDC ERC-20 (one balance, two views, so the larger of the two, never their sum).
 */
export async function verifyEvmPayment(
  client: Pick<PublicClient, "getTransaction" | "getTransactionReceipt" | "getBlock">,
  a: { chain: "arc" | "robinhood"; hash: string; to: string; min: bigint; now?: number },
): Promise<Paid> {
  const hash = a.hash as Hash;
  let tx, receipt;
  try {
    [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
  } catch {
    return { ok: false, error: "Transaction not found yet. Try again in a few seconds." };
  }
  if (receipt.status !== "success") return { ok: false, error: "That transaction failed on chain." };
  const block = await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null);
  if (!block || !fresh(Number(block.timestamp) * 1000, a.now ?? Date.now())) return { ok: false, error: "That payment is older than an hour." };
  const to = a.to.toLowerCase();
  const native = tx.to?.toLowerCase() === to ? tx.value : 0n;
  let got = native;
  if (a.chain === "arc") {
    let erc20 = 0n;
    for (const l of receipt.logs) {
      if (l.address.toLowerCase() !== ARC_USDC || l.topics[0] !== TRANSFER_TOPIC || `0x${(l.topics[2] ?? "").slice(-40)}`.toLowerCase() !== to) continue;
      erc20 += BigInt(l.data);
    }
    got = native / 1_000_000_000_000n > erc20 ? native / 1_000_000_000_000n : erc20;
  }
  const d = a.chain === "arc" ? 6 : 18;
  const unit = a.chain === "arc" ? "USDC" : "ETH";
  return got >= a.min ? { ok: true, units: got } : { ok: false, error: `The agent wallet received ${human(got, d)} ${unit}; one call needs ${human(a.min, d)}.` };
}

/**
 * Base: what MimirAgentPay (`contract`) paid the agent in `hash`, from its Paid events (USDC, 6 dp). Only events from
 * the configured contract count, so a look-alike event from another contract buys nothing.
 */
export async function verifyBasePayment(
  client: Pick<PublicClient, "getTransactionReceipt" | "getBlock">,
  a: { hash: string; contract: string; agent: string; min: bigint; now?: number },
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
  let got = 0n;
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== contract || l.topics[0] !== PAID_TOPIC || `0x${(l.topics[2] ?? "").slice(-40)}`.toLowerCase() !== agent) continue;
    got += BigInt(l.data);
  }
  if (got === 0n) return { ok: false, error: "The transaction has no MimirAgentPay payment to this agent." };
  return got >= a.min ? { ok: true, units: got } : { ok: false, error: `The agent was paid ${human(got, 6)} USDC; one call needs ${human(a.min, 6)}.` };
}
