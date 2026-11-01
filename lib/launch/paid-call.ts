/**
 * Mimir API: anyone may call a launched agent, after paying the agent's own wallet in USDC, on Arc or on Base. The
 * caller pays first and sends `X-Mimir-Payment: <chain>:<tx>`; the transfer is read from the chain, never from what
 * the caller claims, and each tx buys one call (convex/agentApiDb.ts claim). Pure, so the checks run in tests.
 *
 * Base pays through contracts/MimirAgentPay.sol (BASE_AGENT_PAY_ADDRESS; unset = no Base offer): USDC goes from the
 * payer straight to the agent's EVM wallet (the same EOA as on Arc) and the contract emits Paid(callId, agent, payer,
 * amount). The quote carries a fresh `secret` and `callId = keccak256(secret)`; the payer pays that callId and sends
 * `base:<tx>:<secret>`. Only Paid events whose callId hashes from the secret count, and the secret never touches the
 * chain, so a tx hash seen on Basescan buys nothing for anyone else (commit-reveal). The contract keeps call ids per
 * payer, so a double click cannot pay twice and nobody can spend a pending id first.
 *
 * ponytail: on Arc the payment is not bound to the request, so whoever sends a fresh tx hash first gets the call.
 * Fine for a few cents; a memo-bound nonce is the upgrade if prices grow.
 */
import { getAddress, isAddress, keccak256, toHex, type Hash, type PublicClient } from "viem";

export type PayChain = "arc" | "base";
export const PAY_CHAINS: PayChain[] = ["arc", "base"];
export const PAY_HEADER = "x-mimir-payment";
/** A payment older than this does not buy a call (an old funding transfer to the wallet is not a payment). */
export const PAY_MAX_AGE_MS = 60 * 60_000;
/** Rounding headroom between the quote and the check: 5% below the quoted amount still passes. */
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
/**
 * On Base `payTo` is the MimirAgentPay contract: call pay(agent, units, callId) (or payWithPermit) on it, with
 * `dataSuffix` (Mimir's ERC-8021 Builder Code, when set) appended to the calldata.
 */
export interface Offer { chain: PayChain; asset: "USDC"; amount: string; units: string; decimals: number; payTo: string; agent?: string; callId?: string; secret?: string; dataSuffix?: string }
export type BaseQuote = { contract: string; callId: string; secret: string; dataSuffix?: string | null };

/** USDC base units (6 dp) owed for one call, rounded up: the same on Arc and Base. */
export function priceUnits(usd: number): bigint {
  return BigInt(Math.ceil(usd * 1e6));
}

const human = (units: bigint, decimals: number) => {
  const s = units.toString().padStart(decimals + 1, "0");
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return `${s.slice(0, -decimals)}${frac ? `.${frac}` : ""}`;
};

/** The callId a Base payment must carry for `secret` (commit-reveal: only the hash goes on chain). */
export const callIdFor = (secret: string) => keccak256(secret as Hash);

/** A fresh secret and its callId for one Base quote. */
export function newBaseCall(): { secret: string; callId: string } {
  const secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
  return { secret, callId: callIdFor(secret) };
}

/** Offers on every chain the agent has a wallet on; Base only with `base` (the contract and a fresh callId). */
export function quote(usd: number, w: Wallets, base: BaseQuote | null = null): Offer[] {
  return PAY_CHAINS.filter((c) => w[c] && (c !== "base" || base)).map((chain) => {
    const units = priceUnits(usd);
    const o: Offer = { chain, asset: "USDC", amount: human(units, 6), units: units.toString(), decimals: 6, payTo: w[chain]! };
    if (chain !== "base") return o;
    return { ...o, payTo: base!.contract, agent: w.base!, callId: base!.callId, secret: base!.secret, ...(base!.dataSuffix ? { dataSuffix: base!.dataSuffix } : {}) };
  });
}

export const minUnits = (usd: number) => (priceUnits(usd) * SLACK_BPS) / 10_000n;

/** `<chain>:<tx>`, and on Base `base:<tx>:<secret>` (the quote's secret, 32 bytes hex). */
export function parsePayment(raw: string | null): { chain: PayChain; tx: string; secret?: string } | null {
  const m = /^(arc|base):([^\s:]+)(?::(\S+))?$/.exec(raw?.trim() ?? "");
  if (!m) return null;
  const chain = m[1] as PayChain;
  const tx = m[2];
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return null;
  if (chain !== "base") return m[3] === undefined ? { chain, tx: tx.toLowerCase() } : null;
  return m[3] && /^0x[0-9a-fA-F]{64}$/.test(m[3]) ? { chain, tx: tx.toLowerCase(), secret: m[3].toLowerCase() } : null;
}

export type Paid = { ok: true; units: bigint } | { ok: false; error: string };

const fresh = (atMs: number, now: number) => now - atMs <= PAY_MAX_AGE_MS;

/**
 * What the agent wallet got in `hash` on Arc, USDC in 6 dp, sent either as native value (18 dp) or through the USDC
 * ERC-20 (one balance, two views, so the larger of the two, never their sum).
 */
export async function verifyArcPayment(
  client: Pick<PublicClient, "getTransaction" | "getTransactionReceipt" | "getBlock">,
  a: { hash: string; to: string; min: bigint; now?: number },
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
  let erc20 = 0n;
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== ARC_USDC || l.topics[0] !== TRANSFER_TOPIC || `0x${(l.topics[2] ?? "").slice(-40)}`.toLowerCase() !== to) continue;
    erc20 += BigInt(l.data);
  }
  const got = native / 1_000_000_000_000n > erc20 ? native / 1_000_000_000_000n : erc20;
  return got >= a.min ? { ok: true, units: got } : { ok: false, error: `The agent wallet received ${human(got, 6)} USDC; one call needs ${human(a.min, 6)}.` };
}

/**
 * Base: what MimirAgentPay (`contract`) paid the agent in `hash`, from its Paid events (USDC, 6 dp). Only events from
 * the configured contract count, so a look-alike event from another contract buys nothing.
 */
export async function verifyBasePayment(
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
