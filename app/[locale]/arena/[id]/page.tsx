"use client";

/**
 * /arena/[id] — claim detail + the three-step challenge flow:
 *   1. deposit USDC into the Mimir escrow vault   (base layer, one-time)
 *   2. delegate the balance PDA to the ER          (base layer, one-time)
 *   3. challenge                                   (Ephemeral Rollup, ~30ms)
 *
 * Steps 1–2 only happen the first time; after that every bet is instant.
 *
 * Visual structure mirrors the original Mimir claim-detail page (vs/[id]):
 * MIMIR VS hero → phase progress nav → 8/4 grid (duel Stage card + market
 * terms + action panel on the left, sticky sidebar with challengers/settlement
 * on the right). EVM-only pieces (XMTP, rematch, ERC20 approve, pending-tx,
 * resolve-request) are dropped; the Solana deposit→delegate→challenge flow and
 * its data layer are preserved exactly.
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  createBrowserMimir,
  depositUsdc,
  delegateBalance,
  challengeInER,
  getVirtualBalance,
} from "@/lib/solana/browser-client";
import CouncilVotes from "@/components/arena/CouncilVotes";
import { formatUsdcUnitsBare as usdc } from "@/lib/money";
import { txErrorMessage } from "@/lib/tx-errors";

interface ArenaClaim {
  id: number;
  creator: string;
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  category: string;
  creatorStake: string;
  totalChallengerStake: string;
  deadline: number;
  state: number;
  winnerSide: number;
  resolutionSummary: string;
  confidence: number;
  maxChallengers?: number;
  delegated: boolean;
  challengers: { addr: string; stake: string; paid: boolean }[];
}

const SIDE_LABELS = ["—", "Creator wins", "Challengers win", "Draw — refunded", "Unresolvable — refunded"];

/** Phase nav steps — mirrors the original Created/Accepted/Verifying/Proven bar. */
const PHASE_STEPS = ["Created", "Accepted", "Verifying", "Proven"];

