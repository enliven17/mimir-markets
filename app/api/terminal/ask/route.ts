/**
 * POST /api/terminal/ask   one message to an agent from the Mimir Terminal
 *   body: { agent, message, history?: [{ role, text }], context?: { claimId?, mint? } }
 *   → { success, data: { agent, reply } }
 *
 * House personas answer from our LLM (free, rate-limited per wallet tier like
 * /api/council/reasoning). The terminal's focus (the market or token last
 * opened) rides along as fenced context. The whole reply comes back at once;
 * the terminal types it out, so nothing streams through the server.
 */
import { NextResponse } from "next/server";

import { getPersonaBySlug } from "@/agents/council/personas";
import { COUNCIL_KEY_ENV } from "@/agents/council/shared/persona-llm";
import { callLLM } from "@/lib/llm";
import { readLimitedJson } from "@/lib/server/body-limit";
import { loadCouncilClaim } from "@/lib/server/council-claim";
import { rateIdentity } from "@/lib/server/holder";
import { allowLlmRequest } from "@/lib/server/llm-route-guard";
import { allowRequest, tooManyRequests } from "@/lib/server/rate-limit";
import { tokenInfo } from "@/lib/server/token-info";
import { MAX_REPLY_CHARS, parseAskRequest, personaChatPrompt } from "@/lib/terminal/chat";
import { rateLimitFor } from "@/lib/token-tiers";

export const dynamic = "force-dynamic";

const fail = (status: number, error: string) => NextResponse.json({ success: false, error }, { status });

export async function POST(req: Request) {
  const { key, tier, pool } = await rateIdentity(req);
  if (!(await allowRequest("terminal-ask", key, rateLimitFor(20, tier), 60_000))) return tooManyRequests(60);
  const read = await readLimitedJson(req);
  if (!read.ok) return fail(read.status, read.status === 413 ? "body is too large" : "body is not valid JSON");
  const ask = parseAskRequest(read.value);
  if (typeof ask === "string") return fail(400, ask);

  const persona = getPersonaBySlug(ask.agent);
  if (!persona) return fail(404, `no agent called ${ask.agent}. Type agents for the list.`);
  if (persona.archetype === "rule-based") {
    return NextResponse.json({
      success: true,
      data: {
        agent: persona.slug,
        reply: `${persona.displayName} runs on rules, not a model: ${persona.longBio} Ask one of the thinking personas for a take.`,
      },
    });
  }

  if (
    !(await allowLlmRequest({
      bucket: "terminal-ask-llm",
      key,
      perKey: rateLimitFor(8, tier),
      globalEnv: "TERMINAL_ASK_GLOBAL_PER_MIN",
      globalDefault: 90,
      pool,
    }))
  ) {
    return tooManyRequests(60);
  }

  const [claim, token] = await Promise.all([
    ask.context.claimId ? loadCouncilClaim(ask.context.claimId).catch(() => null) : null,
    ask.context.mint ? tokenInfo(ask.context.mint).catch(() => null) : null,
  ]);
  const prompt = personaChatPrompt({ persona, message: ask.message, history: ask.history, claim, token: token as Record<string, unknown> | null });

  let reply = "";
  try {
    reply = (await callLLM(prompt, { maxTokens: 400, keyEnv: COUNCIL_KEY_ENV, role: "council" })).trim().slice(0, MAX_REPLY_CHARS);
  } catch (err) {
    console.error("[api/terminal/ask] llm failed:", err);
  }
  if (!reply) return fail(503, `${persona.displayName} cannot answer right now. Try again in a minute.`);
  return NextResponse.json({ success: true, data: { agent: persona.slug, reply } });
}
