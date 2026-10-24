import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { launchCx } from "@/lib/launch/request";
import { DemoCreateBody, DemoBasketBody } from "@/lib/demo/input";
import { DEMO } from "@/lib/demo/types";
import { demoCookie, newDemoToken, readDemoToken, sameDemoOrigin, sessionHash, expiredDemoError } from "@/lib/demo/session";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { readLimitedJson } from "@/lib/server/body-limit";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(value, { status, headers: { "cache-control": "no-store", ...headers } });
const config = () => process.env.DEMO_ENABLED === "1" ? launchCx() : null;

export async function GET(request: Request) {
  if (!await allowRequest("demo-read", clientIp(request), 60, 60_000)) return tooManyRequests(60);
  const c = config();
  if (!c) return json({ enabled: false, error: "The preview is not enabled on this deployment." }, 503);
  if (new URL(request.url).searchParams.get("view") === "showcase") {
    try { return json({ enabled: true, ...await c.client.query(api.demo.showcase, {}) }); }
    catch { return json({ error: "Preview examples are temporarily unavailable." }, 503); }
  }
  const token = readDemoToken(request);
  if (!token) return json({ enabled: true, session: null, limits: DEMO });
  try {
    return json({ enabled: true, session: await c.client.query(api.demo.dashboard, { secret: c.secret, hash: sessionHash(token) }), limits: DEMO });
  } catch (error) {
    return expiredDemoError(error) ? json({ error: "Your preview session expired. Start a new preview." }, 401)
      : json({ error: "Preview is temporarily unavailable. Refresh to try again." }, 503);
  }
}

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("session") }),
  z.object({ action: z.literal("agent"), input: DemoCreateBody }),
  z.object({ action: z.literal("basket"), input: DemoBasketBody }),
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
  let token = readDemoToken(request);
  try {
    if (b.action === "session") {
      if (token) {
        try {
          await c.client.query(api.demo.dashboard, { secret: c.secret, hash: sessionHash(token) });
          return json({ ok: true });
        } catch (error) { if (!expiredDemoError(error)) throw error; }
      }
      if (!await allowRequest("demo-session-ip", clientIp(request), 3, 86_400_000)) return tooManyRequests(3600);
      token = newDemoToken();
      const result = await c.client.mutation(api.demo.createSession, { secret: c.secret, hash: sessionHash(token) });
      if ("error" in result) return json(result, 429);
      return json({ ok: true }, 201, { "set-cookie": demoCookie(token, process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:") });
    }
    if (!token) return json({ error: "Start a preview session first." }, 401);
    const credentials = { secret: c.secret, hash: sessionHash(token) };
    const result = b.action === "agent" ? await c.client.mutation(api.demo.createAgent, { ...credentials, input: b.input })
      : b.action === "basket" ? await c.client.mutation(api.demo.createBasket, { ...credentials, input: b.input })
      : await c.client.mutation(api.demo.setStatus, { ...credentials, id: b.id as Id<"demoAgents">, status: b.status });
    return json(result, "error" in result ? 409 : b.action === "status" ? 200 : 201);
  } catch (error) {
    console.warn("[preview] request failed", error instanceof Error ? error.name : "unknown");
    return json({ error: "Preview request could not be completed. Refresh your session and try again." }, 503);
  }
}
