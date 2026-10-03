/**
 * Jupiter Ultra (keyless, mainnet) for the terminal's buy/sell, priced in SOL. Called from
 * the browser directly, so swaps put no load on our servers. Jupiter builds,
 * the user's wallet signs, Jupiter lands it. Always Solana mainnet: that is
 * where the tokens trade, whatever cluster the markets run on.
 */
export const ULTRA = "https://lite-api.jup.ag/ultra/v1";
/** Native SOL (Jupiter wraps and unwraps it): what buy pays with and sell receives. */
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const SOL_DECIMALS = 9;
/** Price impact past which the terminal asks twice. */
export const HIGH_IMPACT_PCT = 5;

export interface UltraOrder {
  inAmount: string;
  outAmount: string;
  priceImpactPct?: string;
  routePlan?: { swapInfo?: { label?: string } }[];
  feeBps?: number;
  transaction?: string | null;
  requestId: string;
  inputMint: string;
  outputMint: string;
  error?: string;
  errorMessage?: string;
}

export async function ultraOrder(args: { inputMint: string; outputMint: string; amount: bigint; taker: string }): Promise<UltraOrder> {
  const q = new URLSearchParams({ inputMint: args.inputMint, outputMint: args.outputMint, amount: args.amount.toString(), taker: args.taker });
  const res = await fetch(`${ULTRA}/order?${q}`, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as UltraOrder;
  if (!res.ok || body.error || body.errorMessage) throw new Error(body.errorMessage ?? body.error ?? `Jupiter answered ${res.status}`);
  return body;
}

export async function ultraExecute(signedTransaction: string, requestId: string): Promise<{ status: string; signature?: string; error?: string }> {
  const res = await fetch(`${ULTRA}/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signedTransaction, requestId }),
  });
  return (await res.json().catch(() => ({ status: "Failed", error: `Jupiter answered ${res.status}` }))) as { status: string; signature?: string; error?: string };
}

/** A wallet's mainnet balance of `mint` in raw units (0 when it holds none). */
export async function ultraBalance(wallet: string, mint: string): Promise<{ raw: bigint; ui: number }> {
  const res = await fetch(`${ULTRA}/balances/${wallet}`, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as Record<string, { amount?: string; uiAmount?: number }>;
  const b = body[mint];
  return { raw: BigInt(b?.amount ?? "0"), ui: Number(b?.uiAmount ?? 0) };
}

/** The share of a raw balance a `sell <pct>` sells. Pure. */
export function sellAmount(raw: bigint, pct: number): bigint {
  if (raw <= 0n || !(pct > 0)) return 0n;
  return (raw * BigInt(Math.round(Math.min(pct, 100) * 100))) / 10_000n;
}

/** What the user should hear before signing. Pure. */
export function swapWarnings(order: Pick<UltraOrder, "priceImpactPct">, token: { verified?: boolean | null; mintAuthorityDisabled?: boolean | null; freezeAuthorityDisabled?: boolean | null; liquidityUsd?: number | null } | null): string[] {
  const out: string[] = [];
  const impact = Math.abs(Number(order.priceImpactPct ?? 0)) * 100;
  if (impact >= HIGH_IMPACT_PCT) out.push(`price impact ${impact.toFixed(1)}%: you move the price against yourself`);
  if (token) {
    if (token.verified !== true) out.push("not verified by Jupiter");
    if (token.mintAuthorityDisabled === false) out.push("the creator can still mint more of it");
    if (token.freezeAuthorityDisabled === false) out.push("the creator can freeze holders' tokens");
    if (token.liquidityUsd !== null && token.liquidityUsd !== undefined && token.liquidityUsd < 10_000) out.push(`thin liquidity ($${Math.round(token.liquidityUsd).toLocaleString("en-US")})`);
  }
  return out;
}
