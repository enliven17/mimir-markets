/**
 * Shared gates for the public LLM routes (claim-moderation, claim-draft,
 * council/*): a per-caller limit plus a deploy-wide ceiling, so rotating IPs
 * cannot drain the shared LLM quota (audit P0-6), and bounded inputs
 * (audit P1-10).
 */
import { MAX_URL_BYTES } from "@/lib/agents/params";
import { allowRequest, envLimit, networkOf } from "./rate-limit";

/**
 * True when the caller is within both its own limit and the deploy-wide one.
 * The global ceiling reads `<globalEnv>` (requests/minute), else the default.
 */
export async function allowLlmRequest(args: {
  bucket: string;
  key: string;
  perKey: number;
  globalEnv: string;
  globalDefault: number;
  pool?: string;
}): Promise<boolean> {
  if (!(await allowRequest(args.bucket, args.key, args.perKey, 60_000))) return false;
  const global = envLimit(args.globalEnv, args.globalDefault);
  // No single network (IPv4 /24, IPv6 /48) may take more than a fifth of the shared ceiling, so a handful of
  // addresses cannot lock everyone else out of it.
  const share = Math.max(args.perKey, Math.ceil(global / 5));
  if (!(await allowRequest(`${args.bucket}-net`, networkOf(args.key), share, 60_000))) return false;
  return allowRequest(`${args.bucket}-global`, args.pool ?? "all", global, 60_000);
}

/** claim-draft body: a source URL (it becomes the on-chain resolution URL) and a locale. */
export function parseClaimDraftBody(raw: unknown): { url: string; locale: string } | { error: string } {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const locale = typeof body.locale === "string" ? body.locale.trim().slice(0, 16) : "en";
  if (!url) return { error: "url is required" };
  if (Buffer.byteLength(url, "utf8") > MAX_URL_BYTES) return { error: `url is over ${MAX_URL_BYTES} bytes` };
  return { url, locale: locale || "en" };
}