function shorten(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

function confidenceTone(c: number): { label: string; cls: string; dot: string; text: string } {
  if (c >= 80)
    return {
      label: "FIRM · high confidence",
      cls: "border-pv-emerald/40 bg-pv-emerald/[0.08] text-pv-emerald",
      dot: "bg-pv-emerald",
      text: "text-pv-emerald",
    };
  if (c >= 60)
    return {
      label: "CONTESTED · medium confidence",
      cls: "border-black/[0.14] bg-pv-surface2/60 text-pv-text/80",
      dot: "bg-pv-cyan",
      text: "text-pv-cyan",
    };
  return {
    label: "REFUNDED · low confidence",
    cls: "border-pv-gold/40 bg-pv-gold/[0.10] text-pv-gold",
    dot: "bg-pv-gold",
    text: "text-pv-gold",
  };
}

/**
 * Phase progress nav — reproduces the original ProgressBar:
 * an expanding fill bar over four labelled step cells. Cancelled hides it.
 *   open → step 0 (Created), live/active → step 1 (Accepted),
 *   resolved → step 3 (Proven). Step 2 (Verifying) shows when expired & unresolved.
 */
function PhaseProgress({ state, expired }: { state: number; expired: boolean }) {
  if (state === 3) return null; // cancelled

  const total = PHASE_STEPS.length;
  const stepIndex = state === 2 ? 3 : state === 1 ? (expired ? 2 : 1) : 0;
  const isResolved = stepIndex >= 3;
  const progressPercent = isResolved ? 100 : ((stepIndex + 1) / total) * 100;

  return (
    <nav className="mb-8 sm:mb-10" aria-label="Claim lifecycle progress">
      <div className="rounded-2xl border border-black/[0.08] bg-pv-surface/80 p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] sm:p-6">
        <div
          className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressPercent)}
        >
          {PHASE_STEPS.map((_, i) => {
            const isDone = isResolved || i < stepIndex;
            const isCurrent = !isResolved && i === stepIndex;
            const shouldFill = isDone || isCurrent;
            return (
              <div key={i} className="relative h-full flex-1 overflow-hidden rounded-full bg-black/[0.06]">
                <div
                  className={`absolute inset-0 origin-left rounded-full transition-transform duration-500 ease-out ${
                    isDone ? "bg-pv-emerald" : isCurrent ? "bg-pv-emerald animate-phase-glow" : ""
                  }`}
                  style={{ transform: shouldFill ? "scaleX(1)" : "scaleX(0)", opacity: shouldFill ? 1 : 0 }}
                  aria-hidden
                />
              </div>
            );
          })}
        </div>

        <ol className="mt-5 grid grid-cols-2 gap-3 sm:mt-6 sm:grid-cols-4 sm:gap-4">
          {PHASE_STEPS.map((step, index) => {
            const isDone = isResolved || index < stepIndex;
            const isCurrent = !isResolved && index === stepIndex;
            const isProvenStep = index === 3;
            const stepNum = String(index + 1).padStart(2, "0");
            return (
              <li key={step} className="min-w-0 list-none">
                <div
                  className={`flex h-full min-h-[4.5rem] w-full flex-col gap-2 rounded-lg border px-3 py-3 text-left transition-all duration-300 sm:min-h-0 sm:py-3.5 ${
                    isCurrent
                      ? "border-pv-emerald/40 bg-pv-emerald/[0.07] shadow-glow-emerald"
                      : isDone
                        ? "border-pv-emerald/20 bg-pv-emerald/[0.04]"
                        : "border-black/[0.06] bg-pv-bg/40"
                  }`}
                >
                  <span className="font-mono text-[11px] font-medium tabular-nums tracking-[0.12em] text-pv-muted/70 sm:text-[12px]">
                    {stepNum}
                  </span>
                  <span
                    aria-current={isCurrent ? "step" : undefined}
                    className={`flex items-start gap-2 font-display ${
                      isProvenStep ? "text-[9px] sm:text-[10px]" : "text-[10px] sm:text-[11px]"
                    } font-bold uppercase leading-snug tracking-[0.14em] sm:tracking-[0.16em] ${
                      isCurrent ? "text-pv-emerald" : isDone ? "text-pv-text/90" : "text-pv-muted/45"
                    }`}
                  >
                    <span>{step}</span>
                    {isDone && <span className="mt-0.5 shrink-0 text-pv-emerald">✓</span>}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

export default function ArenaClaimPage() {
  const params = useParams<{ id: string; locale: string }>();
  const wallet = useWallet();
  const [claim, setClaim] = useState<ArenaClaim | null>(null);
  const [stake, setStake] = useState("2");
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [lastChallengeSig, setLastChallengeSig] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint>(0n);
  const [termsOpen, setTermsOpen] = useState(false);
  const termsHeadingId = useId();
  const termsPanelId = useId();

  const mimir = useMemo(() => createBrowserMimir(wallet), [wallet.publicKey, wallet.signTransaction]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/arena/claims");
      const json = await res.json();
      if (json.success) {
        const found = json.data.claims.find((c: ArenaClaim) => c.id === Number(params.id));
        if (found) setClaim(found);
      }
    } catch {}
    if (mimir) {
      try {
        setBalance(await getVirtualBalance(mimir));
      } catch {}
    }
  }, [params.id, mimir]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const pushLog = (s: string) => setLog((l) => [...l, s]);

  const onChallenge = async () => {
    if (!mimir || !claim) return;
    const units = BigInt(Math.round(Number(stake) * 1e6));
    setLog([]);
    try {
      if (balance < units) {
        setBusy("Depositing USDC into the Mimir vault (base layer)…");
        const depositAmount = units > 20_000_000n ? units : 20_000_000n; // top up at least 20 USDC
        await depositUsdc(mimir, depositAmount);
        pushLog(`✓ Deposited ${usdc(depositAmount.toString())} USDC into escrow`);
        setBusy("Delegating your balance to the MagicBlock ER…");
        await delegateBalance(mimir);
        pushLog("✓ Balance PDA delegated — you can now bet in real time");
        await new Promise((r) => setTimeout(r, 2500));
      }
      setBusy("Challenging inside the Ephemeral Rollup…");
      const t0 = Date.now();
      const sig = await challengeInER(mimir, BigInt(claim.id), units);
      setLastChallengeSig(sig);
      pushLog(`⚡ Challenge landed in ${Date.now() - t0}ms — zero fee, on-chain`);
      await refresh();
    } catch (err: any) {
      pushLog(`✗ ${txErrorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  };

  if (!claim) {
    return (
      <div className="py-20 text-center">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-transparent border-t-pv-emerald" />
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-pv-muted">Loading claim…</p>
      </div>
    );
  }

  const expired = claim.deadline <= Math.floor(Date.now() / 1000);
  const creatorStakeNum = Number(claim.creatorStake);
  const challengerStakeNum = Number(claim.totalChallengerStake);
  const pool = creatorStakeNum + challengerStakeNum;
  const challengerFillPct = pool > 0 ? Math.max(4, Math.min(96, (challengerStakeNum / pool) * 100)) : 50;
  const maxChallengers = claim.maxChallengers && claim.maxChallengers > 0 ? claim.maxChallengers : 1;
  const challengerCount = claim.challengers.length;
  const isFlashOracle = claim.resolutionUrl.includes("flashapi.trade");
  const resolutionHref = claim.resolutionUrl.startsWith("http")
    ? claim.resolutionUrl
    : `https://${claim.resolutionUrl}`;
  const isResolved = claim.state === 2;
  const isCancelled = claim.state === 3;
  const isOpen = claim.state === 0;
  const conf = confidenceTone(claim.confidence);

  const sourceHost = (() => {
    try {
      return new URL(resolutionHref).hostname.replace(/^www\./i, "");
    } catch {
      return claim.resolutionUrl || "unknown source";
    }
  })();

  /** Fuchsia status pill that mirrors the original "{addr} challenges you" / "Accepted" duel pill. */
  const duelPill = (text: string) => (
    <div className="inline-flex max-w-full min-w-0 items-center rounded-full border border-pv-fuch/35 bg-pv-fuch/[0.08] px-2.5 py-1 text-left text-[11px] font-semibold leading-tight text-pv-fuch shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] sm:px-3 sm:py-1.5 sm:text-xs">
      {text}
    </div>
  );

  return (
    <div className="relative z-[1] mx-auto w-full max-w-[1280px] px-4 pb-16 pt-2 sm:px-6 sm:pb-20 sm:pt-4">
      <div className="mx-auto w-full min-w-0">
        {/* ── Top bar: back link + wallet ── */}
        <div className="mb-6 flex items-center justify-between gap-4 sm:mb-8">
          <Link
            href={`/${params.locale}/arena`}
            className="inline-flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted transition-[color,border-color,background-color] hover:border-black/[0.1] hover:bg-black/[0.04] hover:text-pv-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/30 sm:px-3 sm:text-[11px]"
          >
            ← Arena
          </Link>
          <WalletMultiButton />
        </div>

        {/* ── Hero lead ── */}
        <div className="mb-6 sm:mb-8">
          <div className="mb-4 flex flex-wrap items-center gap-4 sm:gap-6">
            <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-6">
              <h1 className="min-w-0 max-w-4xl font-display text-2xl font-bold uppercase tracking-tighter text-pv-text sm:text-3xl md:text-4xl">
                Mimir VS
              </h1>
              <div className="h-px min-w-[2rem] flex-1 bg-black/[0.12]" aria-hidden />
            </div>
          </div>
          <span className="block max-w-2xl font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-pv-emerald sm:text-xs">
            Real-time stakes settled on MagicBlock · zero-fee challenges
          </span>
        </div>

        {/* ── Phase progress ── */}
        {!isCancelled && <PhaseProgress state={claim.state} expired={expired} />}

        {/* ── Body grid: main (8) + sticky sidebar (4) ── */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start lg:gap-10">
          <div className="min-w-0 lg:col-span-8">
            {/* ── Settlement receipt (resolved) ── */}
            {isResolved && (
              <div className="card mb-6 border-black/[0.12] bg-pv-surface sm:mb-8">
                <div className="p-5 sm:p-6">
                  <div className="space-y-5">
                    <div className="flex min-w-0 items-start gap-3 sm:gap-3.5">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
                        aria-hidden
                      >
                        ✶
                      </span>
                      <div className="min-w-0 space-y-1">
                        <h2 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                          Settlement receipt
                        </h2>
                        <p className="text-[10px] leading-relaxed text-pv-muted sm:text-[11px]">
                          Resolved by the Mimir oracle agent after committing the ER state to the base layer.
                        </p>
                      </div>
                    </div>

                    <div
                      className={`mb-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 font-display text-[10px] font-bold uppercase tracking-[0.18em] ${conf.cls}`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                      {conf.label} · {claim.confidence}%
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
                      <div className="space-y-4">
                        <div className="rounded-xl border border-black/[0.08] bg-pv-bg/40 p-4">
                          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-emerald/80">
                            ⚖ Verdict
                          </div>
                          <div className="text-lg font-semibold text-pv-text">{SIDE_LABELS[claim.winnerSide]}</div>
                          <p className="mt-2 text-sm leading-relaxed text-pv-muted">
                            {claim.resolutionSummary?.trim() || "No summary recorded."}
                          </p>
                        </div>

                        <div className="rounded-xl border border-black/[0.08] bg-pv-bg/40 p-4">
                          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-cyan/80">
                            ⌁ Pool settled
                          </div>
                          <p className="font-mono text-sm font-bold tabular-nums text-pv-text">${usdc(pool)} USDC</p>
                          <p className="mt-2 text-xs leading-relaxed text-pv-muted">
                            Distributed to the winning side across {challengerCount} challenger
                            {challengerCount === 1 ? "" : "s"} and the creator.
                          </p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="rounded-xl border border-black/[0.08] bg-pv-bg/40 p-4">
                          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-fuch/80">
                            ▤ Evidence
                          </div>
                          <div className="break-words text-sm font-semibold text-pv-text">{sourceHost}</div>
                          <p className="mt-2 text-xs leading-relaxed text-pv-muted">
                            The oracle cited this source when issuing the verdict.
                          </p>
                          {claim.resolutionUrl && (
                            <a
                              href={resolutionHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-3 inline-flex items-center gap-1.5 text-xs text-pv-cyan transition-colors hover:text-pv-text"
                            >
                              ↗ Open source
                            </a>
                          )}
                        </div>

                        <div className="rounded-xl border border-black/[0.08] bg-pv-bg/40 p-4">
                          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-gold/80">
                            ⛨ Confidence
                          </div>
                          <div className="flex items-end justify-between gap-3">
                            <div className="font-display text-3xl font-bold tracking-tight text-pv-text">
                              {claim.confidence}
                            </div>
                            <div className="text-right text-[11px] text-pv-muted">/ 100</div>
                          </div>
                          <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/[0.08]">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-pv-gold via-pv-fuch to-pv-emerald transition-[width] duration-300"
                              style={{ width: `${Math.max(0, Math.min(100, claim.confidence))}%` }}
                              aria-hidden
                            />
                          </div>
                          <div className="mt-3 border-t border-black/[0.08] pt-3">
                            <div className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] ${conf.text}`}>
                              <span className={`h-2 w-2 rounded-full ${conf.dot}`} aria-hidden />
                              {claim.confidence >= 80 ? "High confidence" : claim.confidence >= 60 ? "Medium confidence" : "Low confidence"}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Duel card (the Stage) — shown when not resolved ── */}
            {!isResolved && (
              <div className="card mb-6 border-black/[0.10] bg-pv-surface sm:mb-8">
                <div className="p-5 sm:p-8">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3 sm:mb-6">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="rounded bg-black/[0.03] px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted ring-1 ring-black/[0.1]">
                        {claim.category}
                      </span>
                      {isOpen ? (
                        duelPill(`${shorten(claim.creator)} challenges you`)
                      ) : isCancelled ? (
                        <span className="rounded-full border border-black/[0.12] bg-black/[0.04] px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                          Cancelled
                        </span>
                      ) : (
                        duelPill("Accepted")
                      )}
                      {claim.delegated && (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-pv-fuch/35 bg-pv-fuch/[0.10] px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.14em] text-pv-fuch shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pv-fuch shadow-[0_0_8px_rgba(200,71,71,0.7)]" />
                          Live on MagicBlock ER
                        </span>
                      )}
                      {isFlashOracle && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-pv-gold/35 bg-pv-gold/[0.10] px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.14em] text-pv-gold">
                          ⚡ Flash Trade oracle
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-pv-muted">#{claim.id}</span>
                  </div>

                  <h2 className="mb-6 font-display text-[clamp(28px,8.5vw,46px)] font-bold uppercase leading-[0.92] tracking-tight text-pv-text sm:mb-7">
                    {claim.question}
                  </h2>

                  {/* Opposing positions */}
                  <div className="mb-6 flex flex-col overflow-hidden rounded-xl border border-black/[0.12] sm:flex-row">
                    <div className="flex-1 bg-pv-cyan/[0.04] p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-pv-cyan/30 bg-pv-cyan/[0.08] font-mono text-[10px] font-bold text-pv-cyan">
                          A
                        </span>
                        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-pv-cyan/60 sm:text-[11px]">
                          Creator
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-pv-text">{shorten(claim.creator)}</div>
                      <div className="mt-1 text-xs text-pv-cyan">{claim.creatorPosition}</div>
                      <div className="mt-3 font-mono text-sm font-bold tabular-nums text-pv-text">
                        ${usdc(claim.creatorStake)} <span className="text-pv-muted">staked</span>
                      </div>
                    </div>

                    <div
                      className="h-px w-full shrink-0 bg-black/[0.06] sm:h-auto sm:w-px sm:self-stretch"
                      aria-hidden
                    />

                    <div className="flex-1 bg-pv-fuch/[0.04] p-4">
                      {isOpen && challengerCount === 0 ? (
                        <div className="py-2 text-center">
                          <div className="mx-auto mb-2 flex h-7 w-7 items-center justify-center border-2 border-dashed border-black/[0.2] text-xs font-bold text-pv-muted">
                            ?
                          </div>
                          <div className="text-xs italic text-pv-muted">Waiting for a rival to challenge…</div>
                        </div>
                      ) : challengerCount === 1 ? (
                        <>
                          <div className="mb-2 flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-pv-fuch/30 bg-pv-fuch/[0.08] font-mono text-[10px] font-bold text-pv-fuch">
                              B
                            </span>
                            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-pv-fuch/60 sm:text-[11px]">
                              Rival
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-pv-text">{shorten(claim.challengers[0].addr)}</div>
                          <div className="mt-1 text-xs text-pv-fuch">{claim.counterPosition}</div>
                          <div className="mt-3 font-mono text-sm font-bold tabular-nums text-pv-text">
                            ${usdc(claim.totalChallengerStake)} <span className="text-pv-muted">staked</span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="mb-2 flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-pv-fuch/30 bg-pv-fuch/[0.08] font-mono text-[10px] font-bold text-pv-fuch">
                              B
                            </span>
                            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-pv-fuch/60 sm:text-[11px]">
                              Challenger side
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-pv-text">
                            {challengerCount} challenger{challengerCount === 1 ? "" : "s"} joined
                          </div>
                          <div className="mt-1 text-xs text-pv-fuch">{claim.counterPosition}</div>
                          <div className="mt-3 font-mono text-sm font-bold tabular-nums text-pv-text">
                            ${usdc(claim.totalChallengerStake)} <span className="text-pv-muted">staked</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Pool fill visualization (Solana flourish, kept) */}
                  <div className="mb-6">
                    <div className="mb-2 flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-[0.16em]">
                      <span className="text-pv-cyan">Creator ${usdc(claim.creatorStake)}</span>
                      <span className="text-pv-fuch">${usdc(claim.totalChallengerStake)} Challengers</span>
                    </div>
                    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-black/[0.07] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]">
                      <div
                        className="h-full bg-pv-cyan/70 transition-[width] duration-500 ease-out"
                        style={{ width: `${100 - challengerFillPct}%` }}
                        aria-hidden
                      />
                      <div
                        className="h-full bg-pv-fuch/70 transition-[width] duration-500 ease-out"
                        style={{ width: `${challengerFillPct}%` }}
                        aria-hidden
                      />
                    </div>
                  </div>

                  {/* Metric strip */}
                  <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-black/[0.1] bg-black/[0.07] p-px shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] sm:grid-cols-2 lg:grid-cols-4">
                    <div className="flex min-h-[5.75rem] min-w-0 flex-col bg-pv-bg/55 px-4 py-3.5 sm:min-h-[6rem]">
                      <p className="shrink-0 text-[10px] font-bold uppercase leading-snug tracking-[0.16em] text-pv-muted/90 sm:text-[11px] sm:tracking-[0.18em]">
                        Pool
                      </p>
                      <div className="mt-auto min-w-0 pt-2 font-mono text-base font-bold tabular-nums leading-tight text-pv-gold sm:text-lg lg:text-xl">
                        ${usdc(pool)}
                      </div>
                    </div>
                    <div className="flex min-h-[5.75rem] min-w-0 flex-col bg-pv-bg/55 px-4 py-3.5 sm:min-h-[6rem]">
                      <p className="shrink-0 text-[10px] font-bold uppercase leading-snug tracking-[0.16em] text-pv-muted/90 sm:text-[11px] sm:tracking-[0.18em]">
                        Creator stake
                      </p>
                      <div className="mt-auto min-w-0 pt-2 font-mono text-base font-bold tabular-nums leading-tight text-pv-cyan sm:text-lg lg:text-xl">
                        ${usdc(claim.creatorStake)}
                      </div>
                    </div>
                    <div className="flex min-h-[5.75rem] min-w-0 flex-col bg-pv-bg/55 px-4 py-3.5 sm:min-h-[6rem]">
                      <p className="shrink-0 text-[10px] font-bold uppercase leading-snug tracking-[0.16em] text-pv-muted/90 sm:text-[11px] sm:tracking-[0.18em]">
                        Deadline
                      </p>
                      <div className="mt-auto min-w-0 pt-2 font-mono text-sm font-bold leading-tight text-pv-text sm:text-base lg:text-lg">
                        {new Date(claim.deadline * 1000).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex min-h-[5.75rem] min-w-0 flex-col bg-pv-bg/55 px-4 py-3.5 sm:min-h-[6rem]">
                      <p className="shrink-0 text-[10px] font-bold uppercase leading-snug tracking-[0.16em] text-pv-muted/90 sm:text-[11px] sm:tracking-[0.18em]">
                        Slots
                      </p>
                      <div className="mt-auto min-w-0 pt-2 font-mono text-base font-bold tabular-nums leading-tight text-pv-fuch sm:text-lg lg:text-xl">
                        {challengerCount}/{maxChallengers}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer: oracle note + evidence link */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-black/[0.08] px-5 py-3 sm:px-8">
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-pv-emerald shadow-[0_0_8px_rgba(153,69,255,0.6)]" />
                    <span className="text-xs text-pv-muted">
                      {isFlashOracle ? "Resolves via the Flash Trade oracle" : "Settled by the Mimir AI oracle"}
                    </span>
                  </div>
                  {claim.resolutionUrl && (
                    <a
                      href={resolutionHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] text-pv-muted transition-colors hover:text-pv-cyan"
                    >
                      ↗ source
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* ── Market terms (collapsible) ── */}
            <div className="card mb-6 w-full overflow-hidden border-black/[0.12] sm:mb-8">
              <button
                type="button"
                onClick={() => setTermsOpen((open) => !open)}
                aria-expanded={termsOpen}
                aria-controls={termsPanelId}
                className="flex min-h-[3.25rem] w-full items-start justify-between gap-3 px-5 py-5 text-left transition-colors hover:bg-black/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-pv-emerald/35 sm:min-h-0 sm:gap-4 sm:px-8 sm:py-6"
              >
                <div className="flex min-w-0 gap-3 sm:gap-3.5">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
                    aria-hidden
                  >
                    ⚙
                  </span>
                  <div className="min-w-0 space-y-1">
                    <h3
                      id={termsHeadingId}
                      className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]"
                    >
                      Market terms
                    </h3>
                    <p className="text-[10px] leading-relaxed text-pv-muted sm:text-[11px]">
                      How this claim is structured and settled.
                    </p>
                  </div>
                </div>
                <span
                  className={`shrink-0 text-pv-muted transition-transform duration-200 ease-out ${termsOpen ? "rotate-180" : ""}`}
                  aria-hidden
                >
                  ▾
                </span>
              </button>

              <div
                className={`overflow-hidden transition-[max-height,opacity] duration-300 ease-out ${
                  termsOpen ? "max-h-[40rem] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
                }`}
                aria-hidden={!termsOpen}
              >
                <div
                  id={termsPanelId}
                  role="region"
                  aria-labelledby={termsHeadingId}
                  className="border-t border-black/[0.08] px-5 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-6"
                >
                  <div className="grid grid-cols-1 gap-2.5 text-sm sm:grid-cols-2 sm:gap-3">
                    <div className="rounded-xl border border-black/[0.08] bg-pv-bg/40 p-4">
                      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">Category</div>
                      <div className="font-semibold text-pv-text">{claim.category}</div>
                    </div>
                    <div className="rounded-xl border border-black/[0.08] bg-pv-bg/40 p-4">
                      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">Format</div>
                      <div className="font-semibold text-pv-text">
                        {maxChallengers === 1 ? "Head to head (1v1)" : `Open challenge (up to ${maxChallengers})`}
                      </div>
                    </div>
                    <div className="rounded-xl border border-black/[0.08] bg-pv-bg/40 p-4">
                      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                        Challenger capacity
                      </div>
                      <div className="font-semibold text-pv-text">
                        {challengerCount}/{maxChallengers} filled
                      </div>
                    </div>
                    <div className="rounded-xl border border-black/[0.08] bg-pv-bg/40 p-4">
                      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">Settlement</div>
                      <div className="font-semibold text-pv-text">
                        {isFlashOracle ? "Flash Trade oracle" : "Mimir AI oracle"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-black/[0.08] bg-pv-bg/40 p-4 sm:col-span-2">
                      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                        Resolution source
                      </div>
                      <div className="break-words font-semibold leading-relaxed text-pv-text">{sourceHost}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Action panel ── */}
            <div className="flex flex-col gap-3 sm:gap-4">
              {isCancelled ? (
                <div className="card border-black/[0.12] bg-pv-surface p-5 text-center sm:p-6">
                  <p className="text-sm text-pv-muted">This claim was cancelled — all stakes were refunded.</p>
                </div>
              ) : isResolved ? null : expired ? (
                <div className="card border-pv-gold/25 bg-pv-gold/[0.05] p-5 sm:p-6">
                  <div className="text-sm font-semibold text-pv-text">Deadline passed</div>
                  <p className="mt-1 text-sm text-pv-muted">
                    The oracle agent will commit the Ephemeral Rollup state to the base layer and settle this claim
                    shortly.
                  </p>
                </div>
              ) : (
                <div className="card border-black/[0.12] bg-pv-surface">
                  <div className="p-5 sm:p-6">
                    <div className="mb-1 flex items-center gap-2">
                      <h2 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                        Challenge this claim
                      </h2>
                    </div>
                    <p className="text-[11px] leading-relaxed text-pv-muted">
                      Stake on Side B inside the Ephemeral Rollup — zero fees, instant. Your ER betting balance:{" "}
                      <b className="font-mono tabular-nums text-pv-text">${usdc(balance.toString())}</b>
                    </p>

                    {!wallet.connected ? (
                      <p className="mt-4 text-sm text-pv-muted">Connect a wallet to challenge.</p>
                    ) : (
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <div className="flex items-center overflow-hidden rounded-lg border border-black/[0.15] bg-pv-bg/40">
                          <input
                            type="number"
                            min={2}
                            step={0.5}
                            value={stake}
                            onChange={(e) => setStake(e.target.value)}
                            className="w-24 bg-transparent px-3 py-2 font-mono text-sm tabular-nums text-pv-text outline-none"
                          />
                          <span className="px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">
                            USDC
                          </span>
                        </div>
                        <button
                          onClick={onChallenge}
                          disabled={!!busy || Number(stake) < 2}
                          className="inline-flex items-center justify-center rounded-md bg-pv-text px-5 py-2 font-display text-[10px] font-bold uppercase tracking-[0.18em] text-pv-bg transition-[transform,box-shadow,background-color,color] duration-200 ease-out hover:-translate-y-px hover:bg-pv-fuch hover:text-pv-bg hover:shadow-[0_6px_18px_-4px_rgba(200,71,71,0.4)] active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-pv-text"
                        >
                          {busy ? "Working…" : "⚡ Challenge in the ER"}
                        </button>
                        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">min 2</span>
                      </div>
                    )}

                    {busy && (
                      <div className="mt-4 flex items-center gap-2 rounded-lg border border-pv-fuch/25 bg-pv-fuch/[0.06] px-3 py-2 text-sm text-pv-fuch">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pv-fuch" />
                        {busy}
                      </div>
                    )}
                    {log.length > 0 && (
                      <ul className="mt-4 space-y-1.5 rounded-lg border border-black/[0.08] bg-pv-bg/40 p-3 font-mono text-[11px] leading-relaxed text-pv-text/90">
                        {log.map((l, i) => (
                          <li key={i} className="break-words">
                            {l}
                          </li>
                        ))}
                      </ul>
                    )}
                    {lastChallengeSig && (
                      <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-pv-fuch/25 bg-pv-fuch/[0.06] px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-pv-fuch">
                            Challenge tx · MagicBlock ER
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] text-pv-muted break-all">
                            {lastChallengeSig.slice(0, 28)}…
                          </p>
                        </div>
                        <a
                          href={`https://explorer.magicblock.app/tx/${lastChallengeSig}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 rounded-md border border-pv-fuch/35 bg-pv-fuch/[0.10] px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-pv-fuch transition-colors hover:border-pv-fuch/55 hover:bg-pv-fuch/[0.18]"
                        >
                          ↗ Explorer
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Council verdict — full-width in the main column */}
            <div className="mt-6 sm:mt-8">
              <CouncilVotes claimId={claim.id} claimState={claim.state} winnerSide={claim.winnerSide} />
            </div>
          </div>

          {/* ── Sticky sidebar ── */}
          <aside className="min-w-0 text-pv-text lg:col-span-4">
            <div className="flex flex-col gap-6 lg:sticky lg:top-24">
              {/* Claim strength card (live, pre-settlement) */}
              {!isResolved && !isCancelled && (
                <div className="card border-black/[0.12] bg-pv-surface">
                  <div className="space-y-4 p-5 sm:p-6">
                    <div className="flex min-w-0 items-start gap-3 sm:gap-3.5">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald"
                        aria-hidden
                      >
                        ◈
                      </span>
                      <div className="min-w-0 space-y-1">
                        <h2 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                          Claim strength
                        </h2>
                        <p className="text-[10px] leading-relaxed text-pv-muted sm:text-[11px]">
                          How resolvable this market is, based on its source and terms.
                        </p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-black/[0.08] bg-pv-bg/40 p-4">
                      <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-pv-cyan/80">
                        ▤ Evidence source
                      </div>
                      <div className="break-words text-sm font-semibold text-pv-text">{sourceHost}</div>
                      <p className="mt-2 text-xs leading-relaxed text-pv-muted">
                        {isFlashOracle
                          ? "Backed by the Flash Trade price oracle — deterministic settlement."
                          : "The Mimir oracle will cite this source when issuing its verdict."}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Challengers list */}
              <div className="card border-black/[0.12] bg-pv-surface">
                <div className="space-y-4 p-5 sm:p-6">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 text-[11px] font-bold uppercase tracking-[0.18em] text-pv-emerald/85">
                        Challengers
                      </div>
                      <span className="inline-flex shrink-0 items-center rounded-full border border-pv-fuch/35 bg-pv-fuch/[0.12] px-2.5 py-1 font-display text-[10px] font-bold uppercase tracking-[0.14em] text-pv-fuch sm:tracking-[0.16em]">
                        {challengerCount}/{maxChallengers} filled
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-pv-muted">
                      Everyone staking on Side B against the creator.
                    </p>
                  </div>

                  {challengerCount === 0 ? (
                    <div className="rounded-xl border border-dashed border-black/[0.14] bg-pv-bg/30 px-4 py-9 text-center sm:py-11" role="status">
                      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full border-2 border-pv-fuch/35 text-pv-fuch/35 sm:size-11">
                        ◇
                      </div>
                      <p className="text-sm leading-relaxed text-pv-muted">No challengers yet — be the first to stake.</p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-black/[0.1] bg-pv-bg/25 p-2.5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)] sm:p-3.5">
                      <ul className="space-y-2 sm:space-y-2.5" role="list">
                        {claim.challengers.map((c, i) => {
                          const isYou = wallet.publicKey?.toBase58() === c.addr;
                          return (
                            <li key={`${c.addr}-${i}`}>
                              <div className="rounded-lg border border-black/[0.08] bg-gradient-to-br from-pv-fuch/[0.04] via-transparent to-transparent p-2.5 transition-[border-color,background-color] duration-200 hover:border-black/[0.14] sm:p-3">
                                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 sm:gap-2.5 md:gap-3">
                                  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-pv-fuch/[0.28] bg-pv-fuch/[0.08] font-mono text-[9px] font-bold leading-none tabular-nums text-pv-fuch sm:size-8 sm:text-[10px]">
                                    #{i + 1}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                                      <span className="break-words font-mono text-[12px] font-semibold leading-tight text-pv-text sm:text-[13px]">
                                        {shorten(c.addr)}
                                      </span>
                                      {isYou && (
                                        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-pv-emerald">
                                          you
                                        </span>
                                      )}
                                      {!c.paid && (
                                        <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-pv-gold">
                                          pending
                                        </span>
                                      )}
                                    </div>
                                    {claim.counterPosition.trim() && (
                                      <p className="mt-1 text-[11px] leading-snug text-pv-muted sm:text-[12px]">
                                        {claim.counterPosition}
                                      </p>
                                    )}
                                  </div>
                                  <div className="min-w-0 justify-self-end sm:justify-self-start">
                                    <div className="flex h-7 min-w-[4rem] items-center justify-center rounded-md border border-black/[0.1] bg-pv-bg/55 px-2 font-mono text-[9px] font-bold leading-none tabular-nums text-pv-fuch sm:h-8 sm:min-w-[4.5rem] sm:text-[10px]">
                                      ${usdc(c.stake)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
