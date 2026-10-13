/**
 * GET /api/launch/:id/detail: an agent's full page (reasoning log, Solana trades and PnL, Arc stakes and their
 * outcomes) for $MIMIR holders ($MIMIR only: lib/launch/copy-gate.ts). The wallet is proven with the signed holder proof headers (lib/token-proof.ts); its
 * mainnet balance decides. Anyone else gets 403 with `gate: true` and the page shows how to get in.
 */
import { api } from "@/convex/_generated/api";
import { COUNCIL_AGENTS } from "@/lib/launch/council-view";
import { fail, launchCx } from "@/lib/launch/request";
import { holdsMimir, type Holding } from "@/lib/launch/copy-gate";
import { provenWallet } from "@/lib/server/holder";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const GATE = "Hold $MIMIR to see this agent's reasoning, trades and performance.";
/** A wallet's answer for a minute, so page loads do not re-read mainnet; only fresh reads count against the IP. */
const recent = new Map<string, { h: Holding; until: number }>();

async function holding(req: Request, wallet: string): Promise<Holding | "limited"> {
  const hit = recent.get(wallet);
  if (hit && hit.until > Date.now()) return hit.h;
  // Every fresh wallet costs mainnet RPC reads: cap them per IP (as lib/server/holder.ts provenTier does).
  if (!(await allowRequest("launch-holder-proof", clientIp(req), 20, 60_000))) return "limited";
  const h = await holdsMimir(wallet);
  if (h !== "unknown") {
    recent.set(wallet, { h, until: Date.now() + 60_000 });
    if (recent.size > 5_000) recent.delete(recent.keys().next().value!);
  }
  return h;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await allowRequest("launch-detail", clientIp(req), 60, 60_000))) return tooManyRequests(60);
  const { id } = await ctx.params;
  const wallet = provenWallet(req);
  if (!wallet) return Response.json({ error: GATE, gate: true }, { status: 403 });
  const h = await holding(req, wallet);
  if (h === "limited") return tooManyRequests(60);
  if (h === "unknown") return fail(503, "Could not read your $MIMIR balance. Try again.");
  if (h === "no") return Response.json({ error: GATE, gate: true }, { status: 403 });
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  const council = COUNCIL_AGENTS[id];
  const agent = council ? null : await c.client.query(api.launch.detail, { secret: c.secret, slug: id });
  if (!council && !agent) return fail(404, "No such agent.");
  const arcAddress = council?.arc ?? agent?.arc ?? null;
  const arc = arcAddress ? await c.client.query(api.launch.arcRecord, { secret: c.secret, address: arcAddress }) : [];
  return Response.json({ agent, arc }, { headers: { "cache-control": "no-store" } });
}
