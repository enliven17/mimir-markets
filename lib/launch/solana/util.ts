// Shared helpers for the Solana layer: typed provider errors, boundary validation, exact
// lamport/token formatting (no floating point for accounting), fetch with timeout.
import bs58 from "bs58";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export type Provider = "privy" | "pumpportal" | "pinata" | "jupiter" | "solana" | "robinhood" | "meteora" | "base";

export class SolanaError extends Error {
  readonly provider: Provider;
  readonly status: number | null;
  readonly code: string | null;
  /** True only when the transaction can be proven to have NOT landed (safe to rebuild and resend). */
  readonly notLanded: boolean;

  constructor(provider: Provider, message: string, o: { status?: number | null; code?: string | null; notLanded?: boolean } = {}) {
    super(`${provider}: ${message}`);
    this.name = "SolanaError";
    this.provider = provider;
    this.status = o.status ?? null;
    this.code = o.code ?? null;
    this.notLanded = o.notLanded ?? false;
  }
}

/** Broadcast happened (or may have) and the outcome could not be determined. Never resend. */
export class AmbiguousSendError extends SolanaError {
  readonly sig: string;
  constructor(sig: string, message: string) {
    super("solana", `${message} (sig ${sig}); outcome unknown, do NOT resend, reconcile by signature`);
    this.name = "AmbiguousSendError";
    this.sig = sig;
  }
}

/** Landed on chain but the program returned an error (fees were paid, no trade happened). */
export class TxFailedError extends SolanaError {
  readonly sig: string;
  constructor(sig: string, err: unknown) {
    super("solana", `transaction ${sig} failed on chain: ${JSON.stringify(err)}`, { code: "TX_FAILED" });
    this.name = "TxFailedError";
    this.sig = sig;
  }
}

export function assertAddress(name: string, value: unknown): string {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    throw new SolanaError("solana", `${name} is not a base58 address`, { code: "BAD_INPUT" });
  }
  if (bs58.decode(value).length !== 32) throw new SolanaError("solana", `${name} is not a 32-byte address`, { code: "BAD_INPUT" });
  return value;
}

export function assertPositive(name: string, value: unknown): bigint {
  if (typeof value !== "bigint" || value <= BigInt(0)) {
    throw new SolanaError("solana", `${name} must be a positive bigint`, { code: "BAD_INPUT" });
  }
  return value;
}

export function assertSlippageBps(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 5000) {
    throw new SolanaError("solana", "slippageBps must be an integer in 1..5000", { code: "BAD_INPUT" });
  }
  return value as number;
}

/** Exact decimal string of `raw / 10^decimals` (e.g. 1500000n, 9 -> "0.0015"). */
export function toDecimal(raw: bigint, decimals: number): string {
  const neg = raw < BigInt(0);
  const s = (neg ? -raw : raw).toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

/**
 * Number for APIs that take whole SOL/tokens (PumpPortal). Only a request parameter: fills are
 * always measured from the confirmed transaction, never from this value.
 */
export function toApiAmount(raw: bigint, decimals: number): number {
  return Number(toDecimal(raw, decimals));
}

export function redact(text: string, secrets: (string | undefined)[]): string {
  return secrets.reduce<string>((t, s) => (s ? t.split(s).join("***") : t), text);
}

/** fetch with an abort timeout; network failures become SolanaError(provider, status null). */
export async function fetchWithTimeout(doFetch: FetchLike, provider: Provider, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await doFetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    const why = ctrl.signal.aborted ? `timeout after ${timeoutMs}ms` : `network error: ${err instanceof Error ? err.message : String(err)}`;
    throw new SolanaError(provider, why);
  } finally {
    clearTimeout(timer);
  }
}

export async function errorBody(res: Response, secrets: (string | undefined)[] = []): Promise<string> {
  return redact(await res.text().catch(() => ""), secrets).slice(0, 300);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
