"use client";

/**
 * CouncilPreflight: optional "ask the council" check for a draft claim on
 * /arena/create. Posts the draft to /api/council/preflight and shows each
 * persona's open / revise / skip call. Advisory only: it never blocks
 * publishing, and a draft that changes after a check shows the result as stale.
 */
import { SURFACE } from "@/components/arena/surface";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";
import PeepAvatar from "@/components/ui/PeepAvatar";
import { holderProofHeaders } from "@/components/token/useHolderTier";

export interface PreflightDraft {
  question: string;
  creatorPosition: string;
  counterPosition: string;
  resolutionUrl: string;
  category: string;
  settlementRule: string;
  deadlineHours: number;
}

interface Opinion {
  slug: string;
  displayName: string;
  decision: "open" | "revise" | "skip";
  score: number;
  reasoning: string;
}

interface Result {
  opinions: Opinion[];
  averageScore: number | null;
  openVotes: number;
  reviseVotes: number;
  skipVotes: number;
}

const DECISION_CLASS: Record<Opinion["decision"], string> = {
  open: "text-win",
  revise: "text-pending",
  skip: "text-danger",
};

export default function CouncilPreflight({ draft }: { draft: PreflightDraft }) {
  const t = useTranslations("councilPreflight");
  const { publicKey } = useWallet();
  const [result, setResult] = useState<Result | null>(null);
  const [checkedKey, setCheckedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = JSON.stringify(draft);
  const ready =
    draft.question.trim().length >= 8 && !!draft.creatorPosition.trim() && !!draft.counterPosition.trim() && /^https?:\/\//.test(draft.resolutionUrl.trim());
  const stale = result !== null && checkedKey !== key;

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/council/preflight", {
        method: "POST",
        // A stored holder proof lifts the rate limit to the wallet's token tier.
        headers: { "content-type": "application/json", ...holderProofHeaders(publicKey?.toBase58()) },
        body: JSON.stringify(draft),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(res.status === 429 ? t("rateLimited") : t("unavailable"));
        return;
      }
      setResult(body.data as Result);
      setCheckedKey(key);
    } catch {
      setError(t("unavailable"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${SURFACE} grid gap-3 p-5`} aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <h3 className="m-0 text-[15px] font-normal text-cream">{t("title")}</h3>
          <p className="m-0 text-[13px] leading-relaxed text-muted">{t("hint")}</p>
        </div>
        <button
          type="button"
          onClick={() => void ask()}
          disabled={!ready || busy}
          className="glass press inline-flex min-h-[38px] shrink-0 items-center rounded-full px-4 text-[14px] text-cream shadow-chip disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? t("asking") : result ? t("askAgain") : t("ask")}
        </button>
      </div>

      {!ready && !result ? <p className="m-0 text-[12px] text-dim">{t("needsDraft")}</p> : null}
      {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}

      {result ? (
        <div className={`grid gap-2 ${stale ? "opacity-60" : ""}`}>
          <p className="m-0 font-mono text-[12px] text-muted">
            {t("summary", {
              score: result.averageScore ?? "-",
              open: result.openVotes,
              revise: result.reviseVotes,
              skip: result.skipVotes,
            })}
            {stale ? ` · ${t("stale")}` : ""}
          </p>
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {result.opinions.map((o) => (
              <li key={o.slug} className="flex gap-2.5 rounded-xl bg-cream/[0.035] px-3 py-2.5">
                <PeepAvatar seed={`council-${o.slug}`} size={28} tone="neutral" />
                <div className="min-w-0 flex-1">
                  <p className="m-0 flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="text-cream">{o.displayName}</span>
                    <span className={DECISION_CLASS[o.decision]}>{t(`decision.${o.decision}`)}</span>
                    <span className="font-mono text-[12px] tabular-nums text-muted">{o.score}/100</span>
                  </p>
                  <p className="m-0 mt-0.5 text-[12px] leading-relaxed text-muted">{o.reasoning}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
