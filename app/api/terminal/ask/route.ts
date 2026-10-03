/**
 * POST /api/terminal/ask   one message to an agent from the Mimir Terminal
 *   body: { agent, message, history?: [{ role, text }], context?: { claimId?, mint? } }
 *   → { success, data: { agent, reply } }
 *
 * House personas answer from our LLM (free, rate-limited per wallet tier like
 * /api/council/reasoning). Community agents answer from their own endpoint
 * (setChat), relayed and signed by lib/server/terminal-relay.ts. The
 * terminal's focus (the market or token last opened) rides along as context.
 * The whole reply comes back at once; the terminal types it out, so nothing
 * streams through the server.
 */
import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getPersonaBySlug } from "@/agents/council/personas";
import { agentChatTarget } from "@/lib/agents/store";
import { isDbEnabled } from "@/lib/server/db";
import { relayToAgent } from "@/lib/server/terminal-relay";
import { allowanceOf, confirmCharge, releaseCharge, reserveCharge, sessionWallet, terminalDelegate } from "@/lib/server/terminal-pay";
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
  if (!persona) return askCommunityAgent(ask, sessionWallet(req));
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

/** A registered agent with a chat endpoint: relay the message, return its reply. */
const PAY_REASONS: Record<string, string> = {
  no_limit: "no spending limit yet: run limit 5 (one signature, the USDC stays in your wallet)",
  limit_too_low: "your spending limit is used up: run limit <usdc> to raise it",
  balance_too_low: "not enough USDC in your wallet for this message",
};

async function askCommunityAgent(ask: Exclude<ReturnType<typeof parseAskRequest>, string>, wallet: string | null): Promise<Response> {
  const target = isDbEnabled() ? await agentChatTarget(ask.agent).catch(() => null) : null;
  if (!target) return fail(404, `no agent called ${ask.agent} takes questions. Type agents for the list.`);

  // A paid agent: reserve the charge before relaying, release it if no answer comes.
  let chargeId: number | null = null;
  if (target.priceUnits > 0) {
    const delegate = terminalDelegate();
    if (!delegate) return fail(503, "paid agents are not switched on yet");
    if (!wallet) return NextResponse.json({ success: false, error: "sign in to the terminal to message paid agents", code: "session" }, { status: 401 });
    const allowance = await allowanceOf(wallet).catch(() => null);
    if (!allowance) return fail(503, "could not read your spending limit right now");
    const reserved = await reserveCharge({
      wallet, agentId: ask.agent, payoutWallet: target.payoutWallet, priceUnits: BigInt(target.priceUnits), allowance, delegate,
    });
    if ("reason" in reserved) {
      return NextResponse.json({ success: false, error: PAY_REASONS[reserved.reason], code: reserved.reason }, { status: 402 });
    }
    chargeId = reserved.id;
  }
  const [claim, token] = await Promise.all([
    ask.context.claimId ? loadCouncilClaim(ask.context.claimId).catch(() => null) : null,
    ask.context.mint ? tokenInfo(ask.context.mint).catch(() => null) : null,
  ]);
  try {
    const reply = await relayToAgent(target, {
      requestId: randomUUID(),
      agentId: ask.agent,
      message: ask.message,
      history: ask.history,
      context: {
        market: claim ? { id: ask.context.claimId, question: claim.question, creatorPosition: claim.creatorPosition, counterPosition: claim.counterPosition, category: claim.category } : null,
        token: token as Record<string, unknown> | null,
      },
      wallet,
    });
    // Charged only for an answer.
    if (chargeId !== null) await confirmCharge(chargeId);
    return NextResponse.json({ success: true, data: { agent: ask.agent, reply, chargedUsdc: target.priceUnits / 1e6 } });
  } catch (err) {
    if (chargeId !== null) await releaseCharge(chargeId).catch(() => undefined);
    console.warn(`[api/terminal/ask] ${ask.agent} relay failed:`, err instanceof Error ? err.message : err);
    return fail(502, `${ask.agent} did not answer. Try again, or ask another agent.`);
  }
}
