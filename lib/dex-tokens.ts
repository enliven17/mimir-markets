/**
 * Mainnet tokens whose price claims settle from DEX data (DexScreener +
 * Jupiter): $ANSEM, and where it lives.
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

/** $ANSEM's mint: the env override, else the verified address. */
export function ansemMint(): string {
  return mintOrNull(process.env.NEXT_PUBLIC_ANSEM_MINT) ?? ANSEM_MINT_VERIFIED;
}

/** Tickers whose price settles from mainnet DEX data, mapped to their mints. */
export function dexTokenMints(): Record<string, string> {
  return { ANSEM: ansemMint() };
}

export function dexMintFor(symbol: string): string | null {
  return dexTokenMints()[symbol.toUpperCase()] ?? null;
}

/** A public, keyless source URL for a DEX-priced token (the claim's resolution URL). */
export function dexSourceUrl(mint: string): string {
  return `https://api.dexscreener.com/tokens/v1/solana/${mint}`;
}
