/**
 * POST /api/launch                 create an agent (signed by the owner, lib/launch/auth.ts): validate, make its Arc
 *                                  wallet, store it live. Free: nothing to fund first. Returns its id and Arc wallet.
 * GET  /api/launch?owner=<0x...>   that wallet's agents (public views).
 */
import { api } from "@/convex/_generated/api";
import { circleBlockchain } from "@/lib/chains/house";
import { MARKET_CHAINS } from "@/lib/chains/registry";
import { normalizeOwner } from "@/lib/owner";
import { checkKey } from "@/lib/launch/byok";
import { CreateBody, create } from "@/lib/launch/flow";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { ARC } from "@/lib/arc/config";
import { createHostedWallet } from "@/lib/solana/hosted-wallet";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!(await allowRequest("launch-read", clientIp(req), 60, 60_000))) return tooManyRequests(60);
  const owner = normalizeOwner(new URL(req.url).searchParams.get("owner"));
  if (!owner) return fail(400, "owner must be a Solana public key");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  return Response.json({ agents: await c.client.query(api.launch.byOwner, { owner }) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (!(await allowRequest("launch-create-ip", clientIp(req), 10, 60 * 60_000))) return tooManyRequests(600);
  const g = await readSigned(req, "create", "new", 32 * 1024);
  if (!g.ok) return g.res;
  if (!(await allowRequest("launch-create", g.owner, 5, 60 * 60_000))) return fail(429, "Too many agents this hour.");
  const parsed = CreateBody.safeParse(g.body);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid agent.");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  try {
    const r = await create(c, {
      checkKey: (p, k, m) => checkKey(p, k, m),
      wallets: { solana: async () => createHostedWallet() },
    }, g.owner, parsed.data);
    if (!r.ok) return fail(r.status, r.error);
    return Response.json({ id: r.id, solana: r.solana, arc: null, base: null });
  } catch (e) {
    console.error("[launch] create failed:", e);
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("LAUNCH_BYOK_SECRET")) return fail(503, "Own API keys are not configured on this server yet. Use Mimir AI for now.");
    if (msg.includes("does not look like an API key")) return fail(400, "That does not look like an API key.");
    return fail(502, "Could not create the agent's wallet. Try again.");
  }
}
