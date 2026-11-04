// Shared by Next's build configuration, the browser and the worker fleet.
const deployment = Object.freeze({
  cluster: "devnet",
  genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  programId: "EnLyMg9fBhgvKcWVAyD1YKv3i2BbLejfRFb5hEXur1WE",
  usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  rpc: "https://api.devnet.solana.com",
  erRpc: "https://devnet-as.magicblock.app/",
  erWs: "wss://devnet-as.magicblock.app/",
  erValidator: "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57",
  siteUrl: "https://solana.mimirmarkets.xyz",
});

function assertDevnetRpcUrl(name, raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      /mainnet|testnet/i.test(url.hostname + url.pathname + url.search)) {
    throw new Error(`${name} must be an HTTPS Solana devnet endpoint`);
  }
  return raw;
}

function assertDevnetEnv(env) {
  for (const name of ["MARKET_CHAINS", "NEXT_PUBLIC_MARKET_CHAINS"]) {
    if (env[name]?.trim() && env[name].trim() !== "solana") throw new Error(`${name}: Solana devnet only`);
  }
  for (const name of ["CONVEX_DEPLOYMENT", "NEXT_PUBLIC_CONVEX_URL", "CONVEX_URL"]) {
    const value = env[name]?.trim();
    if (value && !(name === "CONVEX_DEPLOYMENT"
      ? /^(dev:posh-tiger-261|prod:warmhearted-hummingbird-752)$/.test(value)
      : /^https:\/\/(posh-tiger-261|warmhearted-hummingbird-752)\.convex\.cloud\/?$/.test(value))) {
      throw new Error(`${name}: use the dedicated Solana Convex project`);
    }
  }
  for (const name of ["BASE_NETWORK", "NEXT_PUBLIC_BASE_NETWORK"]) {
    if (env[name]?.trim()) {
      throw new Error(`${name}: use a dedicated Solana deployment environment`);
    }
  }
  for (const name of ["NEXT_PUBLIC_SOLANA_CLUSTER", "SOLANA_CLUSTER"]) {
    if (env[name]?.trim() && env[name].trim() !== deployment.cluster) {
      throw new Error(`${name}: the solana branch supports Solana devnet only`);
    }
  }
  const pinned = {
    NEXT_PUBLIC_MIMIR_PROGRAM_ID: deployment.programId,
    SOLANA_USDC_MINT: deployment.usdcMint,
    NEXT_PUBLIC_SOLANA_USDC_MINT: deployment.usdcMint,
    MAGICBLOCK_ER_VALIDATOR: deployment.erValidator,
    NEXT_PUBLIC_SITE_URL: deployment.siteUrl,
  };
  for (const [name, expected] of Object.entries(pinned)) {
    if (env[name]?.trim() && env[name].trim().replace(/\/+$/, "") !== expected) {
      throw new Error(`${name} does not match the isolated Solana devnet deployment`);
    }
  }
  for (const name of ["SOLANA_RPC", "NEXT_PUBLIC_SOLANA_RPC", "AGENT_PUBLIC_RPC"]) {
    if (env[name]?.trim()) assertDevnetRpcUrl(name, env[name].trim());
  }
  // Delegation validator and regional endpoint must agree in browser and workers.
  for (const name of ["MAGICBLOCK_ER_RPC", "NEXT_PUBLIC_MAGICBLOCK_ER_RPC", "AGENT_PUBLIC_ER_RPC", "MAGICBLOCK_ER_WS"]) {
    const expected = name === "MAGICBLOCK_ER_WS" ? deployment.erWs : deployment.erRpc;
    if (env[name]?.trim() && env[name].trim().replace(/\/+$/, "") !== expected.replace(/\/+$/, "")) {
      throw new Error(`${name} must use this deployment's Solana devnet rollup`);
    }
  }
  if (env.HEDGE_MODE?.trim() && env.HEDGE_MODE.trim() !== "off") {
    throw new Error("HEDGE_MODE must be off: mainnet hedging is unavailable on the solana branch");
  }
  if (env.NEXT_PUBLIC_MIMIR_TOKEN_MINT?.trim() || env.SOLANA_MAINNET_RPC?.trim()) {
    throw new Error("Mainnet token settings are unavailable on the solana branch");
  }
}

module.exports = { deployment, assertDevnetEnv, assertDevnetRpcUrl };
