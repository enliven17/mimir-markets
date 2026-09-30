"use client";

/** Step 1: the question and its two sides, with a one-click draft of both sides from the question. */
import { useTranslations } from "next-intl";
import { Wand2 } from "lucide-react";
import Input, { Textarea } from "@/components/ui/Input";
import type { CreateDraft } from "./useCreateDraft";

export default function QuestionStep({ draft }: { draft: CreateDraft }) {
  const t = useTranslations("arena.create");
  const tc = useTranslations("create");
  const f = draft.fields;

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <Textarea
          label={t("question")}
          rows={3}
          value={f.question}
          onChange={(e) => f.setQuestion(e.target.value)}
          placeholder={t("questionPlaceholder")}
          className="!min-h-[6.5rem] !rounded-xl !px-5 !py-4 !text-[17px] leading-snug"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`m-0 text-[13px] ${draft.derived.questionNeedsWork ? "text-pending" : "text-muted"}`}>
            {draft.derived.questionNeedsWork ? tc("qualitySpecificity") : null}
          </p>
          <button
            type="button"
            onClick={draft.draftSides}
            disabled={f.question.trim().length === 0}
            title={tc("outcomeAutofillHint")}
            className="glass press inline-flex min-h-[36px] items-center gap-2 rounded-full px-3.5 text-[13px] text-cream shadow-chip disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Wand2 className="size-3.5 text-coral" aria-hidden />
            {tc("outcomeAutofillAction")}
          </button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={t("sideA")}
          dot="var(--cream)"
          value={f.creatorPos}
          onChange={(e) => f.setCreatorPos(e.target.value)}
          placeholder={t("sideAPlaceholder")}
          autoComplete="off"
        />
        <Input
          label={t("sideB")}
          dot="var(--coral)"
          value={f.opponentPos}
          onChange={(e) => f.setOpponentPos(e.target.value)}
          placeholder={t("sideBPlaceholder")}
          autoComplete="off"
        />
      </div>
    </div>
  );
}
