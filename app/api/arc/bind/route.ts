/**
 * GET  /api/arc/bind?solana=<base58>  the Arc account bound to that wallet (public info), 404 when none
 * GET  /api/arc/bind?arc=<0x…>         the wallet that Arc account is bound to, 404 when none
 * POST /api/arc/bind                  { solana, arc, signedAt, solanaSignature, arcSignature, credentialId? }
 *
 * Both signatures cover `arcBindMessage(solana, arc, signedAt)` (lib/arc/bind.ts):
 * the Solana wallet's proves who is binding, the passkey account's proves the
 * Arc account is theirs. signedAt must be within 5 minutes of server time.
 * A wallet maps to one Arc account; rebinding needs a new pair of signatures.
 */
import { NextResponse } from "next/server";

import { normalizeAddress } from "@/lib/agents/signature";
import { checkArcBindBody } from "@/lib/arc/bind";
import { accountHasAccess } from "@/lib/server/access";
import { getAddress, isAddress } from "viem";

import { ArcAccountTakenError, ArcRebindTooSoonError, getArcBinding, getArcBindingByArc, upsertArcBinding, verifyArcSignature } from "@/lib/server/arc-accounts";
import { readLimitedJson } from "@/lib/server/body-limit";
import { storeEnabled } from "@/lib/server/store";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = { error: "Arc accounts need a database on this deploy" };

export async function GET(req: Request) {
  if (!(await allowRequest("arc-bind-read", clientIp(req), 60, 60_000))) return tooManyRequests(60);
  const params = new URL(req.url).searchParams;
  const arcParam = params.get("arc");
  const arc = arcParam && isAddress(arcParam) ? getAddress(arcParam) : null;
  const solana = arc ? null : normalizeAddress(params.get("solana"));
  if (arcParam && !arc) return NextResponse.json({ error: "arc must be an EVM address" }, { status: 400 });
  if (!arc && !solana) return NextResponse.json({ error: "solana must be a Solana public key" }, { status: 400 });
  if (!storeEnabled()) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  try {
    const binding = arc ? await getArcBindingByArc(arc) : await getArcBinding(solana!);
    if (!binding) return NextResponse.json({ error: "no Arc account is bound to this wallet" }, { status: 404 });
    return NextResponse.json({ binding }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[arc-bind] read failed:", err);
    return NextResponse.json({ error: "the binding could not be read" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (!(await allowRequest("arc-bind", clientIp(req), 10, 60_000))) return tooManyRequests(60);
  // Links per address per day: new accounts are free to make, so cap how many one address can link.
  if (!(await allowRequest("arc-bind-day", clientIp(req), 20, 86_400_000))) return tooManyRequests(3600);
  const read = await readLimitedJson(req);
  if (!read.ok || !read.value || typeof read.value !== "object") {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: read.ok ? 400 : read.status });
  }
  const check = checkArcBindBody(read.value as Record<string, unknown>);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  if (!storeEnabled()) return NextResponse.json(NOT_CONFIGURED, { status: 503 });

  const { request, message } = check;
  const arcOk = await verifyArcSignature(request.arc, message, request.arcSignature);
  if (arcOk === null) return NextResponse.json({ error: "Arc is not reachable right now, try again" }, { status: 503 });
  if (!arcOk) return NextResponse.json({ error: "the Arc account signature does not match" }, { status: 401 });
  // Invite-only: the wallet must be let in first, or (native Arc sign-in, linking a Solana wallet for $MIMIR perks)
  // the account's Arc wallet must be (lib/server/access.ts).
  if (!(await accountHasAccess(request.arc, request.solana).catch(() => false))) {
    return NextResponse.json({ error: "Mimir is invite-only right now: redeem an invite code first." }, { status: 403 });
  }

  try {
    const binding = await upsertArcBinding({ solana: request.solana, arc: request.arc, credentialId: request.credentialId });
    return NextResponse.json({ binding });
  } catch (err) {
    if (err instanceof ArcAccountTakenError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof ArcRebindTooSoonError) return NextResponse.json({ error: err.message, retryAt: err.retryAt }, { status: 429 });
    console.error("[arc-bind] write failed:", err);
    return NextResponse.json({ error: "the binding could not be saved" }, { status: 503 });
  }
}
