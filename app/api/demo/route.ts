import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { launchCx } from "@/lib/launch/request";
import { DemoCreateBody, DemoBasketBody } from "@/lib/demo/input";
import { DEMO } from "@/lib/demo/types";
import { demoCookie, walletDemoToken, matchesDemoWallet, readDemoToken, sameDemoOrigin, sessionHash, expiredDemoError } from "@/lib/demo/session";
import { PREVIEW_OWNER_HEADER, verifiedPreviewOwner } from "@/lib/demo/auth";
import { normalizeAddress } from "@/lib/agents/signature";
import { LAUNCH_HEADERS, LAUNCH_SIG_TTL_MS } from "@/lib/launch/auth";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { readLimitedJson } from "@/lib/server/body-limit";
import { mainnetTokenBalance } from "@/lib/server/mainnet";
import { mimirMint } from "@/lib/token-config";
import { tierFor, tierThresholdsFromEnv } from "@/lib/token-tiers";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, { status, headers: { "cache-control": "no-store", ...headers } });
const config = () => process.env.DEMO_ENABLED === "1" ? launchCx() : null;

export async function GET(request: Request) {
  if (!await allowRequest("demo-read", clientIp(request), 60, 60_000)) return tooManyRequests(60);
  const c = config();
  if (!c) return json({ enabled: false, error: "The preview is not enabled on this deployment." }, 503);
  const params = new URL(request.url).searchParams;
  if (params.get("view") === "directory") {
    const agent = params.get("agent") ?? undefined;
    if (agent && !/^[a-z0-9]{20,64}$/.test(agent)) return json({ error: "Unknown preview agent." }, 400);
    try {
      const result = await c.client.query(api.demo.directory, { ...(agent ? { agent } : {}) });
      if (agent && !result.agents.length) return json({ error: "Preview agent not found or expired." }, 404);
      return json({ enabled: true, ...result });
    } catch { return json({ error: "Preview agents are temporarily unavailable." }, 503); }
  }
  if (new URL(request.url).searchParams.get("view") === "showcase") {
    const key = new URL(request.url).searchParams.get("key") ?? undefined;
    if (key && !/^[a-z-]{2,20}$/.test(key)) return json({ error: "Unknown preview agent." }, 400);
    try { return json({ enabled: true, ...await c.client.query(api.demo.showcase, { ...(key ? { key } : {}) }) }); }
    catch { return json({ error: "Preview examples are temporarily unavailable." }, 503); }
  }
  const token = readDemoToken(request);
  const owner = normalizeAddress(request.headers.get(PREVIEW_OWNER_HEADER));
  if (!token || !owner || !matchesDemoWallet(token, owner, c.secret)) return json({ enabled: true, walletRequired: true, error: "Connect and verify your wallet to use Mimir Preview." }, 401);
  try {
    const detail = new URL(request.url).searchParams.get("agent") ?? undefined;
    if (detail && !/^[a-z0-9]{20,64}$/.test(detail)) return json({ error: "Unknown preview agent." }, 400);
    return json({ enabled: true, session: await c.client.query(api.demo.dashboard, { secret: c.secret, hash: sessionHash(token), ...(detail ? { detail } : {}) }), limits: DEMO });
  } catch (error) {
    return expiredDemoError(error) ? json({ error: "Your preview session expired. Start a new preview." }, 401)
      : json({ error: "Preview is temporarily unavailable. Refresh to try again." }, 503);
  }
}

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("session") }),
  z.object({ action: z.literal("agent"), input: DemoCreateBody }),
  z.object({ action: z.literal("basket"), input: DemoBasketBody }),
  z.object({ action: z.literal("trial"), source: z.string().regex(/^[a-z0-9]{20,64}$/), metric: z.enum(["stopLossPct", "minEdge"]), a: z.number().finite().min(3).max(50), b: z.number().finite().min(3).max(50) }),
  z.object({ action: z.literal("status"), id: z.string().regex(/^[a-z0-9]{20,64}$/), status: z.enum(["live", "paused", "killed"]) }),
]);

export async function POST(request: Request) {
  if (!sameDemoOrigin(request)) return json({ error: "Use the preview from this site." }, 403);
  if (!await allowRequest("demo-write", clientIp(request), 30, 60_000)) return tooManyRequests(60);
  const c = config();
  if (!c) return json({ error: "The preview is not enabled on this deployment." }, 503);
  const body = await readLimitedJson(request, 16_384);
  if (!body.ok) return json({ error: body.status === 413 ? "Request too large." : "Invalid JSON." }, body.status);
  const parsed = Action.safeParse(body.value);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid preview request." }, 400);
  const b = parsed.data;
  const owner = normalizeAddress(request.headers.get(PREVIEW_OWNER_HEADER));
  if (!owner) return json({ error: "Connect your wallet to use Mimir Preview." }, 401);
  let token = readDemoToken(request);
  try {
    if (b.action === "session") {
      if (verifiedPreviewOwner(request) !== owner) return json({ error: "Verify your wallet with a message signature." }, 401);
      const signature = request.headers.get(LAUNCH_HEADERS.signature)!;
      if (!await allowRequest("demo-wallet-signature", signature, 1, 2 * LAUNCH_SIG_TTL_MS)) return json({ error: "That signature was already used. Sign again." }, 409);
      token = walletDemoToken(owner, c.secret);
      const cookie = demoCookie(token, process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:");
      // Restoring an existing wallet does not consume the new-session IP allowance.
      try {
        await c.client.query(api.demo.dashboard, { secret: c.secret, hash: sessionHash(token) });
        return json({ ok: true }, 200, { "set-cookie": cookie });
      } catch (error) { if (!expiredDemoError(error)) throw error; }
      if (!await allowRequest("demo-session-ip", clientIp(request), 3, 86_400_000)) return tooManyRequests(3600);
      const mint = mimirMint();
      const balance = mint ? await mainnetTokenBalance(owner, mint).catch(() => 0) : 0;
      const mimirTier = tierFor({ mimir: balance, ansem: 0 }, tierThresholdsFromEnv());
      const result = await c.client.mutation(api.demo.createSession, { secret: c.secret, hash: sessionHash(token), owner, mimirTier });
      if ("error" in result) return json(result, 429);
      return json({ ok: true }, 201, { "set-cookie": cookie });
    }
    if (!matchesDemoWallet(token, owner, c.secret)) return json({ error: "Connect and verify your wallet first." }, 401);
    if (!token) return json({ error: "Verify your wallet first." }, 401);
    const credentials = { secret: c.secret, hash: sessionHash(token) };
    const result = b.action === "agent" ? await c.client.mutation(api.demo.createAgent, { ...credentials, input: b.input })
      : b.action === "trial" ? await c.client.mutation(api.demo.createTrial, { ...credentials, source: b.source as Id<"demoAgents">, metric: b.metric, a: b.a, b: b.b })
      : b.action === "basket" ? await c.client.mutation(api.demo.createBasket, { ...credentials, input: b.input })
      : await c.client.mutation(api.demo.setStatus, { ...credentials, id: b.id as Id<"demoAgents">, status: b.status });
    return json(result, "error" in result ? 409 : b.action === "status" ? 200 : 201);
  } catch (error) {
    console.warn("[preview] request failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "Preview request could not be completed. Refresh your session and try again." }, 503);
  }
}
