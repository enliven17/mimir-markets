"use client";

/**
 * /arena/arc/<kind>/<id>: one Arc market, live from Convex. The question,
 * both sides with their money, time left or the verdict, the stake box while
 * betting is open, and who is in.
 */
import { useRef } from "react";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { SURFACE } from "@/components/arena/surface";
import Countdown from "@/components/arena/Countdown";
import { useNowSec } from "@/components/arena/settlement/useSettleAction";
import Skeleton from "@/components/ui/Skeleton";
import { Link } from "@/i18n/navigation";
import { ARC, arcExplorerUrl } from "@/lib/arc/config";
import type { ArcMarketKind } from "@/lib/arc/markets";
import RollingNumber from "@/components/motion/RollingNumber";
import { weiToUsd } from "@/lib/arc/markets";
import ArcActivity from "./ArcActivity";
import ArcCouncilTakes from "./ArcCouncilTakes";
import ArcMarketActions from "./ArcMarketActions";
import { BetChip, useJoltOn, useNewBets, type Bet } from "./BetFx";
import ArcStakePanel from "./ArcStakePanel";
import { arcPhase, KIND_LABEL, PHASE_DOT, PHASE_LABEL, shareA, Split, usd, usdFine } from "./shared";
import { useArcAccount } from "./useArcAccount";

