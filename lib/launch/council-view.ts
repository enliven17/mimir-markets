/**
 * Mimir Launch: the council personas as agents, from lib/launch/council.json. Each has an Arc wallet (its Circle
 * council wallet, ids in ARC_COUNCIL_WALLETS) that stakes on markets, and optionally a Base wallet (address and Circle
 * wallet id) for staking on Base markets once they open, plus its token if it has one. Public data only. Isomorphic.
 */
import data from "./council.json";

export type TokenChain = "arc" | "base";

export interface AgentToken {
  chain: TokenChain;
  address: string;
  /** Argus only: the splitter that holds the creator's fees. */
  splitter?: string | null;
}

export interface CouncilAgent {
  slug: string;
  name: string;
  ticker: string;
  arc: string | null;
  /** Its Base wallet, once made: address and Circle wallet id (not staking yet). */
  base: { address: string; walletId: string } | null;
  token: AgentToken | null;
}

type Raw = {
  name: string;
  ticker: string;
  arc: string | null;
  base?: { address: string; walletId: string };
  baseTestnet?: { address: string; walletId: string };
  token?: { chain: TokenChain; address: string; splitter?: string };
};

export const COUNCIL_AGENTS: Record<string, CouncilAgent> = Object.fromEntries(
  Object.entries(data as Record<string, Raw>).map(([slug, r]) => [
    slug,
    {
      slug, name: r.name, ticker: r.ticker, arc: r.arc, base: (process.env.NEXT_PUBLIC_BASE_NETWORK ?? process.env.BASE_NETWORK) === "mainnet" ? r.base ?? null : r.baseTestnet ?? null,
      token: r.token ? { chain: r.token.chain, address: r.token.address, splitter: r.token.splitter ?? null } : null,
    },
  ]),
);

/** Token pages: Argus (Arc) and Clanker (Base). */
export const argusToken = (token: string) => `https://arguspad.io/token/${token}`;
export const clankerToken = (token: string) => `https://www.clanker.world/clanker/${token}`;
export const tokenPage = (t: Pick<AgentToken, "chain" | "address">) => (t.chain === "arc" ? argusToken(t.address) : clankerToken(t.address));
export const basescan = (kind: "address" | "token" | "tx", id: string) => `https://basescan.org/${kind}/${id}`;
