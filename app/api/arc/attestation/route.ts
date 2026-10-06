/**
 * GET /api/arc/attestation?domain=<5|26>&tx=<burn tx>
 *
 * Proxy to Circle's attestation service (Iris) for one CCTP V2 burn, so the
 * browser polls same-origin. Public data, no secrets. Answers
 * `{ status: "pending" }` until Iris has the attested message, then
 * `{ status: "complete", message, attestation }`.
 */
import { NextResponse } from "next/server";

import { ARC } from "@/lib/arc/config";
import { irisMessagesUrl, isSupportedDomain, isValidBurnTx, parseIrisMessages } from "@/lib/arc/iris";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // A transfer polls every 4 s for up to a few minutes.
  if (!(await allowRequest("arc-attestation", clientIp(req), 60, 60_000))) return tooManyRequests(30);
  const url = new URL(req.url);
  const domain = Number(url.searchParams.get("domain"));
  const tx = url.searchParams.get("tx")?.trim() ?? "";
  if (!isSupportedDomain(domain)) return NextResponse.json({ error: "domain must be 5 (Solana) or 26 (Arc)" }, { status: 400 });
  if (!isValidBurnTx(domain, tx)) return NextResponse.json({ error: "tx is not a transaction id for that domain" }, { status: 400 });
  try {
    const res = await fetch(irisMessagesUrl(ARC.cctp.irisUrl, domain, tx), {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    // Iris answers 404 until it has seen the burn: that is "pending", not an error.
    if (res.status === 404) return NextResponse.json({ status: "pending" }, { headers: { "cache-control": "no-store" } });
    if (!res.ok) return NextResponse.json({ error: `the attestation service answered ${res.status}` }, { status: 502 });
    return NextResponse.json(parseIrisMessages(await res.json()), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.warn("[arc-attestation] Iris unreachable:", err);
    return NextResponse.json({ error: "the attestation service is not reachable" }, { status: 502 });
  }
}
