"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import PlasmaBackdrop from "@/components/PlasmaBackdrop";
import { Link } from "@/i18n/navigation";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import { Button } from "@/components/ui";
import { kineticContainer, kineticLetter } from "@/lib/animations/rituals";
import { formatUsdcUnitsBare as usdc } from "@/lib/money";

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
  challengers: { addr: string; stake: string; paid: boolean }[];
}

interface ArenaFeed {
  claims: ArenaClaim[];
  claimCount: number;
  totalResolved: number;
  openPool: string;
}

/** USDC base units (6 decimals) → human string. */
const STATE_LABELS = ["OPEN", "ACTIVE", "RESOLVED", "CANCELLED"] as const;

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
  const reducedMotion = useReducedMotion();

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
  const isInView = useInView(ref, { once: true, amount: 0.05 });

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
  const valueColor =
    color === "gold" ? "text-pv-gold" : "text-pv-emerald";
  return (
    <div className="p-5 sm:p-6 text-center border border-pv-border/[0.06] rounded-xl bg-pv-surface/30">
      <div
        className={`font-display text-3xl font-bold tracking-tight sm:text-4xl ${valueColor}`}
      >
        <AnimatedStatNumber raw={raw} delayMs={delayMs} />
      </div>
      <div className="mt-2 text-[12px] font-mono uppercase tracking-[0.16em] text-pv-muted">
        {label}
      </div>
    </div>
  );
}

