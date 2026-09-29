/**
 * The Mimir token and $ANSEM: where they live and what they are called.
 *
 * The product runs on Solana devnet; the token lives on Solana MAINNET
 * (launched on ClawPump / pump.fun). Until it launches the mint is unset and
 * every surface renders a "launching on ClawPump" state instead of numbers.
 *
 * Isomorphic: only NEXT_PUBLIC_ vars, so the browser and the server agree.
 */

const BASE58_MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * $ANSEM ("The Black Bull") on Solana mainnet, a Token-2022 pump.fun mint.
 * Verified 2026-09-29 against the CoinGecko listing the AnsemHack page links
 * (coingecko.com/en/coins/the-black-bull → platforms.solana) and the mint
 * account itself (program spl-token-2022, symbol ANSEM, 6 decimals).
 */
export const ANSEM_MINT_VERIFIED = "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump";

function mintOrNull(value: string | undefined): string | null {
  const v = value?.trim();
  return v && BASE58_MINT.test(v) ? v : null;
}

/** The Mimir token's mainnet mint, or null before launch. */
export function mimirMint(): string | null {
  return mintOrNull(process.env.NEXT_PUBLIC_MIMIR_TOKEN_MINT);
}

/** Ticker without the `$`, upper-case. */
export function mimirSymbol(): string {
  const s = (process.env.NEXT_PUBLIC_MIMIR_TOKEN_SYMBOL ?? "").trim().replace(/^\$/, "").toUpperCase();
  return /^[A-Z0-9]{2,10}$/.test(s) ? s : "MIMIR";
}

/** The token's ClawPump page, or the ClawPump launch page before one exists. */
export function mimirTokenUrl(): string {
  const url = (process.env.NEXT_PUBLIC_MIMIR_TOKEN_URL ?? "").trim();
  if (/^https:\/\//.test(url)) return url;
  const mint = mimirMint();
  return mint ? `https://clawpump.tech/tokens/${mint}` : "https://clawpump.tech/dashboard/launch-token";
}

/** $ANSEM's mint: the env override, else the verified address. */
export function ansemMint(): string {
  return mintOrNull(process.env.NEXT_PUBLIC_ANSEM_MINT) ?? ANSEM_MINT_VERIFIED;
}

/**
 * Tickers whose price settles from mainnet DEX data (DexScreener + Jupiter),
 * mapped to their mints. MIMIR joins once its mint is set.
 */
export function dexTokenMints(): Record<string, string> {
  const out: Record<string, string> = { ANSEM: ansemMint() };
  const mint = mimirMint();
  if (mint) out[mimirSymbol()] = mint;
  return out;
}

export function dexMintFor(symbol: string): string | null {
  return dexTokenMints()[symbol.toUpperCase()] ?? null;
}

/** A public, keyless source URL for a DEX-priced token (the claim's resolution URL). */
export function dexSourceUrl(mint: string): string {
  return `https://api.dexscreener.com/tokens/v1/solana/${mint}`;
}
