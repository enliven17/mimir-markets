"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { gsap, MOTION_OK_QUERY, useGSAP } from "@/lib/motion";
import { useInViewOnce, usePrefersReducedMotion } from "@/components/motion/hooks";
import dynamic from "next/dynamic";
import { Link } from "@/i18n/navigation";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import { Button, PeepStack } from "@/components/ui";
import { BlueprintHeading } from "@/components/BlueprintGrid";
import SettlementDataSection from "@/components/SettlementDataSection";
import { kineticLetter } from "@/lib/animations/rituals";
import { formatUsdcUnitsBare as usdc } from "@/lib/money";
import { STATE_LABELS } from "@/lib/solana/config";

// Canvas can't render during SSR/prerender — load client-only.
const HeroAscii = dynamic(() => import("@/components/HeroAscii"), { ssr: false });

/* ───────────────────────────────────────────────────────────────────────────
 * Mimir landing — 100% Solana.
 *
 * Markets live inside a MagicBlock Ephemeral Rollup; price claims resolve
 * against the Flash Trade oracle. Live stats come from the Solana arena feed
 * (`GET /api/arena/claims`) — no EVM contract reads anywhere.
 * ───────────────────────────────────────────────────────────────────────── */

interface ArenaClaim {
  id: number;
  question: string;
  category: string;
  creatorStake: string;
  totalChallengerStake: string;
  deadline: number;
  state: number;
  winnerSide: number;
  confidence: number;
  delegated: boolean;
  maxChallengers?: number;
  challengers: { addr: string; stake: string; paid: boolean }[];
}

interface ArenaFeed {
  claims: ArenaClaim[];
  claimCount: number;
  totalResolved: number;
  openPool: string;
}


/* ── Animated count-up for hero/strip stats ──────────────────────────────── */
type ParsedStat = {
  prefix: string;
  unit: string;
  suffix: string;
  target: number;
  decimals: number;
};

function parseStat(raw: string): ParsedStat | null {
  const trimmed = raw.trim();
  let prefix = "";
  let suffix = "";
  let unit = "";
  let working = trimmed;

  if (working.startsWith("$")) {
    prefix = "$";
    working = working.slice(1);
  }
  if (working.endsWith("%")) {
    suffix = "%";
    working = working.slice(0, -1);
  }

  const m = working.match(/^([0-9]+(?:\.[0-9]+)?)([MB])?(\+)?$/);
  if (!m) return null;

  const numStr = m[1];
  unit = m[2] ?? "";
  const matchSuffix = m[3] ?? "";
  suffix = suffix || matchSuffix;
  const decimals = numStr.includes(".") ? numStr.split(".")[1].length : 0;

  return { prefix, unit, suffix, target: Number.parseFloat(numStr), decimals };
}

function formatStat(current: number, parsed: ParsedStat): string {
  const formattedNumber =
    parsed.decimals > 0 ? current.toFixed(parsed.decimals) : current.toFixed(0);
  return `${parsed.prefix}${formattedNumber}${parsed.unit}${parsed.suffix}`;
}

function AnimatedStatNumber({ raw, delayMs }: { raw: string; delayMs: number }) {
  const parsed = useMemo(() => parseStat(raw), [raw]);
  const reducedMotion = usePrefersReducedMotion();

  const targetText = useMemo(
    () => (parsed ? formatStat(parsed.target, parsed) : raw),
    [parsed, raw]
  );
  const initialText = useMemo(
    () => (parsed ? formatStat(0, parsed) : raw),
    [parsed, raw]
  );

  const [display, setDisplay] = useState(initialText);
  const ref = useRef<HTMLSpanElement | null>(null);
  const startedRef = useRef(false);
  const isInView = useInViewOnce(ref, 0.05);

  useEffect(() => {
    if (startedRef.current) return;

    if (!parsed) {
      startedRef.current = true;
      setDisplay(raw);
      return;
    }

    if (reducedMotion) {
      startedRef.current = true;
      setDisplay(targetText);
      return;
    }

    let rafId: number | null = null;
    let timeoutId: number | null = null;

    const startAnimation = () => {
      const from = 0;
      const to = parsed.target;
      const durationMs = 1700;
      const start = performance.now();

      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - t, 3);
        const current = from + (to - from) * eased;
        setDisplay(formatStat(current, parsed));
        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          setDisplay(targetText);
        }
      };

      rafId = requestAnimationFrame(tick);
    };

    const trigger = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      timeoutId = window.setTimeout(startAnimation, delayMs);
    };

    if (isInView) {
      trigger();
    }

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [delayMs, isInView, parsed, raw, reducedMotion, targetText]);

  useEffect(() => {
    startedRef.current = false;
    setDisplay(initialText);
  }, [initialText, raw]);

  return (
    <span ref={ref} aria-label={raw} className="inline-block">
      {display}
    </span>
  );
}


