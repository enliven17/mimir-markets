"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import { Link, useRouter } from "@/i18n/navigation";
import {
  ChevronDown,
  Clock,
  Coins,
  FileEdit,
  Link2,
  SlidersHorizontal,
  User,
  Users,
  Wand2,
  Zap,
} from "lucide-react";
import { BlueprintHeading } from "@/components/BlueprintGrid";
import PageTransition, { AnimatedItem } from "@/components/PageTransition";
import { GlassCard, Button } from "@/components/ui";
import CreateChallengeTicket from "@/components/vs/CreateChallengeTicket";
import {
  createBrowserMimir,
  createClaim,
  delegateClaim,
} from "@/lib/solana/browser-client";
import {
  CATEGORIES,
  CATEGORY_GUIDANCE,
  DEADLINE_PRESET_IDS,
  DEADLINE_PRESET_SECONDS,
  MIN_STAKE,
  normalizeCategoryId,
} from "@/lib/constants";
import { txErrorMessage } from "@/lib/tx-errors";
import ResolverToggle from "@/components/arena/ResolverToggle";
import CouncilPreflight from "@/components/council/CouncilPreflight";
import { deterministicPriceOption } from "@/lib/resolver-spec";
import { FLASH_CLAIM_SYMBOLS, flashResolutionUrl } from "@/lib/solana/flashtrade";
import { dexMintFor, dexSourceUrl } from "@/lib/token-config";
import { draftOutcomeSidesFromQuestion } from "@/lib/outcomeDraft";
import { parseCreatePrefill } from "@/lib/create-prefill";

const STAKE_PRESET_AMOUNTS = [MIN_STAKE, 5, 10, 25] as const;

function isPresetStakeAmount(v: number) {
  return (STAKE_PRESET_AMOUNTS as readonly number[]).includes(v);
}

function formatLocalDateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function formatLocalTimeInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(11, 16);
}

// FNV-1a hash for ticket draft ID (same approach as original mimir)
function computeDraftId(question: string, creatorPos: string, stake: number): string {
  const s = `${question}|${creatorPos}|${stake}|binary|pool`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const n = Math.abs(h);
  const part = (n % 0xffff).toString(16).toUpperCase().padStart(4, "0");
  const suffix = String.fromCharCode(65 + (n % 26));
  return `PRV-${part}-${suffix}`;
}

