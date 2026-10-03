/**
 * GET /api/arena/agents: the AI economic actors and their recent activity.
 *
 * Combines the council persona roster (with derived addresses) and the oracle
 * address with the indexed claim feed, producing a per-agent activity summary
 * and a flat, newest-first activity log for the /agents page.
 */
import { NextResponse } from "next/server";
import { Keypair, PublicKey } from "@solana/web3.js";
import { MimirSolanaClient } from "@/lib/solana/client";
import { councilRoster, personaByAddress } from "@/lib/server/council-roster";
import { isIndexEnabled, readClaims } from "@/lib/server/solana-index";
import { cachedFor } from "@/lib/server/ttl-cache";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { holdsStakes } from "@/lib/claim-status";

export const dynamic = "force-dynamic";

let reader: MimirSolanaClient | null = null;
function getReader(): MimirSolanaClient {
  if (!reader) reader = new MimirSolanaClient(Keypair.generate());
  return reader;
}

export async function GET(req: Request) {
  // Every call reads each persona's ER balance (and, without the index, every
  // claim). The page polls every 5s, 12/min per tab.
  if (!(await allowRequest("arena-agents", clientIp(req), 30, 60_000))) {
    return tooManyRequests(60);
  }
  try {
    return NextResponse.json({ success: true, data: await agentsData() });
  } catch (error: any) {
    console.error("[api/arena/agents] failed:", error);
    return NextResponse.json(
      { success: false, error: "agents read failed" },
      { status: 500 }
    );
  }
}

/**
 * The whole payload, cached per instance for one poll interval so concurrent
 * viewers share one claim scan and one balance read per persona.
 */
const agentsData = cachedFor(async () => {
  const roster = councilRoster();
  const byAddr = personaByAddress();

  // The oracle key comes from the on-chain config: the web process never
  // holds a private key (audit P0-1).
  const oracleCfg = await getReader().getConfig().catch(() => null);
  const oracleAddress = oracleCfg?.oracle.toBase58() ?? "";

  // Pull claims from the index when available, else from chain.
  let claims: any[] = [];
  if (isIndexEnabled()) {
    claims = (await readClaims({ limit: 300 })).map((c) => ({
      id: c.id,
      question: c.question,
      state: c.state,
      winnerSide: c.winner_side,
      confidence: c.confidence,
      createdAt: c.created_at,
      challengers: c.challengers,
    }));
  } else {
    const client = getReader();
    const cfg = await client.getConfig();
    if (cfg) {
      for (let id = 1n; id <= cfg.claimCount; id++) {
        const c = await client.getClaim(id);
        if (!c) continue;
        claims.push({
          id: Number(c.id),
          question: c.question,
          state: c.state,
          winnerSide: c.winnerSide,
          confidence: c.confidence,
          createdAt: c.createdAt,
          challengers: c.challengers.map((x) => ({
            addr: x.addr.toBase58(),
            stake: x.stake.toString(),
            paid: x.paid,
          })),
        });
      }
    }
  }

  // Build a flat activity log: every challenger stake, labelled by persona.
  type Activity = {
    kind: "challenge" | "settle";
    claimId: number;
    question: string;
    actor: string;
    label: string;
    emoji: string;
    stake?: string;
    confidence?: number;
  };
  const activity: Activity[] = [];
  // stakes = lifetime number of challenges; atRisk = stake on still-open
  // claims only (resolved/cancelled claims have already paid out, so their
  // stake is no longer at risk).
  const perAgent: Record<string, { stakes: number; volume: number }> = {};

  for (const c of claims) {
    // Stake is at risk until the claim is RESOLVED (or cancelled): a
    // PROPOSED / DISPUTED verdict can still change.
    const isOpen = holdsStakes(c.state);
    for (const ch of c.challengers ?? []) {
      const persona = byAddr[ch.addr];
      const key = persona?.slug ?? (ch.addr === oracleAddress ? "oracle" : "human");
      perAgent[key] = perAgent[key] ?? { stakes: 0, volume: 0 };
      perAgent[key].stakes += 1;
      if (isOpen) perAgent[key].volume += Number(ch.stake);
      activity.push({
        kind: "challenge",
        claimId: c.id,
        question: c.question,
        actor: ch.addr,
        label: persona?.displayName ?? (ch.addr === oracleAddress ? "Oracle" : "Challenger"),
        emoji: persona?.emoji ?? (ch.addr === oracleAddress ? "🔮" : "👤"),
        stake: ch.stake,
      });
    }
    if (c.state === 2) {
      activity.push({
        kind: "settle",
        claimId: c.id,
        question: c.question,
        actor: oracleAddress,
        label: "Oracle",
        emoji: "🔮",
        confidence: c.confidence,
      });
    }
  }
  activity.reverse();

  // Per-persona ER virtual balance. getBalance already swallows its own
  // errors and returns 0n; allSettled guards against any unexpected throw so
  // a flaky public RPC can never break the roster response.
  const client = getReader();
  const balances = await Promise.allSettled(
    roster.map((p) =>
      p.address ? client.getBalance(new PublicKey(p.address)) : Promise.resolve(0n),
    ),
  );
  const balanceBySlug: Record<string, string> = {};
  roster.forEach((p, i) => {
    const r = balances[i];
    balanceBySlug[p.slug] =
      r.status === "fulfilled" ? r.value.toString() : "0";
  });

  return {
    oracle: { address: oracleAddress, ...(perAgent["oracle"] ?? { stakes: 0, volume: 0 }) },
    personas: roster.map((p) => ({
      ...p,
      stakes: perAgent[p.slug]?.stakes ?? 0,
      volume: String(perAgent[p.slug]?.volume ?? 0),
      balance: balanceBySlug[p.slug] ?? "0",
    })),
    activity: activity.slice(0, 60),
  };
}, 5_000);