export default function HomePage() {
  const [feed, setFeed] = useState<ArenaFeed | null>(null);

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

  const liveCards = claims
    .filter((c) => c.state <= 1)
    .slice(0, 6);

  const resolvedCards = claims
    .filter((c) => c.state === 2 && c.winnerSide !== 0)
    .slice(0, 4);

  const steps = [
    {
      iconSrc: "/icons/handshake-logo.svg",
      title: "1. CREATE",
      description:
        "Stake USDC on one side of a verifiable question. The claim is escrowed in the program vault and delegated to the Ephemeral Rollup — the market goes live.",
    },
    {
      iconSrc: "/icons/letter.svg",
      title: "2. CHALLENGE",
      description:
        "Anyone stakes the other side from their virtual balance. Inside the ER, every bet is zero-fee and lands in ~30ms.",
    },
    {
      iconSrc: "/icons/check-circle-logo.svg",
      title: "3. RESOLVE",
      description:
        "At the deadline the oracle commits ER state to Solana, fetches the Flash Trade evidence, and an LLM returns a verdict with a confidence tier.",
    },
    {
      iconSrc: "/icons/verified.svg",
      title: "4. PAYOUT",
      description:
        "The evidence hash lands on-chain and winners pull USDC from the vault. FIRM pays out, ambiguous claims refund. No committees, no disputes.",
    },
  ];

  return (
    <PageTransition>
      {/* Hero — manifesto with kinetic typography */}
      <AnimatedItem>
        <section className="relative mb-6 w-full sm:mb-8">
          {/* Plasma WebGL backdrop — full-viewport-bleed */}
          <div className="absolute inset-y-0 left-1/2 z-0 h-full w-screen -translate-x-1/2 overflow-hidden">
            <PlasmaBackdrop />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-pv-bg via-pv-bg/35 to-transparent sm:h-32" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-pv-bg via-pv-bg/60 to-transparent sm:h-40" />
          </div>

          <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1200px] items-center justify-center px-4 sm:px-6 lg:px-8 pt-[env(safe-area-inset-top,0px)]">
            <div className="w-full max-w-[640px] pt-14 pb-28 sm:py-16 lg:py-20 text-center">
              <motion.h1
                className="mb-6 flex flex-col gap-1 text-center font-display font-bold leading-[0.92] tracking-tight text-pv-text"
                variants={kineticContainer}
                initial="hidden"
                animate="visible"
              >
                <span className="block overflow-hidden text-[clamp(2.6rem,7vw,4.6rem)] lg:text-[clamp(3rem,4.4vw,5rem)]">
                  <motion.span variants={kineticLetter} className="inline-block whitespace-nowrap">
                    DON&apos;T ARGUE.
                  </motion.span>
                </span>
                <span className="block overflow-hidden text-[clamp(2.6rem,7vw,4.6rem)] lg:text-[clamp(3rem,4.4vw,5rem)]">
                  <motion.span variants={kineticLetter} className="inline-block whitespace-nowrap">
                    SETTLE.
                  </motion.span>
                </span>
                <span className="block h-2 lg:h-3" aria-hidden />
                <span className="block overflow-hidden text-[clamp(2.7rem,7vw,4rem)] lg:text-[clamp(2.8rem,4.5vw,4.2rem)]">
                  <motion.span variants={kineticLetter} className="inline-block mr-[0.25em] font-medium text-pv-muted">
                    With
                  </motion.span>
                  <motion.span
                    variants={kineticLetter}
                    className="inline-block italic text-pv-emerald drop-shadow-[0_0_18px_rgba(153,69,255,0.5)]"
                  >
                    Mimir.
                  </motion.span>
                </span>
              </motion.h1>

              <motion.p
                className="mb-5 mx-auto max-w-[480px] text-[13px] leading-relaxed text-pv-muted/90 sm:text-sm lg:text-[15px] lg:leading-7"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.5 }}
              >
                An AI-settled prediction market on Solana. Stake USDC, challenge
                inside a MagicBlock Ephemeral Rollup at zero fees, and let the
                oracle resolve against Flash Trade prices on-chain.
              </motion.p>

              <motion.div
                className="mb-6 flex flex-wrap items-center justify-center gap-2"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.54, duration: 0.5 }}
              >
                <span className="inline-flex items-center gap-1.5 rounded-full border border-pv-border/25 bg-pv-surface/50 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-pv-emerald" />
                  Solana devnet
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-pv-border/25 bg-pv-surface/50 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                  Ephemeral Rollup · ~30ms
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-pv-border/25 bg-pv-surface/50 px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                  USDC · zero-fee bets
                </span>
              </motion.div>

              <motion.div
                className="flex flex-col gap-3 sm:flex-row sm:justify-center sm:gap-4"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.58, duration: 0.5 }}
              >
                {/* Secondary CTA — Docs */}
                <Link
                  href="/docs"
                  className="group relative flex items-center justify-center overflow-hidden rounded-lg border border-pv-fuch/30 bg-transparent px-7 py-3.5 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-pv-fuch/80 transition-all duration-300 hover:border-pv-fuch/60 hover:bg-pv-fuch/[0.1] hover:text-pv-fuch hover:shadow-[0_0_28px_-4px_rgba(124,58,237,0.45),inset_0_0_20px_-8px_rgba(124,58,237,0.12)]"
                >
                  <span className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-r from-pv-fuch/[0.1] via-transparent to-pv-fuch/[0.05]" />
                  <span className="relative">How it works</span>
                </Link>

                {/* Primary CTA — Arena */}
                <Link
                  href="/arena"
                  className="group relative flex items-center justify-center overflow-hidden rounded-lg border border-pv-emerald/40 bg-pv-emerald/[0.08] px-7 py-3.5 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-pv-emerald transition-all duration-300 hover:border-pv-emerald/70 hover:bg-pv-emerald/[0.15] hover:text-white hover:shadow-[0_0_28px_-4px_rgba(153,69,255,0.5),inset_0_0_20px_-8px_rgba(153,69,255,0.15)]"
                >
                  <span className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-r from-pv-emerald/[0.12] via-transparent to-pv-emerald/[0.06]" />
                  <span className="relative">Enter the arena</span>
                </Link>
              </motion.div>
            </div>
          </div>
        </section>
      </AnimatedItem>

      {/* Live stats strip — Solana arena feed */}
      <AnimatedItem>
        <div className="mb-12">
          <div className="mb-10 flex items-center gap-4 sm:gap-6">
            <h2 className="font-display text-2xl font-bold uppercase tracking-tighter text-pv-text sm:text-3xl md:text-4xl">
              ON-CHAIN, RIGHT NOW
            </h2>
            <div className="h-px flex-1 bg-pv-border/[0.12]" aria-hidden />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
            <StatTile raw={String(totalMarkets)} label="Markets" color="emerald" delayMs={0} />
            <StatTile raw={String(totalResolved)} label="Resolved" color="emerald" delayMs={80} />
            <StatTile raw={String(liveOnEr)} label="Live on ER" color="emerald" delayMs={160} />
            <StatTile raw={`$${openPoolUsdc}`} label="Open pool · USDC" color="gold" delayMs={240} />
          </div>
        </div>
      </AnimatedItem>

      {/* THE PROTOCOL — bento grid */}
      <AnimatedItem>
        <div className="mb-12">
          <div className="mb-10 flex items-center gap-4 sm:gap-6">
            <h2 className="font-display text-2xl font-bold uppercase tracking-tighter text-pv-text sm:text-3xl md:text-4xl">
              THE PROTOCOL
            </h2>
            <div className="h-px flex-1 bg-pv-border/[0.12]" aria-hidden />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4 md:auto-rows-[minmax(240px,auto)]">
            {steps.map(({ iconSrc, title, description }, index) => {
              const stepLabel = `STEP ${String(index + 1).padStart(2, "0")}`;

              const renderIcon = (sizeClass: string) => (
                <span
                  className={`${sizeClass} shrink-0 bg-pv-emerald`}
                  style={{
                    WebkitMaskImage: `url(${iconSrc})`,
                    maskImage: `url(${iconSrc})`,
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

              if (index === 0) {
                return (
                  <div
                    key={title}
                    className="card group relative col-span-1 flex flex-col justify-between overflow-hidden border-pv-border/[0.12] p-6 transition-all duration-200 hover:border-pv-emerald/[0.45] hover:shadow-glow-emerald sm:p-8 md:col-span-2 md:min-h-[280px]"
                  >
                    <div className="pointer-events-none absolute -right-6 -top-6 opacity-[0.06] transition-opacity group-hover:opacity-[0.1] sm:-right-10 sm:-top-10">
                      <span
                        className="block h-40 w-40 bg-pv-emerald sm:h-48 sm:w-48"
                        style={{
                          WebkitMaskImage: `url(${iconSrc})`,
                          maskImage: `url(${iconSrc})`,
                          WebkitMaskRepeat: "no-repeat",
                          maskRepeat: "no-repeat",
                          WebkitMaskPosition: "center",
                          maskPosition: "center",
                          WebkitMaskSize: "contain",
                          maskSize: "contain",
                        }}
                        aria-hidden
                      />
                    </div>
                    <div className="relative z-10 flex min-w-0 flex-1 items-start gap-4 md:items-center">
                      {renderIcon("h-12 w-12 shrink-0 sm:h-14 sm:w-14")}
                      <div className="min-w-0">
                        <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-emerald">
                          {stepLabel}
                        </div>
                        <h3 className="font-display text-xl font-bold leading-tight tracking-tight text-pv-text sm:text-2xl md:text-3xl">
                          {title.replace(/^\d+\.\s*/, "")}
                        </h3>
                        <p className="mt-2 max-w-prose text-sm leading-relaxed text-pv-muted sm:text-[15px]">
                          {description}
                        </p>
                      </div>
                    </div>
                    <div className="relative z-10 mt-6 h-px bg-gradient-to-r from-pv-emerald/40 to-transparent opacity-40" />
                    <div className="relative z-10 mt-4 flex items-center justify-between gap-3">
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
                        Base layer · Solana
                      </span>
                      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-pv-emerald">
                        Escrowed
                      </span>
                    </div>
                  </div>
                );
              }

              if (index === 1 || index === 2) {
                return (
                  <div
                    key={title}
                    className="card group relative overflow-hidden flex flex-col justify-between border-pv-border/[0.12] p-6 transition-all duration-200 hover:border-pv-emerald/[0.45] hover:shadow-glow-emerald sm:p-8 md:col-span-1 md:min-h-[280px]"
                  >
                    <div className="pointer-events-none absolute -right-9 -top-6 z-0 opacity-[0.06] transition-opacity group-hover:opacity-[0.1] sm:-right-13 sm:-top-10">
                      <span
                        className="block h-40 w-40 bg-pv-emerald sm:h-48 sm:w-48"
                        style={{
                          WebkitMaskImage: `url(${
                            index === 1 ? "/icons/user.svg" : "/icons/thumb-up.svg"
                          })`,
                          maskImage: `url(${
                            index === 1 ? "/icons/user.svg" : "/icons/thumb-up.svg"
                          })`,
                          WebkitMaskRepeat: "no-repeat",
                          maskRepeat: "no-repeat",
                          WebkitMaskPosition: "center",
                          maskPosition: "center",
                          WebkitMaskSize: "contain",
                          maskSize: "contain",
                        }}
                        aria-hidden
                      />
                    </div>
                    <div className="relative z-10">
                      <div className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-emerald">
                        {stepLabel}
                      </div>
                      <div className="mb-4">{renderIcon("h-10 w-10 sm:h-11 sm:w-11")}</div>
                      <h3 className="font-display text-lg font-bold leading-tight tracking-tight text-pv-text sm:text-xl">
                        {title}
                      </h3>
                    </div>
                    <p className="relative z-10 mt-4 text-sm leading-relaxed text-pv-muted sm:text-[15px]">
                      {description}
                    </p>
                  </div>
                );
              }

              /* index === 3 — wide bar */
              return (
                <div
                  key={title}
                  className="card group relative col-span-1 overflow-hidden flex flex-col gap-6 border-pv-border/[0.12] p-6 transition-all duration-200 hover:border-pv-emerald/[0.45] hover:shadow-glow-emerald sm:p-8 md:col-span-4 md:flex-row md:items-center md:justify-between md:gap-10"
                >
                  <div className="pointer-events-none absolute -right-9 -top-6 z-0 opacity-[0.06] transition-opacity group-hover:opacity-[0.1] sm:-right-13 sm:-top-10">
                    <span
                      className="block h-40 w-40 bg-pv-emerald sm:h-48 sm:w-48"
                      style={{
                        WebkitMaskImage: "url(/icons/verify.svg)",
                        maskImage: "url(/icons/verify.svg)",
                        WebkitMaskRepeat: "no-repeat",
                        maskRepeat: "no-repeat",
                        WebkitMaskPosition: "center",
                        maskPosition: "center",
                        WebkitMaskSize: "contain",
                        maskSize: "contain",
                      }}
                      aria-hidden
                    />
                  </div>
                  <div className="relative z-10 flex min-w-0 flex-1 items-start gap-4 md:items-center">
                    {renderIcon("h-11 w-11 shrink-0 sm:h-12 sm:w-12")}
                    <div className="min-w-0">
                      <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-pv-emerald">
                        {stepLabel}
                      </div>
                      <h3 className="font-display text-xl font-medium tracking-tighter text-pv-text sm:text-2xl md:text-3xl">
                        {title.replace(/^\d+\.\s*/, "")}
                      </h3>
                      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-pv-muted sm:text-[15px]">
                        {description}
                      </p>
                    </div>
                  </div>
                  <div className="relative z-10 hidden h-12 w-px shrink-0 bg-pv-border/[0.1] md:block" aria-hidden />
                  <div className="relative z-10 flex shrink-0 flex-col items-start gap-1 md:items-end md:text-right">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
                      Settlement
                    </span>
                    <span className="font-display text-lg font-semibold text-pv-emerald sm:text-xl">
                      Vault payout
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </AnimatedItem>

      {/* LIVE ARENA — open/active markets from the feed */}
      {liveCards.length > 0 && (
        <AnimatedItem>
          <div className="mb-12">
            <div className="mb-10 flex items-center gap-4 sm:gap-6">
              <h2 className="font-display text-2xl font-bold uppercase tracking-tighter text-pv-text sm:text-3xl md:text-4xl">
                LIVE ARENA
              </h2>
              <div className="h-px flex-1 bg-pv-border/[0.12]" aria-hidden />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {liveCards.map((c) => {
                const pool = usdc(
                  (
                    Number(c.creatorStake) + Number(c.totalChallengerStake)
                  ).toString()
                );
                return (
                  <Link
                    key={c.id}
                    href={`/arena/${c.id}`}
                    className="card group relative flex flex-col gap-3 overflow-hidden border-pv-border/[0.12] p-5 transition-all duration-200 hover:border-pv-emerald/[0.45] hover:shadow-glow-emerald"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-pv-surface/60 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                        {c.category}
                      </span>
                      <span className="rounded-full bg-pv-surface/60 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-emerald">
                        {STATE_LABELS[c.state]}
                      </span>
                      {c.delegated && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-pv-emerald/[0.12] px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-pv-emerald">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pv-emerald" />
                          Live on ER
                        </span>
                      )}
                    </div>
                    <h3 className="line-clamp-3 font-display text-base font-semibold leading-snug tracking-tight text-pv-text group-hover:text-pv-emerald">
                      {c.question}
                    </h3>
                    <div className="mt-auto flex items-center justify-between border-t border-pv-border/[0.06] pt-3">
                      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-pv-muted">
                        {c.challengers.length} challenger
                        {c.challengers.length === 1 ? "" : "s"}
                      </span>
                      <span className="font-mono text-sm font-bold text-pv-gold">
                        ${pool} <span className="text-[11px] font-normal text-pv-muted">USDC</span>
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>

            <Link
              href="/arena"
              className="mt-3 block w-full border border-pv-emerald/[0.24] bg-pv-emerald/[0.06] py-3.5 text-center font-display text-sm font-bold text-pv-emerald transition-colors hover:bg-pv-emerald/[0.1]"
            >
              View all markets in the arena
            </Link>
          </div>
        </AnimatedItem>
      )}

      {/* READY TO PLAY CTA */}
      <AnimatedItem>
        <div className="mt-16 sm:mt-20 mb-12">
          <div className="group relative w-full overflow-hidden rounded-lg border border-pv-border/[0.12] bg-pv-surface/80 px-6 py-10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] backdrop-blur-xl sm:p-10 md:p-12 lg:p-14">
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-[0.14] transition-opacity duration-700 group-hover:opacity-[0.2]"
              aria-hidden
            >
              <div className="h-full w-full bg-gradient-to-l from-pv-emerald/40 via-pv-emerald/10 to-transparent" />
            </div>
            <div
              className="pointer-events-none absolute -right-20 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-pv-emerald/20 blur-3xl"
              aria-hidden
            />

            <div className="relative z-10 flex flex-col items-start gap-7 text-left sm:gap-8 md:flex-row md:items-end md:justify-between md:gap-10">
              <div className="max-w-xl">
                <div className="mb-4 flex items-center gap-3">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pv-emerald opacity-40" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-pv-emerald" />
                  </span>
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-pv-muted">
                    Markets are live
                  </span>
                </div>

                <h2 className="font-display text-[clamp(1.9rem,7vw,3.1rem)] font-bold leading-[0.95] tracking-tight text-pv-text">
                  READY TO <span className="text-pv-emerald">PLAY?</span>
                </h2>
                <p className="mt-4 max-w-[48ch] text-sm leading-relaxed text-pv-muted sm:text-base">
                  Deposit USDC, delegate your balance once, then challenge any
                  open market for free inside the Ephemeral Rollup. When the
                  deadline hits, Mimir settles it against the Flash Trade oracle
                  on-chain.
                </p>
              </div>

              <div className="w-full md:w-auto">
                <Link href="/arena" className="block w-full md:w-auto">
                  <Button
                    variant="primary"
                    className="w-full md:w-auto px-8 font-display text-xs font-bold uppercase tracking-[0.2em]"
                  >
                    ENTER THE ARENA
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </AnimatedItem>

      {/* Recently resolved — terminal/ledger aesthetic */}
      {resolvedCards.length > 0 && (
        <AnimatedItem>
          <div className="mb-10">
            <div className="mb-4 flex items-center gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-pv-emerald shadow-[0_0_8px_rgba(153,69,255,0.6)]" />
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-pv-emerald">
                Recently settled
              </span>
            </div>
            <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
              {resolvedCards.map((c) => {
                const pool = usdc(
                  (
                    Number(c.creatorStake) + Number(c.totalChallengerStake)
                  ).toString()
                );
                const tier =
                  c.confidence >= 80
                    ? "FIRM"
                    : c.confidence >= 60
                      ? "CONTESTED"
                      : "REFUND";
                return (
                  <Link key={c.id} href={`/arena/${c.id}`} className="group block">
                    <motion.div
                      whileHover={{ x: 4 }}
                      className="flex items-center justify-between rounded border border-pv-border/[0.06] bg-pv-border/[0.02] p-3 transition-colors group-hover:border-pv-emerald/[0.25]"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="w-8 shrink-0 font-mono text-[10px] text-pv-muted/40">
                          #{c.id}
                        </span>
                        <span className="h-1 w-1 shrink-0 rounded-full bg-pv-emerald" />
                        <span className="truncate font-mono text-[12px] text-pv-text/80">
                          {c.question}
                        </span>
                      </div>
                      <div className="ml-2 flex shrink-0 items-center gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-pv-muted">
                          {tier}
                        </span>
                        <span className="font-mono text-[12px] font-bold text-pv-gold">
                          ${pool}
                        </span>
                      </div>
                    </motion.div>
                  </Link>
                );
              })}
            </div>
          </div>
        </AnimatedItem>
      )}
    </PageTransition>
  );
}