export default function CreateMarketPage() {
  const t = useTranslations("create");
  const locale = useLocale();
  const router = useRouter();
  const wallet = useWallet();
  const mimir = useMemo(
    () => createBrowserMimir(wallet),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wallet.publicKey, wallet.signTransaction]
  );

  const challengeFieldUid = useId().replace(/:/g, "");
  const challengeHeadingId = `create-challenge-heading-${challengeFieldUid}`;
  const termsPanelId = `create-advanced-${challengeFieldUid}`;

  const [question, setQuestion] = useState("");
  const [creatorPos, setCreatorPos] = useState("");
  const [opponentPos, setOpponentPos] = useState("");
  const [url, setUrl] = useState("");
  const [deadlinePreset, setDeadlinePreset] = useState<number | null>(null);
  const [customDeadlineDate, setCustomDeadlineDate] = useState("");
  const [customDeadlineTime, setCustomDeadlineTime] = useState("");
  const [customDateInputMin, setCustomDateInputMin] = useState<string | undefined>(undefined);
  const [stake, setStake] = useState(5);
  const [customStakeDraft, setCustomStakeDraft] = useState("");
  const [customStakeFocused, setCustomStakeFocused] = useState(false);
  const [category, setCategory] = useState("custom");
  const [settlementRule, setSettlementRule] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deterministic, setDeterministic] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<bigint | null>(null);
  const [createTxSig, setCreateTxSig] = useState<string | null>(null);
  const [delegateTxSig, setDelegateTxSig] = useState<string | null>(null);

  const [prefilledFrom, setPrefilledFrom] = useState<string | null>(null);

  useLayoutEffect(() => {
    setCustomDateInputMin(formatLocalDateInputValue(new Date()));
  }, []);

  // ?source=…&q=…&a=…&b=…&cat=…&deadline=…&rule=… from an opportunity card.
  useEffect(() => {
    const prefill = parseCreatePrefill(new URLSearchParams(window.location.search));
    if (!prefill) return;
    if (prefill.source) setUrl(prefill.source);
    if (prefill.question) setQuestion(prefill.question);
    if (prefill.creatorPosition && prefill.counterPosition) {
      setCreatorPos(prefill.creatorPosition);
      setOpponentPos(prefill.counterPosition);
    } else if (prefill.question) {
      const drafted = draftOutcomeSidesFromQuestion(prefill.question, locale);
      if (drafted) {
        setCreatorPos(drafted.creator);
        setOpponentPos(drafted.opponent);
      }
    }
    if (prefill.category) setCategory(prefill.category);
    if (prefill.deadline) {
      const d = new Date(prefill.deadline * 1000);
      setDeadlinePreset(null);
      setCustomDeadlineDate(formatLocalDateInputValue(d));
      setCustomDeadlineTime(formatLocalTimeInputValue(d));
    }
    if (prefill.settlementRule) {
      setSettlementRule(prefill.settlementRule);
      setAdvancedOpen(true);
    }
    let from = "link";
    try {
      if (prefill.source) from = new URL(prefill.source).hostname.replace(/^www\./, "");
    } catch {}
    setPrefilledFrom(from);
    // Once per page load; the locale only picks the Yes/No wording.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyDeadlinePreset(seconds: number) {
    const d = new Date(Date.now() + seconds * 1000);
    setDeadlinePreset(seconds);
    setCustomDeadlineDate(formatLocalDateInputValue(d));
    setCustomDeadlineTime(formatLocalTimeInputValue(d));
  }

  const customDeadline = useMemo(() => {
    if (!customDeadlineDate || !customDeadlineTime) return "";
    return `${customDeadlineDate}T${customDeadlineTime}`;
  }, [customDeadlineDate, customDeadlineTime]);

  const presetStakeHighlight =
    isPresetStakeAmount(stake) && !customStakeFocused && customStakeDraft.trim() === "";

  const guidanceKey = category in CATEGORY_GUIDANCE ? category : "custom";
  const categoryGuidance = CATEGORY_GUIDANCE[guidanceKey as keyof typeof CATEGORY_GUIDANCE] ?? CATEGORY_GUIDANCE.custom;
  const recommendedSettlementTemplate = categoryGuidance.settlementTemplate;
  const ticketSettlementPreview = settlementRule.trim() || recommendedSettlementTemplate;
  const questionNeedsWork = question.trim().length > 0 && question.trim().length < 24;
  const sourceNeedsWork = url.trim().length > 0 && !/^https?:\/\//.test(url.trim());
  const ticketDraftId = useMemo(() => computeDraftId(question, creatorPos, stake), [question, creatorPos, stake]);
  const walletAddress = wallet.publicKey?.toBase58() ?? null;
  // Price threshold drafts with Yes/No sides can settle from price feeds alone.
  const priceOption = useMemo(
    () =>
      deterministicPriceOption({
        question,
        creatorPosition: creatorPos,
        counterPosition: opponentPos,
        resolutionUrl: url,
        defaultSource: (symbol) =>
          dexMintFor(symbol)
            ? dexSourceUrl(dexMintFor(symbol)!)
            : (FLASH_CLAIM_SYMBOLS as readonly string[]).includes(symbol)
            ? flashResolutionUrl(symbol)
            : `https://api.coingecko.com/api/v3/simple/price?ids=${symbol === "AVAX" ? "avalanche-2" : "chainlink"}&vs_currencies=usd`,
      }),
    [question, creatorPos, opponentPos, url]
  );
  const finalResolutionUrl = priceOption && deterministic ? priceOption.resolutionUrl : url.trim();

  const onSubmit = useCallback(async () => {
    if (!mimir) return;
    setError(null);
    if (!question.trim() || !creatorPos.trim() || !opponentPos.trim()) {
      setError(t("fillAllFields"));
      return;
    }
    if (!customDeadline) {
      setError(t("invalidDeadline"));
      return;
    }
    const stakeUnits = BigInt(Math.round(stake * 1e6));
    if (stakeUnits < BigInt(MIN_STAKE * 1e6)) {
      setError(t("invalidStakeMin", { amount: MIN_STAKE }));
      return;
    }
    const deadline = Math.floor(new Date(customDeadline).getTime() / 1000);
    try {
      setBusy(t("funding"));
      const { claimId, txSig } = await createClaim(mimir, {
        question: question.trim(),
        creatorPosition: creatorPos.trim(),
        counterPosition: opponentPos.trim(),
        resolutionUrl: finalResolutionUrl,
        category,
        stakeAmount: stakeUnits,
        deadline,
        maxChallengers: 16,
      });
      setCreateTxSig(txSig);
      setBusy("Delegating to MagicBlock ER…");
      const delSig = await delegateClaim(mimir, claimId);
      setDelegateTxSig(delSig);
      setCreatedId(claimId);
      setBusy(null);
    } catch (err: any) {
      setError(txErrorMessage(err, t("errorCreating")));
      setBusy(null);
    }
  }, [mimir, question, creatorPos, opponentPos, finalResolutionUrl, category, stake, customDeadline, t]);

  // ── Success state ────────────────────────────────────────────────────────
  if (createdId !== null) {
    const claimPath = `/arena/${createdId}`;
    const explorerBase = "https://explorer.solana.com/tx";
    const erExplorerBase = "https://explorer.magicblock.app/tx";
    return (
      <PageTransition className="mx-auto w-full max-w-2xl px-4 pb-10 pt-4 sm:px-6">
        <AnimatedItem>
          <GlassCard glass noPad glow="emerald" className="!rounded-2xl border border-pv-emerald/30">
            <div className="space-y-6 p-8 sm:p-10">
              <div className="text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-pv-emerald bg-pv-emerald/10">
                  <span className="font-display text-2xl">✶</span>
                </div>
                <p className="mt-3 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-pv-emerald">
                  {t("createSuccessBadgeLive")}
                </p>
                <h2 className="mt-1 font-display text-2xl font-bold uppercase tracking-tight text-pv-text sm:text-3xl">
                  {t("createSuccessHeadline")}
                </h2>
              </div>

              {/* On-chain transaction proof */}
              <div className="rounded-xl border border-pv-border/25 bg-pv-bg/60 p-4 space-y-3">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-pv-emerald/80">
                  On-chain proof
                </p>
                {createTxSig && (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-pv-muted">Create & fund</p>
                      <p className="mt-0.5 font-mono text-[11px] text-pv-text/70 break-all">{createTxSig.slice(0, 24)}…</p>
                    </div>
                    <a
                      href={`${explorerBase}/${createTxSig}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded-md border border-pv-cyan/30 bg-pv-cyan/[0.08] px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-pv-cyan transition-colors hover:border-pv-cyan/50 hover:bg-pv-cyan/[0.14]"
                    >
                      ↗ Solana
                    </a>
                  </div>
                )}
                {delegateTxSig && (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-pv-muted">Delegate → MagicBlock ER</p>
                      <p className="mt-0.5 font-mono text-[11px] text-pv-text/70 break-all">{delegateTxSig.slice(0, 24)}…</p>
                    </div>
                    <a
                      href={`${erExplorerBase}/${delegateTxSig}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded-md border border-pv-fuch/30 bg-pv-fuch/[0.08] px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-pv-fuch transition-colors hover:border-pv-fuch/50 hover:bg-pv-fuch/[0.14]"
                    >
                      ↗ ER
                    </a>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
                <Link href={claimPath}>
                  <Button variant="primary" fullWidth={false} className="min-w-[12rem] rounded-2xl py-4 font-display text-sm font-bold uppercase tracking-widest">
                    {t("viewVS")}
                  </Button>
                </Link>
                <Button variant="ghost" fullWidth={false} onClick={() => { setCreatedId(null); setCreateTxSig(null); setDelegateTxSig(null); setQuestion(""); setCreatorPos(""); setOpponentPos(""); setUrl(""); setSettlementRule(""); }} className="min-w-[10rem] rounded-2xl py-4 font-display text-sm font-bold uppercase tracking-widest">
                  {t("createAnother")}
                </Button>
              </div>
            </div>
          </GlassCard>
        </AnimatedItem>
      </PageTransition>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  return (
    <PageTransition className="relative z-[1] w-full">
      {/* Page header — blueprint band + ruled back bar */}
      <AnimatedItem>
        <BlueprintHeading as="h1" eyebrow={t("pageTitleBefore")}>
          {t("pageTitleAccent")}
        </BlueprintHeading>
        <div className="border-b border-pv-border/25 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            href="/arena"
            className="inline-flex items-center gap-2 border border-transparent px-2 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted transition-[color,border-color,background-color] hover:border-pv-border/25 hover:bg-pv-border/[0.04] hover:text-pv-text focus-ring"
          >
            ← Arena
          </Link>
          {prefilledFrom ? (
            <p role="status" className="mt-2 font-mono text-[11px] text-pv-muted">
              {t("prefilledFrom", { source: prefilledFrom })}
            </p>
          ) : null}
        </div>
      </AnimatedItem>

      <div className="px-4 pb-6 pt-8 sm:px-6 lg:px-8">
      {!wallet.connected ? (
        <AnimatedItem>
          <GlassCard glass noPad glow="none" className="!rounded-2xl border border-pv-border/25">
            <div className="flex flex-col items-center gap-4 p-8 text-center sm:p-12">
              <p className="text-sm text-pv-muted">Connect your wallet to publish a challenge.</p>
              <ConnectWalletButton />
            </div>
          </GlassCard>
        </AnimatedItem>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start lg:gap-8">
          {/* ── Left column: form ── */}
          <div className="min-w-0 space-y-5 lg:col-span-8">

            {/* Challenge section */}
            <AnimatedItem>
              <GlassCard glass noPad glow="none" className="!rounded-2xl border border-pv-border/25 w-full">
                <div className="space-y-6 p-6 sm:p-8">
                  <div className="mb-2 flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald" aria-hidden>
                      <FileEdit size={18} strokeWidth={2} />
                    </span>
                    <h2 id={challengeHeadingId} className="font-display text-base font-bold uppercase tracking-[0.16em] text-pv-text sm:text-lg sm:tracking-[0.18em]">
                      {t("challengeSectionTitle")}
                    </h2>
                  </div>

                  {/* Question textarea */}
                  <div className="relative">
                    <div className="absolute inset-0 rounded-2xl pointer-events-none bg-gradient-to-br from-pv-cyan/[0.03] via-transparent to-pv-fuch/[0.03]" />
                    <textarea
                      id={`create-q-${challengeFieldUid}`}
                      rows={5}
                      className="min-h-[160px] w-full resize-none rounded-2xl border border-pv-border/25 bg-pv-bg/40 p-6 sm:p-8 font-display text-xl leading-snug tracking-tight text-pv-text outline-none transition-all placeholder:text-pv-muted/30 focus:border-pv-emerald/50 focus:ring-1 focus:ring-pv-emerald/30 sm:text-2xl md:text-[26px]"
                      placeholder="Will Bitcoin trade above $70,000 at the deadline?"
                      aria-labelledby={challengeHeadingId}
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <p className={`min-w-0 flex-1 text-xs leading-relaxed ${questionNeedsWork ? "text-amber-300" : "text-pv-muted"}`}>
                      {questionNeedsWork ? t("qualitySpecificity") : t("questionStrengthHint")}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const d = draftOutcomeSidesFromQuestion(question, locale);
                        if (d) { setCreatorPos(d.creator); setOpponentPos(d.opponent); }
                      }}
                      disabled={question.trim().length === 0}
                      className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-md border border-pv-border/25 bg-pv-border/[0.04] px-2.5 py-1.5 text-left text-[11px] font-medium leading-snug text-pv-text/90 transition-colors hover:border-pv-border/25 hover:bg-pv-border/[0.07] disabled:cursor-not-allowed disabled:opacity-40 sm:max-w-[min(100%,15rem)]"
                      title={t("outcomeAutofillHint")}
                    >
                      <Wand2 className="size-3.5 shrink-0 text-pv-emerald/90" aria-hidden />
                      <span>{t("outcomeAutofillAction")}</span>
                    </button>
                  </div>

                  {/* Side A / Side B */}
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-0">
                    <div className="relative flex flex-col gap-4 md:pr-4 md:border-r md:border-pv-border/25">
                      <div className="relative flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-cyan/10 text-pv-cyan" aria-hidden>
                          <User size={16} strokeWidth={2} />
                        </span>
                        <span className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-cyan sm:tracking-[0.2em]">
                          {t("ibet")}
                        </span>
                      </div>
                      <input
                        type="text"
                        className="relative w-full rounded-xl border border-pv-cyan/[0.15] bg-pv-bg/90 px-4 py-3.5 font-body text-sm text-pv-text outline-none transition-all placeholder:text-pv-muted/55 focus:border-pv-cyan/40 focus:ring-1 focus:ring-pv-cyan/20"
                        placeholder="Yes — BTC will be above $70k"
                        value={creatorPos}
                        onChange={(e) => setCreatorPos(e.target.value)}
                        autoComplete="off"
                        aria-label={t("ibet")}
                      />
                    </div>
                    <div className="relative flex flex-col gap-4 md:pl-4">
                      <div className="relative flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-fuch/10 text-pv-fuch" aria-hidden>
                          <Users size={16} strokeWidth={2} />
                        </span>
                        <span className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-fuch sm:tracking-[0.2em]">
                          {t("rivalBets")}
                        </span>
                      </div>
                      <input
                        type="text"
                        className="relative w-full rounded-xl border border-pv-fuch/[0.15] bg-pv-bg/90 px-4 py-3.5 font-body text-sm text-pv-text outline-none transition-all placeholder:text-pv-muted/55 focus:border-pv-fuch/40 focus:ring-1 focus:ring-pv-fuch/20"
                        placeholder="No — BTC will not reach $70k"
                        value={opponentPos}
                        onChange={(e) => setOpponentPos(e.target.value)}
                        autoComplete="off"
                        aria-label={t("rivalBets")}
                      />
                    </div>
                  </div>
                </div>
              </GlassCard>
            </AnimatedItem>

            {/* Stake section */}
            <AnimatedItem>
              <GlassCard glass noPad glow="none" className="!rounded-2xl border border-pv-border/25 w-full">
                <div className="space-y-3 p-6 sm:p-8">
                  <h3 className="flex items-center gap-2.5 font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald" aria-hidden>
                      <Coins size={16} strokeWidth={2} />
                    </span>
                    {t("stakeSectionTitle")}
                  </h3>
                  <div className="grid grid-cols-5 gap-2">
                    {STAKE_PRESET_AMOUNTS.map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => { setStake(amount); setCustomStakeDraft(""); }}
                        aria-pressed={stake === amount && presetStakeHighlight}
                        className={`press min-w-0 rounded-lg border px-1.5 py-2 font-display text-[11px] font-bold leading-tight transition-[border-color,background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/35 focus-visible:ring-offset-2 focus-visible:ring-offset-pv-bg sm:px-2 sm:py-2.5 sm:text-xs ${
                          stake === amount && presetStakeHighlight
                            ? "border-pv-emerald bg-pv-emerald/[0.12] text-pv-emerald shadow-[0_0_16px_-8px_rgba(255,81,72,0.3)]"
                            : "border border-pv-border/25 bg-pv-surface text-pv-muted hover:border-pv-emerald/35 hover:text-pv-emerald"
                        }`}
                      >
                        {amount} USDC
                      </button>
                    ))}
                    <div className={`flex min-h-[2.75rem] w-full min-w-0 items-center justify-center rounded-lg border px-1.5 py-1.5 transition-[border-color,background-color,color,box-shadow] sm:min-h-[3.25rem] sm:px-2 sm:py-2 ${
                      customStakeFocused || !isPresetStakeAmount(stake)
                        ? "border-pv-emerald bg-pv-emerald/[0.12] text-pv-emerald shadow-[0_0_16px_-8px_rgba(255,81,72,0.3)]"
                        : "border border-pv-border/25 bg-pv-surface text-pv-muted"
                    }`}>
                      <div className="inline-flex max-w-full items-center justify-center gap-0.5 sm:gap-1">
                        <input
                          type="number"
                          min={MIN_STAKE}
                          step={1}
                          inputMode="numeric"
                          aria-label={t("stakeCustomAmount")}
                          className={`max-w-full shrink-0 bg-transparent font-display text-[11px] font-bold tabular-nums text-inherit outline-none placeholder:text-pv-muted/50 focus:outline-none sm:text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${customStakeDraft.trim() !== "" ? "text-right" : "text-center"}`}
                          style={{ width: customStakeDraft.trim() ? `${Math.max(2, customStakeDraft.length + 0.5)}ch` : "min(100%, 11ch)" }}
                          placeholder={t("stakeCustomPlaceholder")}
                          value={customStakeDraft}
                          onChange={(e) => setCustomStakeDraft(e.target.value)}
                          onFocus={() => setCustomStakeFocused(true)}
                          onBlur={() => {
                            setCustomStakeFocused(false);
                            const raw = customStakeDraft.trim();
                            if (raw === "") { if (!isPresetStakeAmount(stake)) setStake(MIN_STAKE); return; }
                            const n = Math.floor(Number(raw));
                            if (!Number.isFinite(n) || n < MIN_STAKE) { if (isPresetStakeAmount(stake)) setCustomStakeDraft(""); else setCustomStakeDraft(String(stake)); return; }
                            setStake(n);
                          }}
                        />
                        {customStakeDraft.trim() !== "" && (
                          <span className="shrink-0 font-display text-[10px] font-bold leading-none tracking-tight text-inherit sm:text-[11px]" aria-hidden>USDC</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </GlassCard>
            </AnimatedItem>

            {/* Deadline section */}
            <AnimatedItem>
              <GlassCard glass noPad glow="none" className="!rounded-2xl border border-pv-border/25 w-full" role="group" aria-label={t("deadline")}>
                <div className="space-y-4 p-6 sm:p-8">
                  <h3 className="flex items-center gap-2.5 font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald" aria-hidden>
                      <Clock size={16} strokeWidth={2} />
                    </span>
                    {t("deadline")}
                  </h3>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                    {DEADLINE_PRESET_IDS.map((id) => {
                      const seconds = DEADLINE_PRESET_SECONDS[id];
                      const selected = deadlinePreset === seconds;
                      return (
                        <button
                          key={id}
                          type="button"
                            onClick={() => applyDeadlinePreset(seconds)}
                          aria-pressed={selected}
                          className={`press min-w-0 rounded-lg border px-1.5 py-2 font-display text-[11px] font-bold leading-tight transition-[border-color,background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/35 focus-visible:ring-offset-2 focus-visible:ring-offset-pv-bg sm:px-2 sm:py-2.5 sm:text-xs ${
                            selected
                              ? "border-pv-emerald bg-pv-emerald/[0.12] text-pv-emerald shadow-[0_0_16px_-8px_rgba(255,81,72,0.3)]"
                              : "border border-pv-border/25 bg-pv-surface text-pv-muted hover:border-pv-emerald/35 hover:text-pv-emerald"
                          }`}
                        >
                          {t(`presets.${id}` as any)}
                        </button>
                      );
                    })}
                  </div>
                  <GlassCard className="p-4 sm:p-5">
                    <p className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">{t("orChooseExactDate")}</p>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                      <div className="space-y-1.5">
                        <label className="block font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">{t("exactDate")} *</label>
                        <input
                          type="date"
                          min={customDateInputMin}
                          value={customDeadlineDate}
                          onChange={(e) => { setDeadlinePreset(null); setCustomDeadlineDate(e.target.value); }}
                          className="w-full rounded-xl border border-pv-border/25 bg-pv-bg/90 px-4 py-3 text-sm text-pv-text outline-none transition-all focus:border-pv-emerald/50 focus:ring-1 focus:ring-pv-emerald/20 dark:[color-scheme:dark]"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-muted">{t("exactTime")} *</label>
                        <input
                          type="time"
                          value={customDeadlineTime}
                          onChange={(e) => { setDeadlinePreset(null); setCustomDeadlineTime(e.target.value); }}
                          disabled={!customDeadlineDate}
                          className="w-full rounded-xl border border-pv-border/25 bg-pv-bg/90 px-4 py-3 text-sm text-pv-text outline-none transition-all focus:border-pv-emerald/50 focus:ring-1 focus:ring-pv-emerald/20 disabled:cursor-not-allowed disabled:opacity-50 dark:[color-scheme:dark]"
                        />
                      </div>
                    </div>
                  </GlassCard>
                </div>
              </GlassCard>
            </AnimatedItem>

            {/* Resolution source section */}
            <AnimatedItem>
              <GlassCard glass noPad glow="none" className="!rounded-2xl border border-pv-border/25 w-full" role="group" aria-label={t("verificationSourceSectionTitle")}>
                <div className="space-y-4 p-6 sm:p-8">
                  <h3 className="flex items-center gap-2.5 font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald" aria-hidden>
                      <Link2 size={16} strokeWidth={2} />
                    </span>
                    {t("verificationSourceSectionTitle")}
                  </h3>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t("verificationUrlPlaceholder")}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="w-full rounded-xl border border-pv-border/25 bg-pv-bg/90 px-4 py-3 font-mono text-xs text-pv-text outline-none transition-all placeholder:text-pv-muted/40 focus:border-pv-emerald/50 focus:ring-1 focus:ring-pv-emerald/20"
                  />
                  <p className={`text-xs leading-relaxed ${sourceNeedsWork ? "text-amber-300" : "text-pv-muted"}`}>
                    {sourceNeedsWork ? t("qualitySource") : t("sourceStrengthHint")}
                  </p>
                  {priceOption ? (
                    <ResolverToggle
                      spec={priceOption.spec}
                      resolutionUrl={priceOption.resolutionUrl}
                      enabled={deterministic}
                      onChange={setDeterministic}
                    />
                  ) : null}
                  <div className="space-y-3 rounded-xl border border-pv-border/25 bg-pv-bg/70 p-4 sm:p-5">
                    <h4 className="text-[11px] font-bold uppercase tracking-[0.16em] text-pv-emerald/85">{t("verificationGuidanceTitle")}</h4>
                    <p className="text-sm leading-relaxed text-pv-muted">{categoryGuidance.sourceHint}</p>
                    <div className="flex flex-wrap gap-2">
                      {categoryGuidance.sourceExamples.map((example) => (
                        <button
                          key={example}
                          type="button"
                          onClick={() => setUrl(`https://${example}`)}
                          className="border border-pv-border/25 bg-pv-border/[0.03] px-3 py-1.5 font-mono text-[10px] font-medium text-pv-muted/70 transition-colors hover:border-pv-border/25 hover:text-pv-muted"
                        >
                          {example}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </GlassCard>
            </AnimatedItem>

            {/* Advanced section (collapsible) */}
            <AnimatedItem>
              <GlassCard glass noPad glow="none" className="!rounded-2xl border border-pv-border/25 w-full overflow-hidden">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  aria-expanded={advancedOpen}
                  aria-controls={termsPanelId}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-pv-border/[0.02] sm:px-8 sm:py-6"
                >
                  <div className="flex min-w-0 gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pv-emerald/10 text-pv-emerald" aria-hidden>
                      <SlidersHorizontal size={16} strokeWidth={2} />
                    </span>
                    <div className="min-w-0 space-y-1">
                      <h3 className="font-display text-xs font-bold uppercase tracking-[0.18em] text-pv-text sm:tracking-[0.2em]">{t("advancedToggle")}</h3>
                      <p className="text-[10px] leading-relaxed text-pv-muted sm:text-[11px]">{t("advancedHint")}</p>
                    </div>
                  </div>
                  <ChevronDown size={20} className={`shrink-0 text-pv-muted transition-transform duration-200 ease-out ${advancedOpen ? "rotate-180" : ""}`} aria-hidden />
                </button>
                <div
                  data-open={advancedOpen ? "true" : "false"}
                  className={`collapse-grid ${!advancedOpen ? "pointer-events-none" : ""}`}
                  aria-hidden={!advancedOpen}
                >
                  <div id={termsPanelId} className="space-y-8 border-t border-pv-border/25 px-6 pb-6 pt-6 sm:px-8 sm:pb-8">
                    {/* Category */}
                    <div className="space-y-3">
                      <label className="block text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted">{t("category")}</label>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {CATEGORIES.map((cat) => {
                          const selected = category === cat.id;
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => setCategory(normalizeCategoryId(cat.id))}
                              aria-pressed={selected}
                              className={`rounded-lg border px-3 py-2.5 text-left font-display text-[11px] font-bold capitalize transition-[border-color,background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pv-emerald/35 sm:text-xs ${
                                selected
                                  ? "border-pv-emerald bg-pv-emerald/[0.12] text-pv-emerald shadow-[0_0_16px_-8px_rgba(255,81,72,0.3)]"
                                  : "border border-pv-border/25 bg-pv-surface text-pv-muted hover:border-pv-emerald/35 hover:text-pv-emerald"
                              }`}
                            >
                              {cat.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Settlement rule */}
                    <div className="space-y-3">
                      <label htmlFor="settlement-rule" className="block text-[10px] font-bold uppercase tracking-[0.16em] text-pv-muted">
                        {t("settlementRule")}
                      </label>
                      <textarea
                        id="settlement-rule"
                        rows={4}
                        className="w-full resize-none rounded-xl border border-pv-border/25 bg-pv-bg/90 px-4 py-3 text-sm text-pv-text outline-none transition-all placeholder:text-pv-muted/40 focus:border-pv-emerald/50 focus:ring-1 focus:ring-pv-emerald/20"
                        placeholder={t("settlementPlaceholder")}
                        value={settlementRule}
                        onChange={(e) => setSettlementRule(e.target.value)}
                      />
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <p className="min-w-0 flex-1 text-left text-[11px] leading-relaxed text-pv-muted">{t("settlementRuleHint")}</p>
                        <button
                          type="button"
                          onClick={() => setSettlementRule(recommendedSettlementTemplate)}
                          className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-md border border-pv-border/25 bg-pv-border/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-pv-text/90 transition-colors hover:border-pv-border/25 hover:bg-pv-border/[0.07] sm:self-auto"
                        >
                          <Wand2 className="size-3.5 shrink-0 text-pv-emerald/90" aria-hidden />
                          <span>{t("useRecommendedRule")}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </GlassCard>
            </AnimatedItem>

          </div>

          {/* ── Right sidebar ── */}
          <aside className="lg:col-span-4 text-pv-text">
            <AnimatedItem>
              <div className="flex flex-col gap-6 lg:sticky lg:top-24">
                <CreateChallengeTicket
                  draftId={ticketDraftId}
                  marketTypeLabel={t("marketTypes.binary" as any)}
                  oddsModeLabel={t("oddsModes.pool" as any)}
                  formatLabel={t("headToHeadSummary")}
                  visibilityLabel={t("visibilityPublic")}
                  settlementPreview={ticketSettlementPreview}
                  stakeAmount={stake}
                  walletAddress={walletAddress}
                />

                <CouncilPreflight
                  draft={{
                    question: question.trim(),
                    creatorPosition: creatorPos.trim(),
                    counterPosition: opponentPos.trim(),
                    resolutionUrl: finalResolutionUrl,
                    category,
                    settlementRule: settlementRule.trim(),
                    deadlineHours: customDeadline
                      ? Math.max(0, Math.round((new Date(customDeadline).getTime() - Date.now()) / 3_600_000))
                      : 0,
                  }}
                />

                {error && (
                  <div className="rounded-xl border border-red-400/30 bg-red-500/[0.08] px-4 py-3 text-sm text-red-400">
                    {error}
                  </div>
                )}

                <Button
                  variant="primary"
                  onClick={() => void onSubmit()}
                  loading={!!busy}
                  disabled={!!busy}
                  className="rounded-2xl py-5 font-display text-sm font-bold uppercase tracking-widest"
                >
                  {busy ?? (
                    <>
                      <span>{t("createAndFund", { amount: stake })}</span>
                      <Zap className="size-5 shrink-0" aria-hidden />
                    </>
                  )}
                </Button>

                <p className="text-center text-[9px] font-bold uppercase tracking-widest text-pv-muted/55 leading-snug">
                  {t("ticketSignatureNote")}
                </p>

                <p className="text-center text-[11px] text-pv-muted">
                  Need test USDC?{" "}
                  <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" className="text-pv-cyan underline underline-offset-2">
                    faucet.circle.com
                  </a>{" "}
                  → USDC · Solana Devnet.
                </p>
              </div>
            </AnimatedItem>
          </aside>
        </div>
      )}
      </div>
    </PageTransition>
  );
}