/** Anyone writes this URL on-chain: link it only when it is http(s), never javascript: or data:. */
function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function ArcMarketView({ kind, marketId }: { kind: ArcMarketKind; marketId: number }) {
  const m = useQuery(api.arc.market, { kind, marketId });
  // Live bets: a chip flies into the side that was backed and the bar jolts (BetFx.tsx).
  const bets = useNewBets(m?.events);
  const splitRef = useRef<HTMLDivElement>(null);
  useJoltOn(splitRef, bets.at(-1)?.id, 0.6);
  const account = useArcAccount();
  const address = account.address;
  const now = useNowSec(15_000);
  const me = address?.toLowerCase() ?? null;

  if (m === undefined) {
    return (
      <div className="mx-auto grid w-full max-w-[1040px] gap-5" role="status" aria-label="Loading">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-36 w-full rounded-xl" />
      </div>
    );
  }
  if (m === null) {
    return (
      <div className="mx-auto grid max-w-[640px] gap-4 py-16 text-center">
        <h1 className="m-0 font-display text-[1.8rem] text-cream">Market not found</h1>
        <p className="m-0 text-[14px] text-muted">A market opened a moment ago shows up within seconds.</p>
        <Link href="/arena" className="text-coral hover:underline">
          Back to the Arena
        </Link>
      </div>
    );
  }

  const phase = arcPhase(m, now);
  const pct = shareA(m);
  const sideName = (s: number) => (s === 1 ? m.labelA : s === 2 ? m.labelB : s === 3 ? "Draw" : "Unresolvable");
  const mine = me ? m.positions.filter((p) => p.user === me) : [];
  const contract = kind === "vs" ? ARC.contracts.mimirV3 : ARC.contracts.mimirPool;

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1040px] grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
      <div className="grid min-w-0 content-start gap-6">
        <header className="grid gap-4">
          <p className="m-0 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span className="rounded-full bg-panel-raised px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-coral">{KIND_LABEL[kind]}</span>
            <span className="font-mono text-dim">#{m.marketId}</span>
            <span>· {m.category}</span>
            <span className="ml-auto flex items-center gap-2">
              <span aria-hidden className={`h-[6px] w-[6px] rounded-full ${PHASE_DOT[phase]}`} />
              {PHASE_LABEL[phase]}
            </span>
          </p>
          <h1 className="m-0 font-display text-[clamp(1.8rem,4vw,2.6rem)] leading-[1.05] text-cream [text-wrap:pretty]">{m.question}</h1>
        </header>

        <section aria-label="Sides" className={`${SURFACE} grid gap-4 p-5`}>
          <div className="grid grid-cols-2 gap-3">
            {([1, 2] as const).map((s) => (
              <SideBox
                key={s}
                won={m.winner === s && phase === "resolved"}
                tone={s === 1 ? "cream" : "coral"}
                title={kind === "vs" ? (s === 1 ? "Creator" : "Challengers") : `Side ${s === 1 ? "A" : "B"}`}
                name={sideName(s)}
                stake={weiToUsd(s === 1 ? m.stakeA : m.stakeB)}
                pct={pct === null ? null : s === 1 ? pct : 100 - pct}
                bets={bets.filter((b) => b.side === s)}
              />
            ))}
          </div>
          <div ref={splitRef}>
            <Split m={m} className="h-[6px]" />
          </div>
          <p className="m-0 flex flex-wrap justify-between gap-2 text-[13px] text-muted">
            <span>
              Pool <span className="text-cream">${m.volumeUsd.toFixed(2)}</span> · {m.participants} in
              {m.feesCollected !== "0" ? <> · fees {usdFine(m.feesCollected)}</> : null}
            </span>
            {phase === "open" ? (
              <Countdown until={m.deadline} format={(t) => `${t} left`} className="font-mono" />
            ) : (
              <span>Closed {new Date(m.deadline * 1000).toLocaleString("en-US")}</span>
            )}
          </p>
          {m.status === "resolved" || m.summary ? (
            <p className="m-0 rounded-xl bg-panel p-4 text-[14px] leading-relaxed text-cream">
              <span className="text-win">{m.winner ? `${sideName(m.winner)} won. ` : ""}</span>
              {m.summary}
            </p>
          ) : null}
        </section>

        <section aria-label="Who is in" className={`${SURFACE} grid gap-3 p-5`}>
          <h2 className="m-0 text-[15px] text-cream">Who is in</h2>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {m.positions.map((p) => (
              <li key={p._id} className="flex items-center justify-between gap-3 text-[13px]">
                <a href={arcExplorerUrl("address", p.user)} target="_blank" rel="noreferrer" className="font-mono text-muted hover:text-cream">
                  {short(p.user)}
                  {p.user === me ? <span className="ml-2 text-coral">you</span> : null}
                </a>
                <span className={p.side === 1 ? "text-cream" : "text-coral"}>{sideName(p.side)}</span>
                <span className="font-mono text-cream">{usd(p.amount)}</span>
              </li>
            ))}
          </ul>
          <p className="m-0 text-[12px] text-dim">
            Resolution source:{" "}
            {safeHref(m.resolutionUrl) ? (
              <a href={safeHref(m.resolutionUrl)!} target="_blank" rel="noreferrer nofollow ugc" className="break-all text-coral hover:underline">
                {m.resolutionUrl}
              </a>
            ) : (
              <span className="break-all">{m.resolutionUrl}</span>
            )}
            {contract ? (
              <>
                {" · "}
                <a href={arcExplorerUrl("address", contract)} target="_blank" rel="noreferrer" className="text-coral hover:underline">
                  contract
                </a>
              </>
            ) : null}
          </p>
        </section>
        <ArcCouncilTakes kind={kind} marketId={m.marketId} labelA={m.labelA} labelB={m.labelB} />
        <section aria-label="Every transaction" className={`${SURFACE} grid gap-3 p-5`}>
          <h2 className="m-0 text-[15px] text-cream">Every transaction</h2>
          <ArcActivity m={m} events={m.events} verdict={m.verdict ?? null} />
        </section>
      </div>

      <aside aria-label="Stake" className={`${SURFACE} h-fit p-5 lg:sticky lg:top-[96px]`}>
        {phase === "open" ? (
          <ArcStakePanel m={m} mine={mine} account={account} />
        ) : (
          <div className="grid gap-2">
            <h2 className="m-0 font-display text-[1.4rem] leading-none text-cream">{PHASE_LABEL[phase]}</h2>
            <p className="m-0 text-[14px] leading-relaxed text-muted">
              {phase === "resolved" || phase === "cancelled"
                ? "Payouts go straight to the winners' Arc accounts."
                : "Betting has closed. The oracle proposes a result, then anyone may dispute it before it settles."}
            </p>
          </div>
        )}
        <ArcMarketActions m={m} mine={mine} account={account} now={now} />
      </aside>
    </div>
  );
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One side: its money rolls to the new total and the box jolts as each live bet lands in it. */
function SideBox({ won, tone, title, name, stake, pct, bets }: { won: boolean; tone: "cream" | "coral"; title: string; name: string; stake: number; pct: number | null; bets: Bet[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useJoltOn(ref, bets.at(-1)?.id);
  return (
    <div ref={ref} className={`relative grid gap-1 overflow-visible rounded-xl bg-panel p-4 ${won ? "shadow-[inset_0_0_0_1px_rgb(110_231_160/.6)]" : ""}`}>
      <span className={`text-[12px] uppercase tracking-[0.14em] ${tone === "cream" ? "text-cream" : "text-coral"}`}>{title}</span>
      <span className="truncate text-[16px] text-cream">{name}</span>
      <span className="flex items-baseline gap-1.5 font-mono text-[14px] text-muted">
        <RollingNumber value={stake} format={money} flash className="text-cream" />
        {pct !== null ? <span>· {pct.toFixed(0)}%</span> : null}
      </span>
      {bets.map((b) => (
        <BetChip key={b.id} bet={b} tone={tone} />
      ))}
    </div>
  );
}
