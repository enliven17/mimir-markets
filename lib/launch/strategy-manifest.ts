import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b, "en")).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}
/** Callers project strategy settings explicitly. Never hash secrets or a sealed API key. */
export function strategyFingerprint(settings: { thesis: string; chain: string; trading: unknown; markets: unknown; model: string }): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonical(settings))));
}
export type StrategySnapshot = { revision: number; fingerprint: string; at: number; model?: string; parent?: string; trial?: string; variant?: string };
