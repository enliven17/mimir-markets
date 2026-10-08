/**
 * POST /api/telegram/arc-events: the Convex indexer (convex/arcSync.ts) posts
 * what changed on Arc; this route turns it into Telegram messages:
 *   new        a market opened → every chat that wants new markets
 *   proposed   the oracle proposed a result → each participant's linked chats
 *   resolved   settled (won / lost / refunded) → each participant's linked chats
 *   cancelled  the creator cancelled → the creator's linked chats
 * Participants are Arc accounts; arc_accounts maps them to the Solana wallet a
 * chat follows. Auth: the events secret (MIMIR_EVENTS_SECRET) as a bearer token.
 */
import { secretMatches } from "@/lib/internal-secrets";
import { NextResponse } from "next/server";

import { getArcBindingByArc } from "@/lib/server/arc-accounts";
import { broadcastArcMarket, deliverArc } from "@/lib/server/telegram";
import { arcMarketUrl, esc, type AlertPref } from "@/lib/telegram";
import { cardTypeFor, cardUrl } from "@/lib/telegram-card";
import { getAddress } from "viem";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ArcEvent {
  type: "new" | "proposed" | "resolved" | "cancelled";
  kind: "vs" | "pool";
  marketId: number;
  question: string;
  labelA: string;
  labelB: string;
  stakeA: string;
  deadline: number;
  winner: number;
  summary: string;
  disputableUntil: number;
  /** Arc account → the side it holds (1 or 2). */
  holders: Array<{ user: string; side: number }>;
}

function authorized(req: Request): boolean {
  return secretMatches("events", (req.headers.get("authorization") ?? "").replace(/^Bearer /, ""));
}

const sideName = (e: ArcEvent, s: number) => (s === 1 ? e.labelA : s === 2 ? e.labelB : "");

function personalText(e: ArcEvent, side: number): { text: string; pref: AlertPref } | null {
  const q = esc(e.question.slice(0, 140));
  if (e.type === "resolved") {
    const head =
      e.winner !== 1 && e.winner !== 2 ? "↩️ <b>Refunded</b>: no winner, every stake is returned." : e.winner === side ? "🏆 <b>You won</b>" : "❌ <b>You lost</b>";
    return { text: [head, q, e.summary ? `\n<i>${esc(e.summary.slice(0, 300))}</i>` : ""].join("\n").trim(), pref: "alert_results" };
  }
  if (e.type === "proposed") {
    const outlook = e.winner !== 1 && e.winner !== 2 ? "with no winner" : e.winner === side ? "in your favour" : "against you";
    const until = e.disputableUntil ? `\nDisputable until ${new Date(e.disputableUntil * 1000).toUTCString()}` : "";
    return { text: [`⚖️ <b>Result proposed</b> ${outlook}: ${esc(sideName(e, e.winner) || "refund")}`, q, until].join("\n").trim(), pref: "alert_verdicts" };
  }
  if (e.type === "cancelled") return { text: ["🚫 <b>Market cancelled</b>, stake returned", q].join("\n"), pref: "alert_results" };
  return null;
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { events } = (await req.json().catch(() => ({ events: [] }))) as { events?: ArcEvent[] };
  let sent = 0;
  for (const e of (events ?? []).slice(0, 50)) {
    const url = arcMarketUrl(e.kind, e.marketId);
    if (e.type === "new") {
      await broadcastArcMarket({ question: e.question, stakeA: e.stakeA, deadline: e.deadline, url, card: cardUrl("new", e.kind, e.marketId) });
      sent++;
      continue;
    }
    for (const h of e.holders.slice(0, 200)) {
      const msg = personalText(e, h.side);
      const binding = msg ? await getArcBindingByArc(getAddress(h.user)).catch(() => null) : null;
      if (!msg || !binding) continue;
      await deliverArc(binding.solana, msg.text, msg.pref, url, cardUrl(cardTypeFor(e, h.side), e.kind, e.marketId, h.side));
      sent++;
    }
  }
  return NextResponse.json({ ok: true, sent });
}
