"use client";

/**
 * CouncilPreflight — optional "ask the council" check for a draft claim on
 * /arena/create. Posts the draft to /api/council/preflight and shows each
 * persona's open / revise / skip call. Advisory only: it never blocks
 * publishing, and a draft that changes after a check shows the result as stale.
 */
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
  open: "border-pv-emerald/40 bg-pv-emerald/[0.08] text-pv-emerald",
  revise: "border-pv-gold/40 bg-pv-gold/[0.08] text-pv-gold",
  skip: "border-pv-danger/40 bg-pv-danger/[0.06] text-pv-danger",
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
    <section className="border border-pv-border/25 bg-pv-surface p-4" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-pv-emerald">{t("title")}</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-pv-muted">{t("hint")}</p>
        </div>
        <button
          type="button"
          onClick={() => void ask()}
          disabled={!ready || busy}
          className="focus-ring shrink-0 border border-pv-emerald/40 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-pv-emerald transition-colors hover:bg-pv-emerald/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? t("asking") : result ? t("askAgain") : t("ask")}
        </button>
      </div>

      {!ready && !result ? <p className="mt-3 text-[11px] text-pv-muted/80">{t("needsDraft")}</p> : null}
      {error ? <p className="mt-3 text-[11px] text-pv-danger">{error}</p> : null}

      {result ? (
        <div className={`mt-3 space-y-2 ${stale ? "opacity-60" : ""}`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
            {t("summary", {
              score: result.averageScore ?? "—",
              open: result.openVotes,
              revise: result.reviseVotes,
              skip: result.skipVotes,
            })}
            {stale ? ` · ${t("stale")}` : ""}
          </p>
          <ul className="divide-y divide-pv-border/25 border border-pv-border/25">
            {result.opinions.map((o) => (
              <li key={o.slug} className="flex gap-2 bg-pv-bg px-3 py-2">
                <PeepAvatar seed={`council-${o.slug}`} size={28} tone="neutral" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] font-semibold text-pv-text">{o.displayName}</span>
                    <span className={`border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] ${DECISION_CLASS[o.decision]}`}>
                      {t(`decision.${o.decision}`)}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-pv-muted">{o.score}/100</span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-pv-text/80">{o.reasoning}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
