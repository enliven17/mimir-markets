/**
 * Mimir Launch: the Robinhood Chain layer from server env. Lazy: importing never throws.
 * Env: PRIVY_APP_ID / PRIVY_APP_SECRET / PRIVY_AUTHORIZATION_KEY (shared with Solana), ROBINHOOD_RPC (else
 * NEXT_PUBLIC_ROBINHOOD_RPC, else the public endpoint), LAUNCH_ROBINHOOD_TREASURY (optional 0x address the wallet
 * policy also lets it pay).
 */
import { getAddress, isAddress } from "viem";

import { ROBINHOOD_CHAIN } from "../../robinhood/chain";
import { createPrivy } from "../solana/privy";
import { SolanaError } from "../solana/util";
import { createRobinhoodExecutor } from "./executor";

type Env = Record<string, string | undefined>;

export function robinhoodFromEnv(env: Env = process.env) {
  const privy = createPrivy({ appId: env.PRIVY_APP_ID ?? "", appSecret: env.PRIVY_APP_SECRET ?? "", authKey: env.PRIVY_AUTHORIZATION_KEY || undefined });
  if (!env.PRIVY_AUTHORIZATION_KEY && env.NODE_ENV === "production") {
    throw new SolanaError("privy", "PRIVY_AUTHORIZATION_KEY is required in production (wallet/policy owner)", { code: "CONFIG" });
  }
  const raw = env.LAUNCH_ROBINHOOD_TREASURY?.trim();
  if (raw && !isAddress(raw)) throw new SolanaError("robinhood", "LAUNCH_ROBINHOOD_TREASURY must be a 0x address", { code: "CONFIG" });
  const executor = createRobinhoodExecutor({ privy, rpcUrl: env.ROBINHOOD_RPC?.trim() || ROBINHOOD_CHAIN.rpcUrl });
  return { privy, executor, treasury: raw ? getAddress(raw) : null };
}

let cached: ReturnType<typeof robinhoodFromEnv> | null = null;
export function getRobinhood() {
  cached ??= robinhoodFromEnv();
  return cached;
}
