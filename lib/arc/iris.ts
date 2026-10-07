/**
 * Circle's attestation service (Iris) for CCTP V2: input checks, response
 * parsing, the fast-transfer fee and a poller. Pure and isomorphic; the
 * browser goes through /api/arc/attestation and /api/arc/fee (no CORS
 * surprises, one place to rate-limit), node scripts may call Iris directly.
 */
import { ARC_DOMAIN, FINALITY_FAST, SOLANA_DOMAIN } from "./config";

export type AttestationResult =
  | { status: "pending" }
  | { status: "complete"; message: `0x${string}`; attestation: `0x${string}` };

const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const EVM_TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const HEX = /^0x[0-9a-fA-F]+$/;

export function isSupportedDomain(domain: number): boolean {
  return domain === SOLANA_DOMAIN || domain === ARC_DOMAIN;
}

/** A burn tx id in the source chain's format: a base58 signature on Solana, a 32-byte hash on Arc. */
export function isValidBurnTx(domain: number, tx: string): boolean {
  if (domain === SOLANA_DOMAIN) return SOLANA_SIGNATURE.test(tx);
  if (domain === ARC_DOMAIN) return EVM_TX_HASH.test(tx);
  return false;
}

export function irisMessagesUrl(irisUrl: string, domain: number, tx: string): string {
  return `${irisUrl}/v2/messages/${domain}?transactionHash=${encodeURIComponent(tx)}`;
}

export function irisFeesUrl(irisUrl: string, source: number, dest: number): string {
  return `${irisUrl}/v2/burn/USDC/fees/${source}/${dest}`;
}

/** The first message of an Iris `/v2/messages` body: complete with both hex blobs, else pending. */
export function parseIrisMessages(body: unknown): AttestationResult {
  const m = (body as { messages?: Array<Record<string, unknown>> } | null)?.messages?.[0];
  const message = typeof m?.message === "string" ? m.message : "";
  const attestation = typeof m?.attestation === "string" ? m.attestation : "";
  if (m?.status === "complete" && HEX.test(message) && HEX.test(attestation)) {
    return { status: "complete", message: message as `0x${string}`, attestation: attestation as `0x${string}` };
  }
  return { status: "pending" };
}

/** The fast-transfer minimum fee in basis points (may be fractional), or null. */
export function parseFastFeeBps(body: unknown): number | null {
  const list = Array.isArray(body) ? body : ((body as { data?: unknown[] } | null)?.data ?? []);
  const fast = (list as Array<Record<string, unknown>>).find((f) => Number(f?.finalityThreshold) === FINALITY_FAST);
  const bps = Number(fast?.minimumFee);
  return Number.isFinite(bps) && bps >= 0 && bps <= 10_000 ? bps : null;
}

/** Headroom above the quoted fee, in base units: the quote can move between the read and the burn. */
export const FEE_HEADROOM_UNITS = 100n;

/** The `maxFee` for a fast burn of `amount` base units at `bps`: rounded up, plus headroom. */
export function fastMaxFee(amount: bigint, bps: number): bigint {
  const centiBps = BigInt(Math.ceil(bps * 100));
  const fee = (amount * centiBps + 999_999n) / 1_000_000n;
  return fee + FEE_HEADROOM_UNITS;
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Call `check` until it reports complete; throws on timeout or abort. */
export async function pollAttestation(
  check: () => Promise<AttestationResult>,
  { intervalMs = 4000, timeoutMs = 20 * 60_000, signal }: PollOptions = {},
): Promise<Extract<AttestationResult, { status: "complete" }>> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (signal?.aborted) throw new Error("cancelled");
    const result = await check().catch((): AttestationResult => ({ status: "pending" }));
    if (result.status === "complete") return result;
    if (Date.now() + intervalMs > until) throw new Error("the attestation did not arrive in time; try again later");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
