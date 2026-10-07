import { ARC } from "@/lib/arc/config";

/** The Arena runs on Arc when both contracts and Convex are configured; otherwise the Solana arena stays. */
export const arcArenaEnabled = Boolean(ARC.contracts.mimirV3 && ARC.contracts.mimirPool && process.env.NEXT_PUBLIC_CONVEX_URL);
