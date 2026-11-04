declare const policy: {
  deployment: Readonly<{
    cluster: "devnet";
    genesisHash: string;
    programId: string;
    usdcMint: string;
    rpc: string;
    erRpc: string;
    erWs: string;
    erValidator: string;
    siteUrl: string;
  }>;
  assertDevnetEnv(env: Record<string, string | undefined>): void;
  assertDevnetRpcUrl(name: string, raw: string): string;
};
export = policy;
