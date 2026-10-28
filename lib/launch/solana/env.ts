// Mimir Launch: the Solana layer from server env (ported from snipad). Lazy: importing never throws.
// RPCs: LAUNCH_SOLANA_RPC, else Mimir's SOLANA_MAINNET_RPC list; treasury: LAUNCH_SOLANA_TREASURY.
import { rpcConnection, stickyPool } from "./rpc-pool";
import { createExecutor, type ExecutorDeps } from "./executor";
import { createJupiter } from "./jupiter";
import { meteoraFromEnv } from "./meteora";
import { createPrivy } from "./privy";
import { createPumpPortal } from "./pumpportal";
import { assertAddress, SolanaError } from "./util";

type Env = Record<string, string | undefined>;

function lamportsVar(env: Env, name: string, fallback: bigint): bigint {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d{1,12}$/.test(raw) || BigInt(raw) <= BigInt(0)) throw new SolanaError("solana", `${name} must be a positive integer (lamports)`, { code: "CONFIG" });
  return BigInt(raw);
}

export function solanaFromEnv(env: Env = process.env, extra: Partial<Pick<ExecutorDeps, "onRetry" | "send">> = {}) {
  const treasury = assertAddress("LAUNCH_SOLANA_TREASURY", env.LAUNCH_SOLANA_TREASURY);
  env = { ...env, SOLANA_RPC: env.LAUNCH_SOLANA_RPC || env.SOLANA_MAINNET_RPC || env.SOLANA_RPC };
  // SOLANA_RPC list, else one Helius URL per HELIUS_API_KEYS, then the public RPC; fails over on 429/401/403/5xx.
  const connection = rpcConnection("confirmed", env);
  // Money paths: each tx pinned to one keyed endpoint, the others as witnesses (never the public RPC).
  const sticky = stickyPool(env);
  const privy = createPrivy({ appId: env.PRIVY_APP_ID ?? "", appSecret: env.PRIVY_APP_SECRET ?? "", authKey: env.PRIVY_AUTHORIZATION_KEY || undefined });
  if (!env.PRIVY_AUTHORIZATION_KEY && env.NODE_ENV === "production") {
    throw new SolanaError("privy", "PRIVY_AUTHORIZATION_KEY is required in production (wallet/policy owner)", { code: "CONFIG" });
  }
  const pumpportal = createPumpPortal({
    pinataJwt: env.PINATA_JWT || undefined,
    ipfsGateway: env.IPFS_GATEWAY || undefined,
    priorityFeeLamports: lamportsVar(env, "PRIORITY_FEE_LAMPORTS", BigInt(100_000)),
  });
  const jupiter = createJupiter({ apiKey: env.JUPITER_API_KEY || undefined, cuPricePercentile: env.JUPITER_CU_PRICE_PERCENTILE || "high" });
  const meteora = meteoraFromEnv(connection, env);
  const executor = createExecutor({
    privy,
    connection,
    pumpportal,
    meteora,
    jupiter,
    reserveLamports: lamportsVar(env, "SPENDABLE_RESERVE_LAMPORTS", BigInt(10_000_000)),
    maxPriorityFeeLamports: lamportsVar(env, "MAX_PRIORITY_FEE_LAMPORTS", BigInt(1_000_000)),
    endpoints: sticky,
    ...extra,
  });
  return { connection, sticky, privy, pumpportal, meteora, jupiter, executor, treasury };
}

let cached: ReturnType<typeof solanaFromEnv> | null = null;
export function getSolana() {
  cached ??= solanaFromEnv();
  return cached;
}
