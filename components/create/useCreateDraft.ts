"use client";

/**
 * Everything the create flow holds between steps: the draft fields, what is
 * derived from them (deadline, resolver spec, final resolution URL, council
 * preflight draft), per-step validation and the publish transaction pair
 * (create + fund on the base layer, then delegate to the ER).
 *
 * A `?source=…&q=…` link from a suggested claim prefills the draft once.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";
import { useBrowserMimir, createClaim, delegateClaim } from "@/lib/solana/browser-client-lazy";
import { CATEGORY_GUIDANCE, MIN_STAKE } from "@/lib/constants";
import { txErrorMessage } from "@/lib/tx-errors";
import { deterministicPriceOption } from "@/lib/resolver-spec";
import { FLASH_CLAIM_SYMBOLS, flashResolutionUrl } from "@/lib/solana/flashtrade";
import { dexMintFor, dexSourceUrl } from "@/lib/token-config";
import { draftOutcomeSidesFromQuestion } from "@/lib/outcomeDraft";
import { parseCreatePrefill } from "@/lib/create-prefill";
import type { PreflightDraft } from "@/components/council/CouncilPreflight";

export const CREATE_STEPS = 4;

export function formatLocalDateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function formatLocalTimeInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(11, 16);
}

// FNV-1a hash for the ticket's draft id.
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

export interface Published {
  id: bigint;
  createSig: string | null;
  delegateSig: string | null;
}

export function useCreateDraft() {
  const t = useTranslations("create");
  const tf = useTranslations("arena.create");
  const locale = useLocale();
  const wallet = useWallet();
  const mimir = useBrowserMimir(wallet);

  const [question, setQuestion] = useState("");
  const [creatorPos, setCreatorPos] = useState("");
  const [opponentPos, setOpponentPos] = useState("");
  const [url, setUrl] = useState("");
  const [deadlinePreset, setDeadlinePreset] = useState<number | null>(null);
  const [deadlineDate, setDeadlineDate] = useState("");
  const [deadlineTime, setDeadlineTime] = useState("");
  const [stake, setStake] = useState(5);
  const [category, setCategory] = useState("custom");
  const [settlementRule, setSettlementRule] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deterministic, setDeterministic] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<Published | null>(null);
  const [prefilledFrom, setPrefilledFrom] = useState<string | null>(null);

  // ?source=…&q=…&a=…&b=…&cat=…&deadline=…&rule=… from a suggested-claim card.
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
      setDeadlineDate(formatLocalDateInputValue(d));
      setDeadlineTime(formatLocalTimeInputValue(d));
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

  const applyDeadlinePreset = (seconds: number) => {
    const d = new Date(Date.now() + seconds * 1000);
    setDeadlinePreset(seconds);
    setDeadlineDate(formatLocalDateInputValue(d));
    setDeadlineTime(formatLocalTimeInputValue(d));
  };

  const draftSides = () => {
    const d = draftOutcomeSidesFromQuestion(question, locale);
    if (d) {
      setCreatorPos(d.creator);
      setOpponentPos(d.opponent);
    }
  };

  const deadlineLocal = deadlineDate && deadlineTime ? `${deadlineDate}T${deadlineTime}` : "";
  const deadlineSec = deadlineLocal ? Math.floor(new Date(deadlineLocal).getTime() / 1000) : 0;

  const guidanceKey = (category in CATEGORY_GUIDANCE ? category : "custom") as keyof typeof CATEGORY_GUIDANCE;
  const guidance = CATEGORY_GUIDANCE[guidanceKey] ?? CATEGORY_GUIDANCE.custom;
  const settlementPreview = settlementRule.trim() || guidance.settlementTemplate;
  const questionNeedsWork = question.trim().length > 0 && question.trim().length < 24;
  const sourceNeedsWork = url.trim().length > 0 && !/^https?:\/\//.test(url.trim());
  const draftId = useMemo(() => computeDraftId(question, creatorPos, stake), [question, creatorPos, stake]);

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
    [question, creatorPos, opponentPos, url],
  );
  const finalResolutionUrl = priceOption && deterministic ? priceOption.resolutionUrl : url.trim();

  const preflightDraft: PreflightDraft = {
    question: question.trim(),
    creatorPosition: creatorPos.trim(),
    counterPosition: opponentPos.trim(),
    resolutionUrl: finalResolutionUrl,
    category,
    settlementRule: settlementRule.trim(),
    deadlineHours: deadlineSec ? Math.max(0, Math.round((deadlineSec * 1000 - Date.now()) / 3_600_000)) : 0,
  };

  /** The reason `step` (0-based) cannot be left yet, or null. */
  const stepError = (step: number): string | null => {
    if (step >= 0 && (!question.trim() || !creatorPos.trim() || !opponentPos.trim())) return t("fillAllFields");
    if (step >= 1 && !(stake >= MIN_STAKE)) return t("invalidStakeMin", { amount: MIN_STAKE });
    if (step >= 2) {
      if (deadlineDate && !deadlineTime) return t("completeExactDeadline");
      if (!deadlineSec || deadlineSec <= Math.floor(Date.now() / 1000)) return t("invalidDeadline");
    }
    return null;
  };

  const publish = async () => {
    if (!mimir) return;
    setError(null);
    const invalid = stepError(2);
    if (invalid) {
      setError(invalid);
      return;
    }
    try {
      setBusy(t("funding"));
      const { claimId, txSig } = await createClaim(mimir, {
        question: question.trim(),
        creatorPosition: creatorPos.trim(),
        counterPosition: opponentPos.trim(),
        resolutionUrl: finalResolutionUrl,
        category,
        stakeAmount: BigInt(Math.round(stake * 1e6)),
        deadline: deadlineSec,
        maxChallengers: 16,
      });
      setBusy(tf("delegating"));
      const delegateSig = await delegateClaim(mimir, claimId);
      setPublished({ id: claimId, createSig: txSig, delegateSig });
    } catch (err) {
      setError(txErrorMessage(err, t("errorCreating")));
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    setPublished(null);
    setQuestion("");
    setCreatorPos("");
    setOpponentPos("");
    setUrl("");
    setSettlementRule("");
    setError(null);
  };

  return {
    connected: !!mimir,
    walletAddress: wallet.publicKey?.toBase58() ?? null,
    fields: {
      question,
      setQuestion,
      creatorPos,
      setCreatorPos,
      opponentPos,
      setOpponentPos,
      url,
      setUrl,
      deadlinePreset,
      applyDeadlinePreset,
      deadlineDate,
      setDeadlineDate: (v: string) => {
        setDeadlinePreset(null);
        setDeadlineDate(v);
      },
      deadlineTime,
      setDeadlineTime: (v: string) => {
        setDeadlinePreset(null);
        setDeadlineTime(v);
      },
      stake,
      setStake,
      category,
      setCategory,
      settlementRule,
      setSettlementRule,
      advancedOpen,
      setAdvancedOpen,
      deterministic,
      setDeterministic,
    },
    derived: {
      deadlineSec,
      guidance,
      settlementPreview,
      questionNeedsWork,
      sourceNeedsWork,
      draftId,
      priceOption,
      finalResolutionUrl,
      preflightDraft,
    },
    draftSides,
    stepError,
    publish,
    busy,
    error,
    setError,
    published,
    reset,
    prefilledFrom,
  };
}

export type CreateDraft = ReturnType<typeof useCreateDraft>;
