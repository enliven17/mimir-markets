/**
 * Native Arc sign-in (lib/arc/evm.ts).
 * GET  /api/arc/evm-bind?evm=0x…   the passkey account bound to that Arc wallet, 404 when none
 * GET  /api/arc/evm-bind?arc=0x…   the Arc wallet a passkey account is bound to, 404 when none
 * POST /api/arc/evm-bind           { evm, arc, signedAt, evmSignature, arcSignature, credentialId? }
 *
 * Both signatures cover `arcEvmBindMessage(evm, arc, signedAt)`: the wallet's proves who is binding, the passkey
 * account's proves the account is theirs. Invite-only: the wallet must be let in first (an invite code).
 */
import { NextResponse } from "next/server";
import { verifyMessage, type Address, type Hex } from "viem";

import { arcPublicClient } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { checkArcEvmBindBody, normalizeEvmAddress } from "@/lib/arc/evm";
import { hasAccess } from "@/lib/server/access";
import { ArcRebindTooSoonError, verifyArcSignature } from "@/lib/server/arc-accounts";
import { ArcEvmAccountTakenError, getArcEvmBinding, getArcEvmBindingByArc, upsertArcEvmBinding } from "@/lib/server/arc-evm-accounts";
import { readLimitedJson } from "@/lib/server/body-limit";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { storeEnabled } from "@/lib/server/store";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = { error: "Arc accounts need a database on this deploy" };

/** A plain wallet's signature recovers locally; a smart wallet's (ERC-1271) is checked on Arc. */
async function walletSigned(address: Address, message: string, signature: Hex): Promise<boolean> {
  if (await verifyMessage({ address, message, signature }).catch(() => false)) return true;
  return arcPublicClient(ARC).verifyMessage({ address, message, signature }).catch(() => false);
}

export async function GET(req: Request) {
  if (!(await allowRequest("arc-evm-bind-read", clientIp(req), 60, 60_000))) return tooManyRequests(60);
  const params = new URL(req.url).searchParams;
  const arc = normalizeEvmAddress(params.get("arc"));
  const evm = arc ? null : normalizeEvmAddress(params.get("evm"));
  if (!arc && !evm) return NextResponse.json({ error: "evm or arc must be an EVM address" }, { status: 400 });
  if (!storeEnabled()) return NextResponse.json(NOT_CONFIGURED, { status: 503 });
  try {
    const binding = arc ? await getArcEvmBindingByArc(arc) : await getArcEvmBinding(evm!);
    if (!binding) return NextResponse.json({ error: "no binding" }, { status: 404 });
    return NextResponse.json({ binding }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[arc-evm-bind] read failed:", err);
    return NextResponse.json({ error: "the binding could not be read" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (!(await allowRequest("arc-evm-bind", clientIp(req), 10, 60_000))) return tooManyRequests(60);
  if (!(await allowRequest("arc-evm-bind-day", clientIp(req), 20, 86_400_000))) return tooManyRequests(3600);
  const read = await readLimitedJson(req);
  if (!read.ok || !read.value || typeof read.value !== "object") {
    return NextResponse.json({ error: "body must be a JSON object" }, { status: read.ok ? 400 : read.status });
  }
  const check = checkArcEvmBindBody(read.value as Record<string, unknown>);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  if (!storeEnabled()) return NextResponse.json(NOT_CONFIGURED, { status: 503 });

  const { request, message } = check;
  if (!(await walletSigned(request.evm, message, request.evmSignature))) {
    return NextResponse.json({ error: "the wallet signature does not match" }, { status: 401 });
  }
  const arcOk = await verifyArcSignature(request.arc, message, request.arcSignature);
  if (arcOk === null) return NextResponse.json({ error: "Arc is not reachable right now, try again" }, { status: 503 });
  if (!arcOk) return NextResponse.json({ error: "the passkey account signature does not match" }, { status: 401 });
  if (!(await hasAccess(request.evm).catch(() => false))) {
    return NextResponse.json({ error: "Mimir is invite-only right now: redeem an invite code first." }, { status: 403 });
  }

  try {
    const binding = await upsertArcEvmBinding({ evm: request.evm, arc: request.arc, credentialId: request.credentialId });
    return NextResponse.json({ binding });
  } catch (err) {
    if (err instanceof ArcEvmAccountTakenError) return NextResponse.json({ error: err.message }, { status: 409 });
    if (err instanceof ArcRebindTooSoonError) return NextResponse.json({ error: err.message, retryAt: err.retryAt }, { status: 429 });
    console.error("[arc-evm-bind] write failed:", err);
    return NextResponse.json({ error: "the binding could not be saved" }, { status: 503 });
  }
}
