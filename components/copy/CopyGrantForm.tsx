"use client";

/**
 * Grant a copy permission.
 *
 * The preview is `copyPermissionMessage(draft)` for the very draft that gets
 * POSTed (only the `signedAt` line is stamped at the moment you sign), so what
 * the follower reads here, what the wallet shows and what the server
 * re-derives and verifies are one string (see `lib/copy-form.ts`).
 */
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { RefreshCw, TriangleAlert } from "lucide-react";

import { copyPermissionMessage, worstCaseCopySpend } from "@/lib/copy-trading";
import {
  COPY_CATEGORIES,
  DEFAULT_COPY_FORM,
  buildCopyDraft,
  copyDraftError,
  copyGrantBody,
  dateInputValue,
  suggestCopyId,
  type CopyFormValues,
} from "@/lib/copy-form";
import {
  grantCopyPermission,
  listExecutionAgents,
  listSignalAgents,
  type AgentOption,
} from "@/lib/copy-client";
import { formatUsdc } from "@/lib/money";
import { txErrorMessage } from "@/lib/tx-errors";
import { Link } from "@/i18n/navigation";
import Button from "@/components/ui/Button";
import Disclosure from "@/components/ui/Disclosure";
import { useSignText } from "./useSignText";

type NumericField =
  | "maxPerPositionUsdc"
  | "maxDailyUsdc"
  | "maxWeeklyUsdc"
  | "maxOpenExposureUsdc"
  | "maxRealizedLossUsdc"
  | "minClaimQuality"
  | "minPayoutRatio";

const newSuffix = () => Math.random().toString(36).slice(2, 6);

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="m-0 mt-2 text-[12px] leading-snug text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface CopyGrantFormProps {
  address: string;
  onDisabled: () => void;
}