/* ── Live stats strip (Solana arena feed) ────────────────────────────────── */
function StatTile({
  raw,
  label,
  color = "emerald",
  delayMs,
}: {
  raw: string;
  label: string;
  color?: "emerald" | "gold";
  delayMs: number;
}) {
  const valueColor = color === "gold" ? "text-pv-gold" : "text-pv-emerald";
  return (
    <div className="bp-cell p-5 text-center sm:p-6">
      <div className={`font-display text-3xl font-bold tracking-tight sm:text-4xl ${valueColor}`}>
        <AnimatedStatNumber raw={raw} delayMs={delayMs} />
      </div>
      <div className="mt-2 font-mono text-[12px] uppercase tracking-[0.16em] text-pv-muted">
        {label}
      </div>
    </div>
  );
}

function MaskIcon({ src, className }: { src: string; className: string }) {
  return (
    <span
      className={`${className} shrink-0 bg-pv-emerald`}
      style={{
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
      }}
      aria-hidden
    />
  );
}

const STEPS: {
  iconSrc: string;
  watermark: string;
  title: string;
  description: string;
  span: string;
  foot?: [string, string];
}[] = [
  {
    iconSrc: "/icons/handshake-logo.svg",
    watermark: "/icons/handshake-logo.svg",
    title: "Create",
    description:
      "Stake USDC on one side of a verifiable question. The claim is escrowed in the program vault and delegated to the Ephemeral Rollup — the market goes live.",
    span: "sm:col-span-2 lg:col-span-2",
    foot: ["Base layer · Solana", "Escrowed"],
  },
  {
    iconSrc: "/icons/letter.svg",
    watermark: "/icons/user.svg",
    title: "Challenge",
    description:
      "Anyone stakes the other side from their virtual balance. Inside the ER, every bet is zero-fee and lands in ~30ms.",
    span: "lg:col-span-1",
  },
  {
    iconSrc: "/icons/check-circle-logo.svg",
    watermark: "/icons/thumb-up.svg",
    title: "Resolve",
    description:
      "At the deadline the oracle commits ER state to Solana, fetches the Flash Trade evidence, and an LLM returns a verdict with a confidence tier.",
    span: "lg:col-span-1",
  },
  {
    iconSrc: "/icons/verified.svg",
    watermark: "/icons/verify.svg",
    title: "Payout",
    description:
      "The evidence hash lands on-chain and winners pull USDC from the vault. FIRM pays out, ambiguous claims refund.",
    span: "sm:col-span-2 lg:col-span-4",
    foot: ["Settlement", "Vault payout"],
  },
];

