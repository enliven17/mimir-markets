/**
 * Market URLs per chain. /arena/<chain>/<kind>/<id> is the market page; /arena/arc/<kind>/<id> (every link from
 * before Base) is the same route with chain = arc. Pure.
 */
import type { MarketChainId } from "./registry";

export const marketPath = (chain: MarketChainId | null | undefined, kind: "vs" | "pool", id: number | string) => `/arena/${chain ?? "solana"}/${kind}/${id}`;

/** "base-pool-3" / "pool-3" (Arc, the older form) for share links and cards. */
export const marketRef = (chain: MarketChainId | null | undefined, kind: "vs" | "pool", id: number) => `${chain && chain !== "arc" ? `${chain}-` : ""}${kind}-${id}`;
