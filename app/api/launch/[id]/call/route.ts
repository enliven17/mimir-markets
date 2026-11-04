/**
 * Mimir API (lib/launch/paid-call.ts): call a launched agent from any app, paying the agent's own wallet.
 * GET  /api/launch/:id/call                      the price and where to pay, per chain.
 * POST /api/launch/:id/call { prompt }           without a payment: 402 with the same quote.
 *      header X-Mimir-Payment: arc:<tx> or base:<tx>:<secret>   with one: the agent's answer. One tx buys one call.
 */
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import { MARKET_CHAINS } from "@/lib/chains/registry";
import { COUNCIL_AGENTS } from "@/lib/launch/council-view";
import {
  callPriceUsd,
  newBaseCall,
  PAY_HEADER,
  parsePayment,
  quote,
} from "@/lib/launch/paid-call";
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
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: CORS });

export const OPTIONS = () => new Response(null, { status: 204, headers: CORS });

async function offer(id: string) {
  const c = launchCx();
  if (!c)
    return {
      res: json({ error: "Mimir API is not configured on this server." }, 503),
    };
  const w =
    (await c.client.query(api.agentApiDb.wallets, {
      secret: c.secret,
      slug: id,
    })) ?? (Object.hasOwn(COUNCIL_AGENTS, id) ? COUNCIL_AGENTS[id] : null);
  if (!w) return { res: json({ error: "No such live agent." }, 404) };
  const usd = callPriceUsd();
  return {
    c,
    quote: {
      agent: id,
      name: w.name,
      ticker: w.ticker,
      priceUsd: usd,
      // Base: its Base wallet, or else its Arc wallet (the same address); paid through MimirAgentPay with a fresh callId.
      accepts: quote(
        usd,
        { solana: w.solana },
        { contract: "", ...newBaseCall() },
      ),
      network: "solana-devnet",
      howTo: `Send the quoted test USDC to payTo on Solana Devnet and include a Memo instruction with text Mimir devnet call:<callId>. Keep the quote's secret private until POSTing { "prompt": "..." } with ${PAY_HEADER}: solana:<signature>:<secret>. One confirmed payment buys one call within an hour.`,
    },
  };
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!(await allowRequest("agent-api-quote", clientIp(req), 60, 60_000)))
    return json({ error: "Too many requests." }, 429);
  const o = await offer((await ctx.params).id);
  return o.res ?? json(o.quote);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!(await allowRequest("agent-api-call", clientIp(req), 30, 60_000)))
    return json({ error: "Too many requests." }, 429);
  const { id } = await ctx.params;
  const raw = await readLimitedJson(req, 8 * 1024);
  const body = z
    .object({ prompt: z.string().trim().min(1).max(2000) })
    .safeParse(raw.ok ? raw.value : null);
  if (!body.success)
    return json(
      { error: 'Body must be JSON: { "prompt": "..." } (1-2000 characters).' },
      400,
    );
  const header = req.headers.get(PAY_HEADER);
  const pay = parsePayment(header);
  if (!pay) {
    const o = await offer(id);
    if (o.res) return o.res;
    return json(
      {
        error: header
          ? `Bad ${PAY_HEADER} header: use solana:<signature>:<secret>.`
          : "Test USDC payment required.",
        ...o.quote,
      },
      402,
    );
  }
  const c = launchCx();
  if (!c)
    return json({ error: "Mimir API is not configured on this server." }, 503);
  if (pay.chain !== "solana" || !MARKET_CHAINS.chains.solana.enabled)
    return json({ error: "Solana Devnet only." }, 503);
  const r = await c.client.action(api.agentApi.call, {
    secret: c.secret,
    slug: id,
    prompt: body.data.prompt,
    chain: pay.chain,
    tx: pay.tx,
    ...(pay.secret ? { callSecret: pay.secret } : {}),
  });
  return r.ok
    ? json({
        agent: r.agent,
        answer: r.answer,
        paid: { chain: r.chain, tx: r.tx },
      })
    : json({ error: r.error }, r.status);
}