export default function HomePage() {
  const [feed, setFeed] = useState<ArenaFeed | null>(null);
  const heroRef = useRef<HTMLDivElement>(null);

  // Hero entrance on GSAP (GSAP replaces the old motion variants): words rise out of
  // blur in sequence, then the copy, tags and CTAs. Off under reduced motion.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK_QUERY, () => {
        gsap.fromTo("[data-kinetic]", kineticLetter.from, kineticLetter.to);
        gsap.fromTo(
          "[data-hero-fade]",
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: 0.5, delay: 0.5, stagger: 0.04, ease: "power2.out" },
        );
      });
      return () => mm.revert();
    },
    { scope: heroRef },
  );

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/arena/claims");
        const json = await res.json();
        if (alive && json.success) {
          setFeed(json.data as ArenaFeed);
        }
      } catch {
        // keep last good state; the page renders tasteful zeros if never loaded
      }
    };
    void load();
    const id = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const claims = feed?.claims ?? [];
  const totalMarkets = feed?.claimCount ?? 0;
  const totalResolved = feed?.totalResolved ?? 0;
  const openPoolUsdc = feed ? usdc(feed.openPool) : "0";
  const liveOnEr = claims.filter((c) => c.delegated).length;

  const liveCards = claims.filter((c) => c.state <= 1).slice(0, 5);

  const resolvedCards = claims
    .filter((c) => c.state === 2 && c.winnerSide !== 0)
    .slice(0, 6);

  return (
    <PageTransition>
      {/* Hero — manifesto over the ASCII wave field, framed by the rails */}
      <AnimatedItem>
        <section className="relative -mt-[calc(3.5rem+env(safe-area-inset-top))] w-full">
          {/* Backdrop fills the rail column edge-to-edge and bleeds up under
              the transparent fixed navbar (rails reach the top of the page). */}
          <div className="absolute inset-0 z-0 overflow-hidden">
            <HeroAscii />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-pv-bg via-pv-bg/35 to-transparent sm:h-32" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-pv-bg via-pv-bg/60 to-transparent sm:h-40" />
          </div>

          <div className="relative z-10 flex min-h-[78vh] w-full items-center justify-center border-x border-pv-border/25 px-4 pt-[calc(3.5rem+env(safe-area-inset-top))] sm:px-6 lg:px-8">
            <div ref={heroRef} className="w-full max-w-[640px] py-12 text-center sm:py-14 lg:py-16">
              <h1
                className="mb-6 flex flex-col gap-1 text-center font-display font-bold leading-[0.92] tracking-tight text-pv-text"
              >
                <span className="block overflow-hidden text-[clamp(2.4rem,9vw,4.6rem)] lg:text-[clamp(3rem,4.4vw,5rem)]">
                  <span data-kinetic className="inline-block whitespace-nowrap">
                    DON&apos;T ARGUE.
                  </span>
                </span>
                <span className="block overflow-hidden text-[clamp(2.4rem,9vw,4.6rem)] lg:text-[clamp(3rem,4.4vw,5rem)]">
                  <span data-kinetic className="inline-block whitespace-nowrap">
                    SETTLE.
                  </span>
                </span>
                <span className="block h-2 lg:h-3" aria-hidden />
                <span className="block overflow-hidden text-[clamp(2.3rem,8vw,4rem)] lg:text-[clamp(2.8rem,4.5vw,4.2rem)]">
                  <span data-kinetic className="mr-[0.25em] inline-block font-medium text-pv-muted">
                    With
                  </span>
                  <span
                    data-kinetic
                    className="inline-block italic text-pv-emerald drop-shadow-[0_0_18px_rgba(255,81,72,0.45)]"
                  >
                    Mimir.
                  </span>
                </span>
              </h1>

              <p
                data-hero-fade
                className="mx-auto mb-5 max-w-[480px] text-[13px] leading-relaxed text-pv-muted sm:text-sm lg:text-[15px] lg:leading-7"
              >
                An AI-settled prediction market on Solana. Stake USDC, challenge
                inside a MagicBlock Ephemeral Rollup at zero fees, and let the
                oracle resolve against Flash Trade prices on-chain.
              </p>

              <div
                data-hero-fade
                className="mb-7 flex flex-wrap items-center justify-center gap-2"
              >
                {["Solana devnet", "Ephemeral Rollup · ~30ms", "USDC · zero-fee bets"].map((tag, i) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 border border-pv-border/25 bg-pv-bg/70 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted"
                  >
                    {i === 0 ? <span className="h-1.5 w-1.5 rounded-full bg-pv-gold" /> : null}
                    {tag}
                  </span>
                ))}
              </div>

              <div
                data-hero-fade
                className="flex flex-col gap-3 sm:flex-row sm:justify-center sm:gap-4"
              >
                <Link
                  href="/docs"
                  className="flex items-center justify-center border border-pv-border/40 bg-pv-bg/70 px-7 py-3.5 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-pv-text transition-colors duration-200 hover:border-pv-emerald/70 hover:text-pv-emerald focus-ring"
                >
                  How it works
                </Link>
                <Link
                  href="/arena"
                  className="flex items-center justify-center border border-pv-emerald bg-pv-emerald px-7 py-3.5 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-pv-bg transition-[filter,box-shadow] duration-200 hover:shadow-glow hover:brightness-110 focus-ring"
                >
                  Enter the arena
                </Link>
              </div>
            </div>
          </div>
        </section>
      </AnimatedItem>

      {/* Live stats strip — Solana arena feed */}
      <AnimatedItem>
        <section>
          <BlueprintHeading>On-chain, right now</BlueprintHeading>
          <div className="bp-grid grid-cols-2 border-x border-pv-border/25 sm:grid-cols-4">
            <StatTile raw={String(totalMarkets)} label="Markets" delayMs={0} />
            <StatTile raw={String(totalResolved)} label="Resolved" delayMs={80} />
            <StatTile raw={String(liveOnEr)} label="Live on ER" delayMs={160} />
            <StatTile raw={`$${openPoolUsdc}`} label="Open pool · USDC" color="gold" delayMs={240} />
          </div>
        </section>
      </AnimatedItem>

      {/* THE PROTOCOL — ruled bento grid */}
      <AnimatedItem>
        <section>
          <BlueprintHeading>The protocol</BlueprintHeading>
          <div className="bp-grid grid-cols-1 border-x border-pv-border/25 sm:grid-cols-2 lg:auto-rows-[minmax(240px,auto)] lg:grid-cols-4">
            {STEPS.map((step, index) => {
              const stepLabel = `STEP ${String(index + 1).padStart(2, "0")}`;
              const wide = index === 3;
              return (
                <div
                  key={step.title}
                  className={`bp-cell group relative flex flex-col justify-between gap-6 overflow-hidden p-6 transition-colors duration-200 hover:bg-pv-surface sm:p-8 ${step.span} ${
                    wide ? "lg:flex-row lg:items-center lg:gap-10" : ""
                  }`}
                >
                  <div className="pointer-events-none absolute -right-8 -top-8 opacity-[0.06] transition-opacity group-hover:opacity-[0.1]">
                    <MaskIcon src={step.watermark} className="block h-40 w-40 sm:h-48 sm:w-48" />
                  </div>
                  <div className="relative z-10 flex min-w-0 flex-1 items-start gap-4">
                    <MaskIcon src={step.iconSrc} className="h-10 w-10 sm:h-12 sm:w-12" />
                    <div className="min-w-0">
                      <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-emerald">
                        {stepLabel}
                      </div>
                      <h3 className="font-display text-xl font-bold uppercase leading-tight tracking-tight text-pv-text sm:text-2xl">
                        {step.title}
                      </h3>
                      <p className="mt-2 max-w-prose text-sm leading-relaxed text-pv-muted sm:text-[15px]">
                        {step.description}
                      </p>
                    </div>
                  </div>
                  {step.foot ? (
                    <div
                      className={`relative z-10 flex items-center justify-between gap-3 border-t border-pv-border/25 pt-4 ${
                        wide ? "lg:flex-col lg:items-end lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0" : ""
                      }`}
                    >
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
                        {step.foot[0]}
                      </span>
                      <span className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-pv-emerald">
                        {step.foot[1]}
                      </span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      </AnimatedItem>

      {/* SETTLEMENT DATA — what price settlement reads, and who provides it */}
      <AnimatedItem>
        <SettlementDataSection />
      </AnimatedItem>

      {/* LIVE ARENA — open/active markets from the feed */}
      {liveCards.length > 0 && (
        <AnimatedItem>
          <section>
            <BlueprintHeading>Live arena</BlueprintHeading>
            <div className="bp-grid grid-cols-1 border-x border-pv-border/25 sm:grid-cols-2 lg:grid-cols-3">
              {liveCards.map((c) => {
                const pool = usdc(
                  (Number(c.creatorStake) + Number(c.totalChallengerStake)).toString()
                );
                const max = c.maxChallengers && c.maxChallengers > 0 ? c.maxChallengers : 1;
                return (
                  <Link
                    key={c.id}
                    href={`/arena/${c.id}`}
                    className="bp-cell group relative flex flex-col gap-4 p-5 transition-colors duration-200 hover:bg-pv-surface focus-ring sm:p-6"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="border border-pv-border/25 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                        {c.category}
                      </span>
                      <span className="border border-pv-emerald/40 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-emerald">
                        {STATE_LABELS[c.state] ?? "—"}
                      </span>
                      {c.delegated && (
                        <span className="inline-flex items-center gap-1 bg-pv-emerald/[0.12] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-pv-emerald">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pv-emerald" />
                          Live on ER
                        </span>
                      )}
                    </div>
                    <h3 className="line-clamp-3 font-display text-base font-semibold leading-snug tracking-tight text-pv-text group-hover:text-pv-emerald">
                      {c.question}
                    </h3>
                    <div className="mt-auto flex items-center justify-between gap-3 border-t border-pv-border/25 pt-4">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <PeepStack
                          seeds={c.challengers.map((ch) => `challenger-${ch.addr}`)}
                          placeholders={Math.min(max, 3)}
                          size={26}
                        />
                        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-pv-muted">
                          {c.challengers.length}/{max}
                        </span>
                      </span>
                      <span className="font-mono text-sm font-bold text-pv-gold">
                        ${pool} <span className="text-[11px] font-normal text-pv-muted">USDC</span>
                      </span>
                    </div>
                  </Link>
                );
              })}
              <Link
                href="/arena/create"
                className="bp-cell group flex min-h-[180px] flex-col items-center justify-center gap-3 p-6 text-center transition-colors duration-200 hover:bg-pv-emerald/[0.06] focus-ring"
              >
                <span className="flex h-11 w-11 items-center justify-center border border-dashed border-pv-emerald/60 font-display text-2xl text-pv-emerald">
                  +
                </span>
                <span className="font-display text-sm font-bold uppercase tracking-[0.14em] text-pv-text group-hover:text-pv-emerald">
                  Publish a challenge
                </span>
              </Link>
            </div>
            <Link
              href="/arena"
              className="block w-full border-x border-t border-pv-border/25 bg-pv-emerald/[0.06] py-3.5 text-center font-display text-sm font-bold text-pv-emerald transition-colors hover:bg-pv-emerald/[0.12] focus-ring"
            >
              View all markets in the arena →
            </Link>
          </section>
        </AnimatedItem>
      )}

      {/* READY TO PLAY CTA — framed strip on graph paper */}
      <AnimatedItem>
        <div className="bp-paper group relative overflow-hidden border border-pv-border/25 bg-pv-surface px-6 py-12 sm:px-10 sm:py-14 md:px-14 md:py-16">
          <div
            className="pointer-events-none absolute -right-24 top-1/2 h-80 w-80 -translate-y-1/2 rounded-full bg-pv-fuch/20 blur-3xl"
            aria-hidden
          />
          <div className="relative z-10 flex flex-col items-start gap-8 text-left md:flex-row md:items-center md:justify-between md:gap-12">
            <div className="max-w-xl">
              <div className="mb-5 flex items-center gap-3">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pv-gold opacity-40" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-pv-gold" />
                </span>
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-pv-muted">
                  Markets are live
                </span>
              </div>
              <h2 className="font-display text-[clamp(2rem,7vw,3.4rem)] font-bold leading-[0.95] tracking-tight text-pv-text">
                READY TO <span className="text-pv-emerald">PLAY?</span>
              </h2>
              <p className="mt-4 max-w-[48ch] text-sm leading-relaxed text-pv-muted sm:text-base">
                Deposit USDC, delegate your balance once, then challenge any open
                market for free inside the Ephemeral Rollup. When the deadline
                hits, Mimir settles it against the Flash Trade oracle on-chain.
              </p>
            </div>
            <div className="w-full shrink-0 md:w-auto">
              <Link href="/arena" className="block w-full md:w-auto">
                <Button
                  variant="primary"
                  className="w-full px-10 py-4 font-display text-xs font-bold uppercase tracking-[0.2em] md:w-auto"
                >
                  ENTER THE ARENA
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </AnimatedItem>

      {/* THE LEDGER — recently settled markets, ruled table */}
      {resolvedCards.length > 0 && (
        <AnimatedItem>
          <section>
            <BlueprintHeading>The ledger</BlueprintHeading>
            <div className="grid gap-px border-x border-pv-border/25 bg-pv-border/25">
              {resolvedCards.map((c) => {
                const pool = usdc(
                  (Number(c.creatorStake) + Number(c.totalChallengerStake)).toString()
                );
                const tier =
                  c.confidence >= 80 ? "FIRM" : c.confidence >= 60 ? "CONTESTED" : "REFUND";
                return (
                  <Link
                    key={c.id}
                    href={`/arena/${c.id}`}
                    className="group flex min-w-0 items-center justify-between gap-4 bg-pv-bg px-5 py-4 transition-colors hover:bg-pv-surface focus-ring sm:px-6"
                  >
                    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                      <span className="w-10 shrink-0 font-mono text-[11px] text-pv-muted">#{c.id}</span>
                      <span className="hidden shrink-0 border border-pv-emerald/40 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-pv-emerald sm:inline-block">
                        {tier}
                      </span>
                      <span className="truncate font-mono text-[13px] text-pv-text/90">{c.question}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="font-mono text-[13px] font-bold text-pv-gold">${pool}</span>
                      <span className="font-mono text-pv-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-pv-emerald">
                        →
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        </AnimatedItem>
      )}
    </PageTransition>
  );
}
