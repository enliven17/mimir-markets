"use client";

/**
 * Browser onboarding for an external agent, as four short steps in one sheet
 * (identity, authority, capabilities, limits), then the key.
 *
 * Two signatures and one key. The operator proves it controls itself, the owner
 * authorizes the record, and the API key is shown exactly once. Every value
 * that goes into a signature is on screen before the wallet prompt opens
 * (the last step recaps them), so a signer is never asked to approve text
 * they have not read. Signatures are wallet-adapter `signMessage` (ed25519),
 * sent base58.
 *
 * The connected wallet plays every role here for convenience. A production
 * agent should keep them apart: the owner cold, the operator hot.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { Check, Copy } from "lucide-react";

import { SURFACE_DEEP } from "@/components/arena/surface";
import { Button, Progress, Sheet } from "@/components/ui";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import { Link } from "@/i18n/navigation";
import {
  agentRequestMessage,
  operatorProofMessage,
  AGENT_ID_PATTERN,
  type AgentAction,
  type AgentEnvelope,
} from "@/lib/agents/api";
import {
  AGENT_CAPABILITIES,
  AUTHORITY_LEVELS,
  CAPABILITY_MIN_AUTHORITY,
  SELF_SERVICE_MAX_AUTHORITY,
  defaultLimits,
  type AgentCapability,
} from "@/lib/agents/registry";

const LEVELS = Object.values(AUTHORITY_LEVELS).sort((a, b) => a - b);
const STEPS = 4;

interface Registered {
  agentId: string;
  key: string;
  prefix: string;
  status: string;
}

function randomId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return `${Date.now().toString(36)}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function shortKey(k: string): string {
  return k.length <= 10 ? k : `${k.slice(0, 4)}…${k.slice(-4)}`;
}

const optionClass = (active: boolean, locked = false) =>
  `press flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
    locked
      ? "cursor-not-allowed bg-cream/[0.02] opacity-50"
      : active
        ? "bg-maroon/70 shadow-[inset_0_0_0_1px_rgb(255_81_72/.45)]"
        : "bg-cream/[0.035] hover:bg-cream/[0.06]"
  }`;

export default function AgentRegisterClient() {
  const t = useTranslations("agentConnect");
  const { publicKey, connected, signMessage } = useWallet();

  const [agentId, setAgentId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authorityLevel, setAuthorityLevel] = useState<number>(AUTHORITY_LEVELS.READ_ONLY);
  const [capabilities, setCapabilities] = useState<AgentCapability[]>([]);
  const [step, setStep] = useState(0);
  const [signing, setSigning] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Registered | null>(null);
  const [copied, setCopied] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const idValid = AGENT_ID_PATTERN.test(agentId);
  const limits = defaultLimits();
  const steps = t.raw("steps") as string[];

  // Capabilities above the selected authority are shown but not selectable:
  // seeing why something is locked is more useful than hiding it.
  const allowed = useMemo(
    () => AGENT_CAPABILITIES.filter((c) => CAPABILITY_MIN_AUTHORITY[c] <= authorityLevel),
    [authorityLevel],
  );
  const effectiveCapabilities = capabilities.filter((c) => allowed.includes(c));

  // Move focus to the step heading after Next/Back, never on first paint.
  useEffect(() => {
    if (moved.current) headingRef.current?.focus();
  }, [step, result]);

  function go(next: number) {
    if (next > step && step === 0 && !idValid) {
      setStepError(t("idInvalid"));
      return;
    }
    setStepError(null);
    moved.current = true;
    setStep(Math.max(0, Math.min(STEPS - 1, next)));
  }

  function toggleCapability(c: AgentCapability) {
    setCapabilities((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function sign(message: string): Promise<string> {
    if (!signMessage) throw new Error(t("noSignMessage"));
    return bs58.encode(await signMessage(new TextEncoder().encode(message)));
  }

  async function post(envelope: AgentEnvelope): Promise<Record<string, unknown>> {
    const res = await fetch(`/api/agents/v1/${envelope.action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
    });
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(payload.message ?? `HTTP ${res.status}`));
    return payload;
  }

  function envelope(action: AgentAction, body: Record<string, unknown>): AgentEnvelope {
    return {
      version: "v1",
      agentId,
      action,
      idempotencyKey: randomId(),
      nonce: randomId(),
      signedAt: Date.now(),
      body,
    };
  }

  async function register() {
    if (!publicKey || !idValid) return;
    setError(null);
    setSigning(true);
    try {
      const wallet = publicKey.toBase58();

      // 1. Operator proof: this wallet controls itself.
      const operatorSignature = await sign(operatorProofMessage(agentId, wallet));

      // 2. Owner envelope: this wallet authorizes the record.
      const reg = envelope("register", {
        ownerWallet: wallet,
        operatorWallet: wallet,
        payoutWallet: wallet,
        displayName: displayName.trim() || agentId,
        authorityLevel,
        capabilities: effectiveCapabilities,
        operatorSignature,
      });
      reg.signature = await sign(agentRequestMessage(reg));
      const created = await post(reg);
      const status = String((created.agent as { status?: string } | undefined)?.status ?? "active");

      // 3. One owner-signed call for the key it will actually use.
      const issue = envelope("issueKey", { label: "browser" });
      issue.signature = await sign(agentRequestMessage(issue));
      const keyPayload = await post(issue);

      moved.current = true;
      setResult({ agentId, key: String(keyPayload.key ?? ""), prefix: String(keyPayload.prefix ?? ""), status });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setSigning(false);
    }
  }

  const back = (
    <Link
      href="/agents"
      className="press inline-flex min-h-[34px] items-center gap-1.5 self-start rounded-full pr-2 text-[14px] text-muted transition-colors hover:text-cream"
    >
      <span aria-hidden>←</span>
      {t("pageTitle")}
    </Link>
  );

  if (result) {
    return (
      <div className="mx-auto grid w-full max-w-[640px] grid-cols-[minmax(0,1fr)] gap-5">
        {back}
        <IssuedKey
          result={result}
          copied={copied}
          headingRef={headingRef}
          onCopy={() => {
            void navigator.clipboard.writeText(result.key).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        />
      </div>
    );
  }

  const body =
    step === 0 ? (
      <div className="grid gap-4">
        <div>
          <label htmlFor="agent-id" className="label">
            {t("agentId")}
          </label>
          <input
            id="agent-id"
            className="input font-mono"
            placeholder="my-agent"
            value={agentId}
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            aria-invalid={agentId !== "" && !idValid}
            onChange={(e) => setAgentId(e.target.value.toLowerCase().trim())}
          />
          <p className={`m-0 mt-1.5 text-[13px] ${agentId && !idValid ? "text-danger" : "text-muted"}`}>{t("agentIdHint")}</p>
        </div>
        <div>
          <label htmlFor="display-name" className="label">
            {t("displayName")}
          </label>
          <input
            id="display-name"
            className="input"
            placeholder="My Agent"
            value={displayName}
            maxLength={120}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <p className="m-0 mt-1.5 text-[13px] text-muted">{t("displayNameHint")}</p>
        </div>
      </div>
    ) : step === 1 ? (
      <div className="grid gap-3">
        <p className="m-0 text-[14px] text-muted">{t("authorityHint")}</p>
        <div className="grid gap-2" role="radiogroup" aria-label={t("authority")}>
          {LEVELS.map((level) => {
            const active = authorityLevel === level;
            return (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setAuthorityLevel(level)}
                className={optionClass(active)}
              >
                <span className={`mt-0.5 font-mono text-[12px] ${active ? "text-coral" : "text-dim"}`}>L{level}</span>
                <span className="min-w-0">
                  <span className="block text-[15px] text-cream">
                    {t(`levels.${level}.name` as never)}
                    {level > SELF_SERVICE_MAX_AUTHORITY ? (
                      <span className="ml-2 text-[12px] text-pending">{t("levelPending")}</span>
                    ) : null}
                  </span>
                  <span className="block text-[13px] text-muted">{t(`levels.${level}.blurb` as never)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    ) : step === 2 ? (
      <div className="grid gap-2 sm:grid-cols-2">
        {AGENT_CAPABILITIES.map((c) => {
          const locked = !allowed.includes(c);
          const active = effectiveCapabilities.includes(c);
          return (
            <button
              key={c}
              type="button"
              disabled={locked}
              aria-pressed={active}
              onClick={() => toggleCapability(c)}
              className={optionClass(active, locked)}
            >
              <span
                className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[5px] ${
                  active ? "bg-coral text-[#160909]" : "shadow-[inset_0_0_0_1px_rgb(243_234_214/.3)]"
                }`}
              >
                {active ? <Check className="h-3 w-3" aria-hidden /> : null}
              </span>
              <span className="min-w-0">
                <span className="block font-mono text-[13px] text-cream">{c}</span>
                <span className="block text-[13px] text-muted">
                  {locked ? t("needsLevel", { level: CAPABILITY_MIN_AUTHORITY[c] }) : t(`capability.${c}`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    ) : (
      <div className="grid gap-4">
        <p className="m-0 text-[14px] text-muted">{t("limitsHint")}</p>
        <dl className="kv">
          <dt>{t("limitRequests")}</dt>
          <dd>{limits.requestsPerHour}</dd>
          <dt>{t("limitMarkets")}</dt>
          <dd>{limits.maxActiveMarkets}</dd>
          <dt>{t("limitDaily")}</dt>
          <dd>{limits.maxDailyUsdc}</dd>
          <dt>{t("limitPosition")}</dt>
          <dd>{limits.maxPositionUsdc}</dd>
        </dl>
        <dl className="kv">
          <dt>{t("agentId")}</dt>
          <dd className="text-cream">{agentId}</dd>
          <dt>{t("displayName")}</dt>
          <dd>{displayName.trim() || agentId}</dd>
          <dt>{t("authority")}</dt>
          <dd>
            L{authorityLevel} {t(`levels.${authorityLevel}.name` as never)}
          </dd>
          <dt>{t("capabilities")}</dt>
          <dd>{effectiveCapabilities.length ? effectiveCapabilities.join(", ") : "—"}</dd>
        </dl>
        {connected && publicKey ? (
          <div className="grid gap-1 rounded-xl bg-cream/[0.035] px-4 py-3">
            <p className="m-0 font-mono text-[13px] text-cream">{t("wallets", { address: shortKey(publicKey.toBase58()) })}</p>
            <p className="m-0 text-[13px] text-muted">{t("walletsHint")}</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-cream/[0.035] px-4 py-3">
            <p className="m-0 text-[14px] text-muted">{t("connectFirst")}</p>
            <ConnectWalletButton />
          </div>
        )}
      </div>
    );

  const last = step === STEPS - 1;

  return (
    <div className="mx-auto grid w-full max-w-[640px] grid-cols-[minmax(0,1fr)] gap-5">
      {back}
      <Sheet className={`!px-5 !py-7 sm:!px-9 sm:!py-9 ${SURFACE_DEEP}`}>
        <div className="grid gap-5">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="m-0 font-display text-app-h1 text-cream">{t("title")}</h1>
            <span className="shrink-0 font-mono text-[12px] text-muted">{t("stepOf", { n: step + 1, total: STEPS })}</span>
          </div>
          {step === 0 ? <p className="m-0 -mt-2 text-[14px] leading-relaxed text-muted">{t("lead")}</p> : null}
          <Progress steps={steps} current={step} label={t("stepsLabel")} />
        </div>

        <form
          className="mt-7 grid gap-6"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!last) go(step + 1);
            else void register();
          }}
        >
          <h2 ref={headingRef} tabIndex={-1} className="m-0 text-[1.35rem] leading-none text-cream outline-none">
            {steps[step]}
          </h2>
          <div key={step} className="fade-rise">
            {body}
          </div>

          {stepError || error ? (
            <p role="alert" className="m-0 break-words rounded-xl bg-danger/[0.1] px-4 py-3 text-[14px] text-danger">
              {stepError ?? error}
            </p>
          ) : null}

          <div className="flex items-center gap-3 border-t border-line pt-5">
            {step > 0 ? (
              <Button type="button" variant="ghost" size="sm" fullWidth={false} onClick={() => go(step - 1)} disabled={signing}>
                {t("back")}
              </Button>
            ) : null}
            {last ? (
              <Button type="submit" size="sm" fullWidth={false} className="ml-auto" loading={signing} disabled={!connected || !idValid || signing}>
                {signing ? t("signing") : t("submit")}
              </Button>
            ) : (
              <Button type="submit" variant="light" size="sm" fullWidth={false} className="ml-auto !min-w-[8rem]">
                {t("next")}
              </Button>
            )}
          </div>
        </form>
      </Sheet>
    </div>
  );
}

function IssuedKey({
  result,
  copied,
  onCopy,
  headingRef,
}: {
  result: Registered;
  copied: boolean;
  onCopy: () => void;
  headingRef: React.RefObject<HTMLHeadingElement>;
}) {
  const t = useTranslations("agentConnect");
  return (
    <Sheet className={`!px-5 !py-7 sm:!px-9 sm:!py-9 ${SURFACE_DEEP}`}>
      <div className="grid gap-6">
        <div className="grid gap-2">
          <p className="m-0 flex items-center gap-2 text-[14px] text-win">
            <Check size={16} aria-hidden />
            {t(result.status === "pending" ? "pending" : "registered", { agentId: result.agentId })}
          </p>
          <h1 ref={headingRef} tabIndex={-1} className="m-0 font-display text-app-h1 text-cream outline-none">
            {t("keyTitle")}
          </h1>
          <p className="m-0 text-[14px] leading-relaxed text-muted">{t("keyHint")}</p>
        </div>
        <div className="flex items-stretch gap-2">
          <code className="min-w-0 flex-1 break-all rounded-xl bg-ink-deep px-4 py-3 font-mono text-[13px] text-cream">{result.key}</code>
          <button
            type="button"
            onClick={onCopy}
            aria-label={t("copyKey")}
            className="press grid w-12 shrink-0 place-items-center rounded-xl bg-panel-raised text-muted transition-colors hover:text-cream"
          >
            {copied ? <Check className="h-4 w-4 text-win" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          </button>
        </div>
        <div className="grid gap-3 border-t border-line pt-5">
          <h2 className="m-0 text-[1.2rem] leading-none text-cream">{t("firstCall")}</h2>
          <pre
            data-lenis-prevent
            className="m-0 overflow-x-auto rounded-xl bg-ink-deep p-4 font-mono text-[12px] leading-relaxed text-cream"
          >
{`curl -X POST "$MIMIR_URL/api/agents/v1/heartbeat" \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer ${result.prefix}…" \\
  -d '{"version":"v1","agentId":"${result.agentId}","action":"heartbeat","body":{"status":"ok"}}'`}
          </pre>
          <p className="m-0 text-[13px] text-muted">{t("firstCallHint")}</p>
          <Link href="/docs" className="text-[14px] text-coral hover:underline">
            {t("docsLink")} →
          </Link>
        </div>
      </div>
    </Sheet>
  );
}
