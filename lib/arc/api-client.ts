/**
 * Browser calls to Mimir's own Arc routes. Small on purpose: no SDKs.
 */
import type { AttestationResult } from "./iris";

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`);
  return body;
}

export async function fetchAttestation(domain: number, tx: string): Promise<AttestationResult> {
  return json<AttestationResult>(await fetch(`/api/arc/attestation?domain=${domain}&tx=${encodeURIComponent(tx)}`, { cache: "no-store" }));
}

/** Fast-transfer fee for Solana → Arc, in basis points. */
export async function fetchDepositFeeBps(): Promise<number> {
  const { bps } = await json<{ bps: number }>(await fetch("/api/arc/fee", { cache: "no-store" }));
  return bps;
}

export interface ArcBinding {
  solana: string;
  arc: `0x${string}`;
  boundAt: number;
}

export async function fetchBinding(solana: string): Promise<ArcBinding | null> {
  const res = await fetch(`/api/arc/bind?solana=${encodeURIComponent(solana)}`, { cache: "no-store" });
  if (res.status === 404) return null;
  return (await json<{ binding: ArcBinding }>(res)).binding;
}

export async function postBinding(body: {
  solana: string;
  arc: string;
  signedAt: number;
  solanaSignature: string;
  arcSignature: string;
  credentialId: string | null;
}): Promise<ArcBinding> {
  const res = await fetch("/api/arc/bind", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await json<{ binding: ArcBinding }>(res)).binding;
}
