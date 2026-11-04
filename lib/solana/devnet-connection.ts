import { Connection, type ConnectionConfig } from "@solana/web3.js";
import { deployment, assertDevnetRpcUrl } from "../../config/solana-devnet.cjs";

const checked = new Map<string, Promise<void>>();

/** Verify the actual ledger, including custom RPC providers, before any signing. */
export async function assertDevnetGenesis(endpoint: string): Promise<void> {
  assertDevnetRpcUrl("Solana RPC", endpoint);
  let check = checked.get(endpoint);
  if (!check) {
    check = (async () => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash" }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("Solana devnet RPC verification failed");
      const result = await response.json();
      if (result.result !== deployment.genesisHash) {
        throw new Error("Refusing RPC: its ledger is not Solana devnet");
      }
    })().catch((error) => {
      checked.delete(endpoint);
      throw error;
    });
    checked.set(endpoint, check);
  }
  await check;
}

/** RPC calls also verify the ledger when used by a read-only API or provider. */
export function devnetConnectionConfig(endpoint: string, config: ConnectionConfig = {}): ConnectionConfig {
  return {
    commitment: "confirmed",
    ...config,
    fetch: async (input, init) => {
      await assertDevnetGenesis(endpoint);
      return (config.fetch ?? fetch)(input, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(20_000),
      });
    },
  };
}

export function createDevnetConnection(endpoint: string, config?: ConnectionConfig): Connection {
  return new Connection(endpoint, devnetConnectionConfig(endpoint, config));
}
