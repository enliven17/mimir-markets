/**
 * The RPC URL the agent API hands back with a prepared transaction. Agents
 * get a public endpoint only: a provider URL with a key (Helius `?api-key=`),
 * any query string or credentials would leak the deploy's paid RPC
 * (audit P0-7). AGENT_PUBLIC_RPC / AGENT_PUBLIC_ER_RPC set it explicitly.
 */
export type RpcLayer = "base" | "er";

export function isPublicRpcUrl(raw: string | undefined): boolean {
  const v = raw?.trim();
  if (!v || /api[-_]?key/i.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.search && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Hosts known to be free public endpoints; any other NEXT_PUBLIC_ RPC may carry a key in its path (QuickNode, Alchemy /v2/<key>). */
const KNOWN_PUBLIC_HOSTS = new Set([
  "api.mainnet-beta.solana.com",
  "api.devnet.solana.com",
  "devnet.magicblock.app",
  "devnet-as.magicblock.app",
  "devnet-eu.magicblock.app",
  "devnet-us.magicblock.app",
  "devnet-router.magicblock.app",
]);

export function isKnownPublicRpcUrl(raw: string | undefined): boolean {
  if (!isPublicRpcUrl(raw)) return false;
  return KNOWN_PUBLIC_HOSTS.has(new URL(raw!.trim()).hostname.toLowerCase());
}

const DEFAULTS: Record<RpcLayer, { devnet: string; mainnet: string }> = {
  base: { devnet: "https://api.devnet.solana.com", mainnet: "https://api.mainnet-beta.solana.com" },
  // No public MagicBlock mainnet endpoint is assumed: omit rather than guess.
  er: { devnet: "https://devnet-as.magicblock.app/", mainnet: "" },
};

/** A public RPC for `layer`, or "" when none is configured (agents use their own). */
export function publicRpcFor(layer: RpcLayer, env: Record<string, string | undefined>, mainnet: boolean): string {
  // AGENT_PUBLIC_* is the operator's explicit choice; the app's own RPC only when it is a known public host.
  const explicit = layer === "base" ? env.AGENT_PUBLIC_RPC : env.AGENT_PUBLIC_ER_RPC;
  if (isPublicRpcUrl(explicit)) return explicit!.trim();
  const app = layer === "base" ? env.NEXT_PUBLIC_SOLANA_RPC : env.NEXT_PUBLIC_MAGICBLOCK_ER_RPC;
  if (isKnownPublicRpcUrl(app)) return app!.trim();
  return mainnet ? DEFAULTS[layer].mainnet : DEFAULTS[layer].devnet;
}
