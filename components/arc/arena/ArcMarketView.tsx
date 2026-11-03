"use client";

/**
 * /arena/<chain>/<kind>/<id>: one market on Base or Arc, live from Convex. The
 * question, its network, both sides with their money, time left or the verdict,
 * the stake box while betting is open, who is in, and the same market on the
 * other network (linked, lib/chains/linked.ts): both legs' figures side by side
 * and a "Stake on Base / Stake on Arc" switch in the stake box.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import { SURFACE } from "@/components/arena/surface";
import Countdown from "@/components/arena/Countdown";
import { useNowSec } from "@/components/arena/settlement/useSettleAction";
import Skeleton from "@/components/ui/Skeleton";
import Modal from "@/components/ui/Modal";
import { Link } from "@/i18n/navigation";
import type { ArcMarketKind } from "@/lib/arc/markets";
import { explorerUrl, MARKET_CHAINS, marketChain, marketContract, type MarketChainId } from "@/lib/chains/registry";
import { ChainBadge } from "../NetworkLogos";
import { LegsCompare, LegStakeBox, StakeChainSwitch, type Leg } from "./MarketLegs";
import RollingNumber from "@/components/motion/RollingNumber";
import { weiToUsd } from "@/lib/arc/markets";
import ArcActivity from "./ArcActivity";
import ArcCouncilTakes from "./ArcCouncilTakes";
import ArcMarketActions from "./ArcMarketActions";
import { BetChip, useJoltOn, useNewBets, type Bet } from "./BetFx";
import ArcStakePanel from "./ArcStakePanel";
import MarketCaution from "./MarketCaution";
import ShareMarket from "./ShareMarket";
import { arcPhase, KIND_LABEL, PHASE_DOT, PHASE_LABEL, shareA, Split, usd, usdFine } from "./shared";
import { useArcAccount } from "./useArcAccount";
import SettlementTimeline from "./SettlementTimeline";
import FollowButton from "@/components/discovery/FollowButton";
import PrivateClaimAccess from "./PrivateClaimAccess";

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

/** Desktop (lg and up) keeps the stake box beside the market; phones open it as a bottom sheet. */
function useWide(): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export default function ArcMarketView({ chain = "arc", kind, marketId }: { chain?: MarketChainId; kind: ArcMarketKind; marketId: number }) {
  // Right after the creator opened it (ArcCreateForm sends ?new=1): the share prompt instead of the small buttons.
  const [fresh, setFresh] = useState(false);
  useEffect(() => setFresh(new URLSearchParams(window.location.search).get("new") === "1"), []);
  const m = useQuery(api.arc.market, { chain, kind, marketId });
  const cfg = marketChain(chain);
  // Live bets: a chip flies into the side that was backed and the bar jolts (BetFx.tsx).
  const bets = useNewBets(m?.events);
  const splitRef = useRef<HTMLDivElement>(null);
  useJoltOn(splitRef, bets.at(-1)?.id, 0.6);
  const account = useArcAccount(chain);
  const address = account.address;
  const now = useNowSec(15_000);
  const wide = useWide();
  const [sheet, setSheet] = useState(false);
  // Which leg of a linked market the stake box works on (this page's own by default).
  const [stakeChain, setStakeChain] = useState<MarketChainId>(chain);
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
  const contract = marketContract(cfg, kind);
  const linked = (m.linked ?? []).filter((l) => MARKET_CHAINS.chains[l.chain].enabled);
  const legs: Leg[] = linked.length
    ? [{ chain, kind, marketId: m.marketId, status: m.status, stakeA: m.stakeA, stakeB: m.stakeB, volumeUsd: m.volumeUsd, participants: m.participants, deadline: m.deadline, lockAt: m.lockAt }, ...linked]
        .sort((a, b) => MARKET_CHAINS.enabled.indexOf(a.chain) - MARKET_CHAINS.enabled.indexOf(b.chain))
    : [];
  const pickedLeg = legs.find((l) => l.chain === stakeChain && l.chain !== chain) ?? null;
  // Open while any leg takes stakes: the box can switch to the leg that still does.
  const anyOpen = phase === "open" || legs.some((l) => arcPhase({ status: l.status, deadline: l.deadline ?? 0, lockAt: l.lockAt }, now) === "open");
  const switcher = legs.length > 1 ? <StakeChainSwitch legs={legs} picked={stakeChain} onPick={setStakeChain} /> : null;

  return (
    <div className="mx-auto grid w-full min-w-0 max-w-[1040px] grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
      <div className="grid min-w-0 content-start gap-6">
        <header className="grid gap-4">
          <p className="m-0 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <ChainBadge chain={chain} />
            <span className="rounded-full bg-panel-raised px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-coral">{KIND_LABEL[kind]}</span>
            <span className="font-mono text-dim">#{m.marketId}</span>
            <span>· {m.category}</span>
            {m.isPrivate ? <span className="text-pending">Private · approved wallets only</span> : null}
            <span className="ml-auto flex items-center gap-2">
              <span aria-hidden className={`h-[6px] w-[6px] rounded-full ${PHASE_DOT[phase]}`} />
              {PHASE_LABEL[phase]}
              <MarketCaution />
            </span>
          </p>
          <h1 className="m-0 font-display text-[clamp(1.8rem,4vw,2.6rem)] leading-[1.05] text-cream [text-wrap:pretty]">{m.question}</h1>
          {legs.length > 1 ? <LegsCompare legs={legs} current={chain} picked={stakeChain} onPick={setStakeChain} labelA={m.labelA} labelB={m.labelB} now={now} /> : null}
          {fresh ? null : <ShareMarket chain={chain} kind={kind} marketId={m.marketId} question={m.question} isPrivate={m.isPrivate} />}
        </header>

        <PrivateClaimAccess m={m} account={account} />
        {fresh ? <ShareMarket chain={chain} kind={kind} marketId={m.marketId} question={m.question} fresh isPrivate={m.isPrivate} /> : null}

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
              m.lockAt && m.lockAt < m.deadline ? (
                <Countdown until={m.lockAt} format={(t) => `Betting closes early, ${t} left`} className="font-mono" />
              ) : (
                <Countdown until={m.deadline} format={(t) => `${t} left`} className="font-mono" />
              )
            ) : m.lockAt && m.lockAt < m.deadline && now < m.deadline ? (
              <span>Betting closed early {new Date(m.lockAt * 1000).toLocaleString("en-US")} · result after {new Date(m.deadline * 1000).toLocaleString("en-US")}</span>
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

        <FollowButton target={chain === "arc" ? `market:${kind}:${marketId}` : `market:${chain}:${kind}:${marketId}`} label="Follow market updates" />
        <SettlementTimeline market={m} events={m.events} now={now} />
        <section aria-label="Who is in" className={`${SURFACE} grid gap-3 p-5`}>
          <h2 className="m-0 text-[15px] text-cream">Who is in</h2>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {m.positions.map((p) => (
              <li key={p._id} className="flex items-center justify-between gap-3 text-[13px]">
                <a href={explorerUrl(cfg, "address", p.user)} target="_blank" rel="noreferrer" className="font-mono text-muted hover:text-cream">
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
                <a href={explorerUrl(cfg, "address", contract)} target="_blank" rel="noreferrer" className="text-coral hover:underline">
                  contract
                </a>
              </>
            ) : null}
          </p>
        </section>
        <ArcCouncilTakes chain={chain} kind={kind} marketId={m.marketId} labelA={m.labelA} labelB={m.labelB} />
        <section aria-label="Every transaction" className={`${SURFACE} grid gap-3 p-5`}>
          <h2 className="m-0 text-[15px] text-cream">Every transaction</h2>
          <ArcActivity m={m} events={m.events} verdict={m.verdict ?? null} />
        </section>
      </div>

      {anyOpen && !wide ? (
        <>
          {pickedLeg ? null : <ArcMarketActions m={m} mine={mine} account={account} now={now} />}
          {/* Keeps the last section clear of the sticky stake button. */}
          <div aria-hidden className="h-16" />
          <div className="fixed inset-x-0 bottom-[var(--tab-bar)] z-50 px-[var(--gut)] pb-2.5 pt-2">
            <button type="button" onClick={() => setSheet(true)} className="btn-primary w-full !py-3.5 shadow-modal" aria-haspopup="dialog">
              <span className="min-w-0 truncate">{kind === "vs" ? `Challenge · ${m.labelB}` : "Take a side"}</span>
            </button>
          </div>
          <Modal open={sheet} onClose={() => setSheet(false)} title={kind === "vs" ? "Challenge" : "Take a side"} variant="sheet">
            <div className="grid gap-3">
              {switcher}
              {pickedLeg ? <LegStakeBox leg={pickedLeg} now={now} inSheet /> : phase === "open" ? <ArcStakePanel m={m} mine={mine} account={account} inSheet /> : <p className="m-0 text-[14px] text-muted">{PHASE_LABEL[phase]} on {cfg.label}.</p>}
            </div>
          </Modal>
        </>
      ) : (
      <aside aria-label="Stake" className={`${SURFACE} grid h-fit gap-4 p-5 lg:sticky lg:top-[96px]`}>
        {switcher}
        {pickedLeg ? (
          <LegStakeBox leg={pickedLeg} now={now} />
        ) : phase === "open" ? (
          <ArcStakePanel m={m} mine={mine} account={account} />
        ) : (
          <div className="grid gap-2">
            <h2 className="m-0 font-display text-[1.4rem] leading-none text-cream">{PHASE_LABEL[phase]}</h2>
            <p className="m-0 text-[14px] leading-relaxed text-muted">
              {phase === "resolved" || phase === "cancelled"
                ? `Payouts go straight to the winners' wallets on ${cfg.label}.`
                : phase === "disputed" && m.vetoed
                  ? "The owner vetoed the proposed result; the arbiter rules on it. If no ruling comes, every stake is refunded."
                  : "Staking has closed. The oracle proposes a result, then anyone may dispute it before it settles."}
            </p>
          </div>
        )}
        {pickedLeg ? null : <ArcMarketActions m={m} mine={mine} account={account} now={now} />}
      </aside>
      )}
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
