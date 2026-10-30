/**
 * Mimir API (lib/launch/paid-call.ts): call a launched agent from any app, paying the agent's own wallet.
 * GET  /api/launch/:id/call                      the price and where to pay, per chain.
 * POST /api/launch/:id/call { prompt }           without a payment: 402 with the same quote.
 *      header X-Mimir-Payment: <arc|solana|robinhood|base>:<tx>   with one: the agent's answer. One tx buys one call.
 */
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import { COUNCIL_AGENTS } from "@/lib/launch/council-view";
import { baseAgentPay, callPriceUsd, newCallId, PAY_HEADER, parsePayment, quote, usdPrices } from "@/lib/launch/paid-call";
import { launchCx } from "@/lib/launch/request";
import { readLimitedJson } from "@/lib/server/body-limit";
import { allowRequest, clientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": `content-type, ${PAY_HEADER}`,
  "cache-control": "no-store",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });

async function offer(id: string) {
  const c = launchCx();
  if (!c) return { res: json({ error: "Mimir API is not configured on this server." }, 503) };
  const w = (await c.client.query(api.agentApiDb.wallets, { secret: c.secret, slug: id })) ?? (Object.hasOwn(COUNCIL_AGENTS, id) ? COUNCIL_AGENTS[id] : null);
  if (!w) return { res: json({ error: "No such live agent." }, 404) };
  const prices = await usdPrices().catch(() => null);
  if (!prices) return { res: json({ error: "Could not read prices. Try again." }, 503) };
  const usd = callPriceUsd();
  const payContract = baseAgentPay();
  return {
    c,
    quote: {
      agent: id, name: w.name, ticker: w.ticker, priceUsd: usd,
      // Base: the agent's EVM wallet is its Arc EOA; payment goes through MimirAgentPay with a fresh callId.
      accepts: quote(usd, prices, { ...w, base: w.arc }, payContract ? { contract: payContract, callId: newCallId() } : null),
      howTo: `Send the amount for one chain to its payTo wallet (on Base: call pay(agent, units, callId) on the payTo contract, after a USDC approve, or payWithPermit), then POST { "prompt": "..." } with header ${PAY_HEADER}: <chain>:<tx>. One tx buys one call; pay within an hour of calling.`,
    },
  };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await allowRequest("agent-api-quote", clientIp(req), 60, 60_000))) return json({ error: "Too many requests." }, 429);
  const o = await offer((await ctx.params).id);
  return o.res ?? json(o.quote);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await allowRequest("agent-api-call", clientIp(req), 30, 60_000))) return json({ error: "Too many requests." }, 429);
  const { id } = await ctx.params;
  const raw = await readLimitedJson(req, 8 * 1024);
  const body = z.object({ prompt: z.string().trim().min(1).max(2000) }).safeParse(raw.ok ? raw.value : null);
  if (!body.success) return json({ error: 'Body must be JSON: { "prompt": "..." } (1-2000 characters).' }, 400);
  const header = req.headers.get(PAY_HEADER);
  const pay = parsePayment(header);
  if (!pay) {
    const o = await offer(id);
    if (o.res) return o.res;
    return json({ error: header ? `Bad ${PAY_HEADER} header: use <arc|solana|robinhood|base>:<tx>.` : "Payment required.", ...o.quote }, 402);
  }
  const c = launchCx();
  if (!c) return json({ error: "Mimir API is not configured on this server." }, 503);
  const r = await c.client.action(api.agentApi.call, { secret: c.secret, slug: id, prompt: body.data.prompt, chain: pay.chain, tx: pay.tx });
  return r.ok ? json({ agent: r.agent, answer: r.answer, paid: { chain: r.chain, tx: r.tx } }) : json({ error: r.error }, r.status);
}
