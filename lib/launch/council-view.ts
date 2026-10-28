/**
 * Mimir Launch: the council personas as launch agents, from lib/launch/council.json (written by
 * scripts/launch/council-tokens.mts): each one's own Solana agent wallet, its pump.fun token once minted, and its Arc
 * council wallet. Public data only. Isomorphic.
 */
import data from "./council.json";

export interface CouncilAgent {
  slug: string;
  name: string;
  ticker: string;
  solana: string | null;
  arc: string | null;
  mint: string | null;
  /** Its Argus token on Arc, once launched (scripts/argus/socrates-launch.mts). */
  argus: { token: string; poolId: string } | null;
  /** Its Robinhood Chain wallet (scripts/launch/council-robinhood.mts). */
  robinhood: string | null;
}

type Raw = { name: string; ticker: string; arc: string | null; solana?: { address: string }; robinhood?: { address: string }; mint?: string; argus?: { token: string; poolId: string } };

export const COUNCIL_AGENTS: Record<string, CouncilAgent> = Object.fromEntries(
  Object.entries(data as Record<string, Raw>).map(([slug, r]) => [slug, { slug, name: r.name, ticker: r.ticker, solana: r.solana?.address ?? null, arc: r.arc, mint: r.mint ?? null, argus: r.argus ? { token: r.argus.token, poolId: r.argus.poolId } : null, robinhood: r.robinhood?.address ?? null }]),
);

/** Mainnet links: launch agents live on Solana mainnet whatever cluster the rest of the site reads. */
export const solscan = (kind: "account" | "token" | "tx", id: string) => `https://solscan.io/${kind}/${id}`;
export const pumpFun = (mint: string) => `https://pump.fun/coin/${mint}`;
/** A Meteora DBC token: its curve and, once graduated, its DAMM pool both trade through Jupiter. */
export const meteoraToken = (mint: string) => `https://jup.ag/tokens/${mint}`;
export const dexChart = (mint: string) => `https://dexscreener.com/solana/${mint}?embed=1&theme=dark&trades=0&info=0`;
/** Robinhood Chain (Pons tokens): Pons's own token page (curve and graduated alike); DexScreener charts graduated ones. */
export const rhToken = (token: string) => `https://ponsfamily.com/launchpad/${token}`;
export const rhChart = (token: string) => `https://dexscreener.com/robinhood/${token}?embed=1&theme=dark&trades=0&info=0`;
export const rhExplorer = (kind: "address" | "token" | "tx", id: string) => `https://robinhoodchain.blockscout.com/${kind}/${id}`;