export default function CopyGrantForm({ address, onDisabled }: CopyGrantFormProps) {
  const t = useTranslations("copy");
  const format = useFormatter();
  const signText = useSignText();
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;

  const [signalAgents, setSignalAgents] = useState<AgentOption[] | null>(null);
  const [executors, setExecutors] = useState<AgentOption[] | null>(null);
  const [values, setValues] = useState<CopyFormValues>(() => ({
    ...DEFAULT_COPY_FORM,
    expiresOn: dateInputValue(Date.now(), 30),
  }));
  const [previewAt, setPreviewAt] = useState(() => Date.now());
  const [idTouched, setIdTouched] = useState(false);
  const [suffix, setSuffix] = useState(newSuffix);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listSignalAgents().then((list) => !cancelled && setSignalAgents(list));
    void listExecutionAgents().then((list) => {
      if (cancelled) return;
      // The follower's own agents first: only those can execute for them.
      setExecutors([...list].sort((a, b) => Number(b.wallet === address) - Number(a.wallet === address)));
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const set = <K extends keyof CopyFormValues>(key: K, value: CopyFormValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const toggleCategory = (c: string) =>
    setValues((prev) => ({
      ...prev,
      allowedCategories: prev.allowedCategories.includes(c)
        ? prev.allowedCategories.filter((x) => x !== c)
        : [...prev.allowedCategories, c],
    }));

  const autoId =
    values.signalAgentId || values.executionAgentId
      ? suggestCopyId(values.signalAgentId, values.executionAgentId, suffix)
      : "";
  const effectiveValues = { ...values, id: idTouched ? values.id : autoId };
  const draft = buildCopyDraft(effectiveValues, address, previewAt);
  const draftError = copyDraftError(draft);
  const message = copyPermissionMessage(draft);
  const worstCase = worstCaseCopySpend(draft);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (draftError || busy) return;
    if (!signText) return setSubmitError(t("noSignMessage"));
    setSubmitError(null);
    setNotice(null);
    setBusy(true);
    try {
      const signedAt = Date.now();
      setPreviewAt(signedAt);
      const signed = buildCopyDraft(effectiveValues, address, signedAt);
      const signature = await signText(copyPermissionMessage(signed));
      const result = await grantCopyPermission(copyGrantBody(signed, signature));
      if (result.kind === "disabled") {
        onDisabled();
      } else if (result.kind === "error") {
        setSubmitError(t("requestFailed", { message: result.message }));
      } else {
        setNotice(
          t("grant.granted", {
            id: result.data.id,
            date: format.dateTime(new Date(result.data.expiresAt), { dateStyle: "medium" }),
          }),
        );
        setSuffix(newSuffix());
        setIdTouched(false);
      }
    } catch (err) {
      setSubmitError(txErrorMessage(err, t("signatureFailed")));
    } finally {
      setBusy(false);
    }
  }

  const agentPicker = (key: "signalAgentId" | "executionAgentId", options: AgentOption[] | null) => {
    const id = fid(key);
    const common = { id, value: values[key], required: true, "aria-describedby": `${id}-hint` };
    if (options && options.length === 0) {
      return (
        <input
          {...common}
          className="input font-mono"
          placeholder={t("grant.agentIdPlaceholder")}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => set(key, e.target.value.trim())}
        />
      );
    }
    return (
      <select {...common} className="select" disabled={options === null} onChange={(e) => set(key, e.target.value)}>
        <option value="">{options === null ? t("grant.agentsLoading") : t("grant.selectAgent")}</option>
        {(options ?? []).map((a) => (
          <option key={a.agentId} value={a.agentId}>
            {a.label && a.label !== a.agentId ? `${a.label} (${a.agentId})` : a.agentId}
            {key === "executionAgentId" && a.wallet === address ? ` · ${t("grant.yours")}` : ""}
          </option>
        ))}
      </select>
    );
  };

  const numberInput = (key: NumericField, label: string, hint?: string, step = "any") => {
    const id = fid(key);
    return (
      <Field id={id} label={label} hint={hint}>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step={step}
          required
          className="input font-mono tabular-nums"
          value={values[key]}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(e) => set(key, e.target.value)}
        />
      </Field>
    );
  };

  return (
    <div className="grid gap-5">
      <p className="m-0 text-[14px] leading-relaxed text-muted">{t("grant.desc")}</p>

      <form className="grid gap-5" onSubmit={(e) => void submit(e)} noValidate>
        <fieldset className="m-0 grid gap-4 border-0 p-0 sm:grid-cols-2">
          <legend className="mb-3 font-display text-[1.2rem] leading-none text-cream">{t("grant.agentsTitle")}</legend>
          <Field id={fid("signalAgentId")} label={t("grant.signalAgent")} hint={t("grant.signalAgentHint")}>
            {agentPicker("signalAgentId", signalAgents)}
          </Field>
          <Field id={fid("executionAgentId")} label={t("grant.executionAgent")} hint={t("grant.executionAgentHint")}>
            {agentPicker("executionAgentId", executors)}
          </Field>
          {executors && executors.length === 0 ? (
            <p className="m-0 text-[13px] text-muted sm:col-span-2">
              {t("grant.noAgents")}{" "}
              <Link href="/agents/new" className="text-coral hover:underline">
                {t("grant.connectAgent")}
              </Link>
            </p>
          ) : null}
          <div className="sm:col-span-2">
            <Field id={fid("id")} label={t("grant.id")} hint={t("grant.idHint")}>
              <div className="flex gap-2">
                <input
                  id={fid("id")}
                  className="input min-w-0 flex-1 font-mono"
                  value={effectiveValues.id}
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby={`${fid("id")}-hint`}
                  onChange={(e) => {
                    setIdTouched(true);
                    set("id", e.target.value.toLowerCase().trim());
                  }}
                />
                <button
                  type="button"
                  className="press grid size-[50px] flex-none place-items-center rounded-full bg-panel-raised text-muted transition-colors hover:text-cream"
                  aria-label={t("grant.regenerate")}
                  title={t("grant.regenerate")}
                  onClick={() => {
                    setSuffix(newSuffix());
                    setIdTouched(false);
                  }}
                >
                  <RefreshCw className="size-4" aria-hidden />
                </button>
              </div>
            </Field>
          </div>
        </fieldset>

        <fieldset className="m-0 grid grid-cols-2 gap-4 border-0 p-0">
          <legend className="mb-3 font-display text-[1.2rem] leading-none text-cream">{t("grant.capsTitle")}</legend>
          {numberInput("maxPerPositionUsdc", t("grant.perPosition"), t("grant.perPositionHint"))}
          {numberInput("maxDailyUsdc", t("grant.perDay"))}
          {numberInput("maxWeeklyUsdc", t("grant.perWeek"))}
          {numberInput("maxOpenExposureUsdc", t("grant.openExposure"))}
          {numberInput("maxRealizedLossUsdc", t("grant.lossStop"))}
        </fieldset>

        <Disclosure summary={t("grant.filtersTitle")}>
          <div className="grid gap-4">
            <fieldset className="m-0 border-0 p-0" aria-describedby={`${fid("cats")}-hint`}>
              <legend className="label">{t("grant.categoriesLegend")}</legend>
              <div className="flex flex-wrap gap-2">
                {COPY_CATEGORIES.map((c) => {
                  const checked = values.allowedCategories.includes(c);
                  return (
                    <label
                      key={c}
                      className={`chip press focus-within:outline focus-within:outline-2 focus-within:outline-offset-[3px] focus-within:outline-coral ${
                        checked ? "!bg-cream text-ink" : "text-muted hover:text-cream"
                      }`}
                    >
                      <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleCategory(c)} />
                      {t(`categories.${c}`)}
                    </label>
                  );
                })}
              </div>
              <p id={`${fid("cats")}-hint`} className="m-0 mt-2 text-[12px] text-muted">
                {t("grant.categoriesHint")}
              </p>
            </fieldset>
            <div className="grid grid-cols-2 gap-4">
              {numberInput("minClaimQuality", t("grant.minQuality"), t("grant.minQualityHint"), "1")}
              {numberInput("minPayoutRatio", t("grant.minPayout"), t("grant.minPayoutHint"), "0.05")}
              <Field id={fid("expiresOn")} label={t("grant.expiresOn")} hint={t("grant.expiresHint")}>
                <input
                  id={fid("expiresOn")}
                  type="date"
                  required
                  min={dateInputValue(Date.now(), 0)}
                  max={dateInputValue(Date.now(), 89)}
                  className="input font-mono"
                  value={values.expiresOn}
                  aria-describedby={`${fid("expiresOn")}-hint`}
                  onChange={(e) => set("expiresOn", e.target.value)}
                />
              </Field>
            </div>
          </div>
        </Disclosure>

        <Disclosure summary={t("grant.previewTitle")}>
          <p className="m-0 mb-3 text-[12px] text-muted">{t("grant.previewHint")}</p>
          <pre
            data-lenis-prevent
            className="m-0 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-ink-deep p-4 font-mono text-[12px] leading-relaxed text-cream shadow-well"
          >
            {message}
          </pre>
        </Disclosure>

        {/* Not a live region: it changes on every keystroke. */}
        {!draftError ? (
          <p className="m-0 text-[13px] text-muted">{t("grant.worstCase", { amount: formatUsdc(worstCase) })}</p>
        ) : (
          <p id={fid("draft-error")} className="m-0 flex items-start gap-2 text-[13px] text-danger">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{t("grant.fixFirst", { error: draftError })}</span>
          </p>
        )}

        <div aria-live="polite" className="empty:hidden">
          {notice ? <p className="m-0 text-[14px] text-cream">{notice}</p> : null}
        </div>

        {submitError ? (
          <div role="alert" className="flex items-start gap-2.5 rounded-lg bg-danger/[0.1] px-4 py-3 text-[14px] text-danger">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{submitError}</span>
          </div>
        ) : null}

        <Button
          type="submit"
          size="sm"
          disabled={Boolean(draftError)}
          loading={busy}
          aria-describedby={draftError ? fid("draft-error") : undefined}
        >
          {busy ? t("grant.signing") : t("grant.sign")}
        </Button>
      </form>
    </div>
  );
}
