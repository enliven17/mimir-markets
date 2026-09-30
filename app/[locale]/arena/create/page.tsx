"use client";

/**
 * /arena/create: publish a claim in four steps inside one sheet, with the
 * step bar on top: Question → Stake → Deadline & source → Review. Back and
 * Next keep every field; Next checks the step before moving on. Publishing
 * creates and funds the claim on the base layer, then delegates it to the
 * MagicBlock Ephemeral Rollup; the success screen shows both transactions.
 * A `?source=` link from a suggested claim lands on step 1, filled.
 */
import { SURFACE_DEEP } from "@/components/arena/surface";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button, Progress, Sheet } from "@/components/ui";
import { CREATE_STEPS, useCreateDraft } from "@/components/create/useCreateDraft";
import QuestionStep from "@/components/create/QuestionStep";
import StakeStep from "@/components/create/StakeStep";
import DeadlineSourceStep from "@/components/create/DeadlineSourceStep";
import ReviewStep from "@/components/create/ReviewStep";
import CreateSuccess from "@/components/create/CreateSuccess";

export default function CreateClaimPage() {
  const t = useTranslations("arena.create");
  const tc = useTranslations("create");
  const td = useTranslations("arena.detail");
  const draft = useCreateDraft();
  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const steps = t.raw("steps") as string[];

  // Focus the new step's heading after Back / Next (not on first load).
  useEffect(() => {
    if (!moved.current) return;
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ block: "nearest" });
  }, [step]);

  if (draft.published) {
    return (
      <CreateSuccess
        published={draft.published}
        onAnother={() => {
          draft.reset();
          moved.current = false;
          setStep(0);
        }}
      />
    );
  }

  const go = (next: number) => {
    if (next > step) {
      const err = draft.stepError(step);
      if (err) {
        setStepError(err);
        return;
      }
    }
    setStepError(null);
    draft.setError(null);
    moved.current = true;
    setStep(Math.max(0, Math.min(CREATE_STEPS - 1, next)));
  };

  const body =
    step === 0 ? (
      <QuestionStep draft={draft} />
    ) : step === 1 ? (
      <StakeStep draft={draft} />
    ) : step === 2 ? (
      <DeadlineSourceStep draft={draft} />
    ) : (
      <ReviewStep draft={draft} />
    );

  return (
    <div className="mx-auto grid w-full max-w-[640px] grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Link
          href="/arena"
          className="press inline-flex min-h-[34px] items-center gap-1.5 rounded-full pr-2 text-[14px] text-muted transition-colors hover:text-cream"
        >
          <span aria-hidden>←</span>
          {td("back")}
        </Link>
        {draft.prefilledFrom ? (
          <p role="status" className="m-0 text-[13px] text-muted">
            {tc("prefilledFrom", { source: draft.prefilledFrom })}
          </p>
        ) : null}
      </div>

      <Sheet className={`!px-5 !py-7 sm:!px-9 sm:!py-9 ${SURFACE_DEEP} ![-webkit-backdrop-filter:none] ![backdrop-filter:none]`}>
        <div className="grid gap-5">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="m-0 font-display text-app-h1 text-cream">{t("title")}</h1>
            <span className="shrink-0 font-mono text-[12px] text-muted">
              {t("stepOf", { n: step + 1, total: CREATE_STEPS })}
            </span>
          </div>
          <Progress steps={steps} current={step} label={t("stepsLabel")} />
        </div>

        <form
          className="mt-7 grid gap-6"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (step < CREATE_STEPS - 1) go(step + 1);
          }}
        >
          <h2 ref={headingRef} tabIndex={-1} className="sr-only">
            {steps[step]}
          </h2>
          <div key={step} className="fade-rise">
            {body}
          </div>

          {stepError ? (
            <p role="alert" className="m-0 rounded-xl bg-danger/[0.1] px-4 py-3 text-[14px] text-danger">
              {stepError}
            </p>
          ) : null}

          <div className="flex items-center gap-3 border-t border-line pt-5">
            {step > 0 ? (
              <Button type="button" variant="ghost" size="sm" fullWidth={false} onClick={() => go(step - 1)} disabled={!!draft.busy}>
                {t("back")}
              </Button>
            ) : null}
            {step < CREATE_STEPS - 1 ? (
              <Button type="submit" variant="light" size="sm" fullWidth={false} className="ml-auto !min-w-[8rem]">
                {t("next")}
              </Button>
            ) : null}
          </div>
        </form>
      </Sheet>
    </div>
  );
}
