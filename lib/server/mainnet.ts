/**
 * Read-only Solana MAINNET helpers for the Mimir token and $ANSEM.
 *
 * The app and program run on devnet; only token utility reads mainnet, over
 * its own RPC (`SOLANA_MAINNET_RPC`, default the public endpoint; a Helius
 * URL works too). Plain JSON-RPC over fetch with a timeout, cached per
 * instance so a page view never fans out into many RPC calls.
 *
 * Token-2022 aware: pump.fun mints can be Token-2022 (ANSEM is). The `mint`
 * filter on getTokenAccountsByOwner (jsonParsed; web3.js calls it
 * getParsedTokenAccountsByOwner) lets the RPC pick the mint's own
 * program, so one call covers both programs.
 */
import { cachedFor } from "./ttl-cache";

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const TIMEOUT_MS = Number(process.env.SOLANA_MAINNET_RPC_TIMEOUT_MS ?? "8000");
const BALANCE_TTL_MS = 60_000;
const SUPPLY_TTL_MS = 5 * 60_000;

function rpcUrl(): string {
  const url = process.env.SOLANA_MAINNET_RPC?.trim();
  return url && /^https:\/\//.test(url) ? url : DEFAULT_RPC;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`mainnet rpc ${method} → HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error || body.result === undefined) throw new Error(`mainnet rpc ${method} failed`);
  return body.result;
}

interface ParsedTokenAccounts {
  value: Array<{
    account: { data: { parsed?: { info?: { tokenAmount?: { amount?: string; decimals?: number } } } } };
  }>;
}

/** Sum of an owner's token accounts for a mint, in UI units. Pure; exported for tests. */
export function sumParsedBalances(result: ParsedTokenAccounts): number {
  let raw = BigInt(0);
  let decimals = 0;
  for (const acc of result.value ?? []) {
    const amt = acc.account?.data?.parsed?.info?.tokenAmount;
    if (!amt?.amount || !/^\d+$/.test(amt.amount)) continue;
    raw += BigInt(amt.amount);
    decimals = Number(amt.decimals ?? decimals);
  }
  return Number(raw) / 10 ** decimals;
}

async function readTokenBalance(owner: string, mint: string): Promise<number> {
  const result = await rpc<ParsedTokenAccounts>("getTokenAccountsByOwner", [
    owner,
    { mint },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  return sumParsedBalances(result);
}

/** An owner's balance of a mainnet mint in whole tokens. Throws when the RPC is down. */
export const mainnetTokenBalance = cachedFor(readTokenBalance, BALANCE_TTL_MS);

export interface MintSupply {
  supply: number;
  decimals: number;
}

async function readMintSupply(mint: string): Promise<MintSupply> {
  const result = await rpc<{ value: { amount: string; decimals: number } }>("getTokenSupply", [
    mint,
    { commitment: "confirmed" },
  ]);
  const decimals = Number(result.value.decimals);
  return { supply: Number(BigInt(result.value.amount)) / 10 ** decimals, decimals };
}

/** A mint's circulating supply and decimals. Throws when the RPC is down. */
export const mainnetMintSupply = cachedFor(readMintSupply, SUPPLY_TTL_MS);
