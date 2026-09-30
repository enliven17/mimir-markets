"use client";

/** Step 2: the creator stake, from a slider, a preset or a typed amount (minimum 2 USDC). */
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import Chip from "@/components/ui/Chip";
import Slider from "@/components/ui/Slider";
import { MIN_STAKE } from "@/lib/constants";
import { formatUsdcBare } from "@/lib/money";
import type { CreateDraft } from "./useCreateDraft";

const PRESETS = [MIN_STAKE, 5, 10, 25, 50] as const;
const SLIDER_MAX = 100;

export default function StakeStep({ draft }: { draft: CreateDraft }) {
  const t = useTranslations("arena.create");
  const tc = useTranslations("create");
  const { stake, setStake } = draft.fields;
  const sliderId = useId();
  const customId = useId();
  const [custom, setCustom] = useState("");

  // A preset or the slider clears the typed amount.
  useEffect(() => {
    if (custom && Number(custom) !== stake) setCustom("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stake]);

  return (
    <div className="grid gap-6">
      <p className="m-0 flex items-baseline justify-center gap-3 py-2 text-center">
        <span className="font-display text-[clamp(3.4rem,14vw,5rem)] leading-none text-cream">${formatUsdcBare(stake)}</span>
        <span className="text-[14px] text-muted">USDC</span>
      </p>
      <div className="grid gap-2">
        <label htmlFor={sliderId} className="label !mb-0">
          {t("stake")}
        </label>
        <Slider
          id={sliderId}
          min={MIN_STAKE}
          max={SLIDER_MAX}
          step={1}
          value={Math.min(SLIDER_MAX, Math.max(MIN_STAKE, stake))}
          onChange={(e) => setStake(Number(e.target.value))}
          aria-valuetext={`${stake} USDC`}
        />
        <p className="m-0 flex justify-between font-mono text-[12px] text-dim" aria-hidden>
          <span>{MIN_STAKE}</span>
          <span>{SLIDER_MAX}+</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((v) => (
          <Chip key={v} active={stake === v && !custom} onClick={() => setStake(v)}>
            {v} USDC
          </Chip>
        ))}
        <label htmlFor={customId} className="sr-only">
          {tc("stakeCustomAmount")}
        </label>
        <input
          id={customId}
          type="number"
          min={MIN_STAKE}
          step={1}
          inputMode="numeric"
          placeholder={t("custom")}
          value={custom}
          onChange={(e) => {
            setCustom(e.target.value);
            const n = Math.floor(Number(e.target.value));
            if (Number.isFinite(n) && n >= MIN_STAKE) setStake(n);
          }}
          className="input !min-h-[34px] !w-[104px] !px-3.5 !py-1.5 font-mono !text-[13px] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>
      <p className="m-0 text-[13px] text-muted">{t("stakeHint")}</p>
    </div>
  );
}
