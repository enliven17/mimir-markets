/**
 * Mimir Launch: the Base layer from server env. Lazy: importing never throws.
 * Env: PRIVY_APP_ID / PRIVY_APP_SECRET / PRIVY_AUTHORIZATION_KEY (shared with Solana and Robinhood), BASE_RPC_URL
 * (else the public endpoint), BASE_BUILDER_CODE (optional ERC-8021 attribution), LAUNCH_BASE_TREASURY (optional 0x
 * address the wallet policy also lets it pay).
 */
import { getAddress, isAddress } from "viem";

import { builderSuffixFromEnv } from "../../base/builder-code";
import { baseRpcUrl } from "../../base/chain";
import { createPrivy } from "../solana/privy";
import { SolanaError } from "../solana/util";
import { createBaseExecutor } from "./executor";

type Env = Record<string, string | undefined>;

export function baseFromEnv(env: Env = process.env) {
  const privy = createPrivy({ appId: env.PRIVY_APP_ID ?? "", appSecret: env.PRIVY_APP_SECRET ?? "", authKey: env.PRIVY_AUTHORIZATION_KEY || undefined });
  if (!env.PRIVY_AUTHORIZATION_KEY && env.NODE_ENV === "production") {
    throw new SolanaError("privy", "PRIVY_AUTHORIZATION_KEY is required in production (wallet/policy owner)", { code: "CONFIG" });
  }
  const raw = env.LAUNCH_BASE_TREASURY?.trim();
  if (raw && !isAddress(raw)) throw new SolanaError("base", "LAUNCH_BASE_TREASURY must be a 0x address", { code: "CONFIG" });
  const executor = createBaseExecutor({ privy, rpcUrl: baseRpcUrl(env), builderSuffix: builderSuffixFromEnv(env.BASE_BUILDER_CODE) });
  return { privy, executor, treasury: raw ? getAddress(raw) : null };
}

let cached: ReturnType<typeof baseFromEnv> | null = null;
export function getBase() {
  cached ??= baseFromEnv();
  return cached;
}
