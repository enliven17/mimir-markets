"use client";

/**
 * Step 3: when it closes and where the truth comes from. Deadline presets or
 * an exact date and time; the resolution source (with example sources for
 * the category and, for price thresholds, the deterministic resolver);
 * category and settlement rule behind a disclosure.
 */
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Wand2 } from "lucide-react";
import { Chip, Disclosure, Input, Textarea } from "@/components/ui";
import ResolverToggle from "@/components/arena/ResolverToggle";
import { CATEGORIES, DEADLINE_PRESET_IDS, DEADLINE_PRESET_SECONDS, normalizeCategoryId } from "@/lib/constants";
import { formatLocalDateInputValue, type CreateDraft } from "./useCreateDraft";

export default function DeadlineSourceStep({ draft }: { draft: CreateDraft }) {
  const t = useTranslations("arena.create");
  const tc = useTranslations("create");
  const f = draft.fields;
  const d = draft.derived;
  const dateId = useId();
  const timeId = useId();
  const [minDate, setMinDate] = useState<string | undefined>(undefined);
  useEffect(() => setMinDate(formatLocalDateInputValue(new Date())), []);

  return (
    <div className="grid gap-6">
      <fieldset className="m-0 grid gap-3 border-0 p-0">
        <legend className="label !mb-3">{t("deadline")}</legend>
        <div className="flex flex-wrap gap-2">
          {DEADLINE_PRESET_IDS.map((id) => {
            const seconds = DEADLINE_PRESET_SECONDS[id];
            return (
              <Chip key={id} active={f.deadlinePreset === seconds} onClick={() => f.applyDeadlinePreset(seconds)}>
                {tc(`presets.${id}` as "presets.1h")}
              </Chip>
            );
          })}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-2">
          <div>
            <label htmlFor={dateId} className="sr-only">
              {tc("exactDate")}
            </label>
            <input
              id={dateId}
              type="date"
              min={minDate}
              value={f.deadlineDate}
              onChange={(e) => f.setDeadlineDate(e.target.value)}
              className="input !min-h-[46px] !py-2.5 font-mono !text-[14px] [color-scheme:dark]"
            />
          </div>
          <div>
            <label htmlFor={timeId} className="sr-only">
              {tc("exactTime")}
            </label>
            <input
              id={timeId}
              type="time"
              value={f.deadlineTime}
              onChange={(e) => f.setDeadlineTime(e.target.value)}
              disabled={!f.deadlineDate}
              className="input !min-h-[46px] !py-2.5 font-mono !text-[14px] [color-scheme:dark] disabled:opacity-50"
            />
          </div>
        </div>
      </fieldset>

      <div className="grid gap-2.5">
        <Input
          label={t("source")}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={tc("verificationUrlPlaceholder")}
          value={f.url}
          onChange={(e) => f.setUrl(e.target.value)}
          mono
          className="!text-[13px]"
        />
        {d.sourceNeedsWork ? <p className="m-0 text-[13px] text-pending">{tc("qualitySource")}</p> : null}
        <div className="flex flex-wrap gap-1.5">
          {d.guidance.sourceExamples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => f.setUrl(`https://${example}`)}
              className="press rounded-full bg-cream/[0.05] px-3 py-1.5 font-mono text-[11px] text-muted transition-colors hover:text-cream"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {d.priceOption ? (
        <ResolverToggle
          spec={d.priceOption.spec}
          resolutionUrl={d.priceOption.resolutionUrl}
          enabled={f.deterministic}
          onChange={f.setDeterministic}
        />
      ) : null}

      <Disclosure summary={t("advanced")} defaultOpen={f.advancedOpen}>
        <div className="grid gap-5">
          <fieldset className="m-0 grid gap-2.5 border-0 p-0">
            <legend className="label !mb-2.5">{tc("category")}</legend>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <Chip key={cat.id} active={f.category === cat.id} onClick={() => f.setCategory(normalizeCategoryId(cat.id))}>
                  {cat.label}
                </Chip>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-2">
            <Textarea
              label={tc("settlementRule")}
              rows={3}
              value={f.settlementRule}
              onChange={(e) => f.setSettlementRule(e.target.value)}
              placeholder={tc("settlementPlaceholder")}
              className="!rounded-xl !text-[14px]"
            />
            <button
              type="button"
              onClick={() => f.setSettlementRule(d.guidance.settlementTemplate)}
              className="glass press inline-flex min-h-[36px] items-center gap-2 justify-self-start rounded-full px-3.5 text-[13px] text-cream shadow-chip"
            >
              <Wand2 className="size-3.5 text-coral" aria-hidden />
              {tc("useRecommendedRule")}
            </button>
          </div>
        </div>
      </Disclosure>
    </div>
  );
}
