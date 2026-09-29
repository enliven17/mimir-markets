"use client";

/**
 * Browser onboarding for an external agent.
 *
 * Two signatures and one key. The operator proves it controls itself, the owner
 * authorizes the record, and the API key is shown exactly once. Every value
 * that goes into a signature is rendered before the wallet prompt opens, so a
 * signer is never asked to approve text they have not read. Signatures are
 * wallet-adapter `signMessage` (ed25519), sent base58.
 *
 * The connected wallet plays every role here for convenience. A production
 * agent should keep them apart: the owner cold, the operator hot.
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import bs58 from "bs58";
import { ArrowRight, Check, Copy, KeyRound, ShieldCheck, TriangleAlert } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { BlueprintHeading } from "@/components/BlueprintGrid";
import PeepAvatar from "@/components/ui/PeepAvatar";
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

const AUTHORITY_COPY: Array<{ level: number; name: string; blurb: string }> = [
  { level: AUTHORITY_LEVELS.READ_ONLY, name: "Read only", blurb: "Read claims, balances and positions. Withdraw its own funds." },
  { level: AUTHORITY_LEVELS.PROPOSE, name: "Propose", blurb: "Reserved for reviewed claim proposals." },
  { level: AUTHORITY_LEVELS.CREATE, name: "Create", blurb: "Open claims from its own wallet, within limits." },
  { level: AUTHORITY_LEVELS.STAKE, name: "Stake", blurb: "Deposit, challenge in the Ephemeral Rollup and dispute verdicts." },
  { level: AUTHORITY_LEVELS.MONETISE, name: "Monetise", blurb: "Positions credit the payout wallet with the on-chain agent fee." },
];

const CAPABILITY_COPY: Record<AgentCapability, string> = {
  researcher: "Read claims and context",
  market_creator: "Open claims",
  council_juror: "Challenge and dispute",
  fee_earner: "Earn the agent-owner fee",
};

type Step = "form" | "signing" | "done";

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

export default function AgentRegisterClient() {
  const t = useTranslations("agentConnect");
  const { publicKey, connected, signMessage } = useWallet();

  const [agentId, setAgentId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authorityLevel, setAuthorityLevel] = useState<number>(AUTHORITY_LEVELS.READ_ONLY);
  const [capabilities, setCapabilities] = useState<AgentCapability[]>([]);
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Registered | null>(null);
  const [copied, setCopied] = useState(false);

  const idValid = AGENT_ID_PATTERN.test(agentId);
  const limits = defaultLimits();

  // Capabilities above the selected authority are shown but not selectable:
  // seeing why something is locked is more useful than hiding it.
  const allowed = useMemo(
    () => AGENT_CAPABILITIES.filter((c) => CAPABILITY_MIN_AUTHORITY[c] <= authorityLevel),
    [authorityLevel],
  );
  const effectiveCapabilities = capabilities.filter((c) => allowed.includes(c));

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
    if (!publicKey) return;
    setError(null);
    setStep("signing");
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

      setResult({ agentId, key: String(keyPayload.key ?? ""), prefix: String(keyPayload.prefix ?? ""), status });
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
      setStep("form");
    }
  }

  return (
    <div className="pb-16">
      <BlueprintHeading as="h1" eyebrow={t("eyebrow")} subtitle={t("lead")}>
        {t("title")}
      </BlueprintHeading>

      <div className="mx-auto max-w-[760px] px-4 pt-6 sm:px-6 lg:px-8">
        {step === "done" && result ? (
          <IssuedKey
            result={result}
            copied={copied}
            onCopy={() => {
              void navigator.clipboard.writeText(result.key).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          />
        ) : (
          <div className="space-y-6">
            <section className="card p-5">
              <h2 className="bp-label mb-3">{t("identity")}</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="agent-id" className="label">{t("agentId")}</label>
                  <input
                    id="agent-id"
                    className="form-field-pv font-mono"
                    placeholder="my-agent"
                    value={agentId}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={64}
                    onChange={(e) => setAgentId(e.target.value.toLowerCase().trim())}
                  />
                  <p className={`mt-1.5 text-[11px] ${agentId && !idValid ? "text-pv-danger" : "text-pv-muted"}`}>
                    {t("agentIdHint")}
                  </p>
                </div>
                <div>
                  <label htmlFor="display-name" className="label">{t("displayName")}</label>
                  <input
                    id="display-name"
                    className="form-field-pv"
                    placeholder="My Agent"
                    value={displayName}
                    maxLength={120}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                  <p className="mt-1.5 text-[11px] text-pv-muted">{t("displayNameHint")}</p>
                </div>
              </div>
            </section>

            <section className="card p-5">
              <h2 className="bp-label mb-1">{t("authority")}</h2>
              <p className="mb-3 text-[12px] text-pv-muted">{t("authorityHint")}</p>
              <div className="space-y-2" role="radiogroup" aria-label={t("authority")}>
                {AUTHORITY_COPY.map((a) => {
                  const active = authorityLevel === a.level;
                  return (
                    <button
                      key={a.level}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setAuthorityLevel(a.level)}
                      className={`focus-ring flex w-full items-start gap-3 border px-4 py-3 text-left transition-colors ${
                        active
                          ? "border-pv-emerald bg-pv-emerald/[0.08]"
                          : "border-pv-border/25 hover:border-pv-emerald/40"
                      }`}
                    >
                      <span className={`mt-0.5 font-mono text-[11px] ${active ? "text-pv-emerald" : "text-pv-muted"}`}>
                        L{a.level}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-display text-sm font-bold text-pv-text">
                          {a.name}
                          {a.level > SELF_SERVICE_MAX_AUTHORITY && (
                            <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-pv-muted">
                              pending
                            </span>
                          )}
                        </span>
                        <span className="block text-[12px] text-pv-muted">{a.blurb}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="card p-5">
              <h2 className="bp-label mb-3">{t("capabilities")}</h2>
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
                      className={`focus-ring flex items-center gap-2.5 border px-3.5 py-3 text-left transition-colors ${
                        locked
                          ? "cursor-not-allowed border-pv-border/25 opacity-50"
                          : active
                            ? "border-pv-emerald bg-pv-emerald/[0.08]"
                            : "border-pv-border/25 hover:border-pv-emerald/40"
                      }`}
                    >
                      <span
                        className={`grid h-4 w-4 shrink-0 place-items-center border ${
                          active ? "border-pv-emerald bg-pv-emerald text-pv-bg" : "border-pv-border/40"
                        }`}
                      >
                        {active && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-mono text-[11px] text-pv-text">{c}</span>
                        <span className="block text-[11px] text-pv-muted">
                          {locked ? t("needsLevel", { level: CAPABILITY_MIN_AUTHORITY[c] }) : CAPABILITY_COPY[c]}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="card p-5">
              <h2 className="bp-label mb-1">{t("limits")}</h2>
              <p className="mb-3 text-[12px] text-pv-muted">{t("limitsHint")}</p>
              <dl className="bp-cells grid-cols-2 border border-pv-border/25 sm:grid-cols-4">
                {[
                  [t("limitRequests"), limits.requestsPerHour],
                  [t("limitMarkets"), limits.maxActiveMarkets],
                  [t("limitDaily"), limits.maxDailyUsdc],
                  [t("limitPosition"), limits.maxPositionUsdc],
                ].map(([label, value]) => (
                  <div key={String(label)} className="p-3 text-center">
                    <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-pv-muted">{label}</dt>
                    <dd className="mt-0.5 font-display text-lg font-bold tabular-nums text-pv-text">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 border border-pv-danger/40 bg-pv-danger/[0.06] px-4 py-3 text-sm text-pv-danger"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 break-words">{error}</span>
              </div>
            )}

            <div className="space-y-3">
              {connected && publicKey ? (
                <div className="flex items-start gap-3 border border-pv-border/25 p-3">
                  <PeepAvatar seed={`creator-${publicKey.toBase58()}`} size={36} shape="square" alt="" />
                  <div className="min-w-0">
                    <p className="font-mono text-[11px] text-pv-text">
                      {t("wallets", { address: shortKey(publicKey.toBase58()) })}
                    </p>
                    <p className="mt-0.5 text-[11px] text-pv-muted">{t("walletsHint")}</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <p className="text-center text-[12px] text-pv-muted">{t("connectFirst")}</p>
                  <ConnectWalletButton />
                </div>
              )}
              <button
                type="button"
                className="btn-primary flex w-full items-center justify-center gap-2"
                disabled={!connected || !idValid || step === "signing"}
                onClick={() => void register()}
              >
                {step === "signing" ? t("signing") : t("submit")}
                {step !== "signing" && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IssuedKey({ result, copied, onCopy }: { result: Registered; copied: boolean; onCopy: () => void }) {
  const t = useTranslations("agentConnect");
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2.5 border border-pv-emerald/40 bg-pv-emerald/[0.06] px-4 py-3 text-sm text-pv-emerald">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        <span>{t(result.status === "pending" ? "pending" : "registered", { agentId: result.agentId })}</span>
      </div>

      <section className="card p-5">
        <h2 className="bp-label mb-1 flex items-center gap-2">
          <KeyRound className="h-3.5 w-3.5" /> {t("keyTitle")}
        </h2>
        <p className="mb-3 text-[12px] text-pv-muted">{t("keyHint")}</p>
        <div className="flex items-stretch gap-2">
          <code className="min-w-0 flex-1 break-all border border-pv-border/25 bg-pv-surface2 px-3.5 py-3 font-mono text-[12px] text-pv-text">
            {result.key}
          </code>
          <button
            type="button"
            onClick={onCopy}
            aria-label={t("copyKey")}
            className="focus-ring shrink-0 border border-pv-border/25 px-3 text-pv-muted transition-colors hover:border-pv-emerald/50 hover:text-pv-text"
          >
            {copied ? <Check className="h-4 w-4 text-pv-emerald" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="bp-label mb-3">{t("firstCall")}</h2>
        <pre className="overflow-x-auto border border-pv-border/25 bg-pv-surface2 p-4 font-mono text-[11px] leading-relaxed text-pv-text">
{`curl -X POST "$MIMIR_URL/api/agents/v1/heartbeat" \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer ${result.prefix}…" \\
  -d '{"version":"v1","agentId":"${result.agentId}","action":"heartbeat","body":{"status":"ok"}}'`}
        </pre>
        <p className="mt-3 text-[12px] text-pv-muted">{t("firstCallHint")}</p>
        <Link href="/docs" className="mt-3 inline-block font-mono text-[11px] uppercase tracking-[0.16em] text-pv-emerald hover:underline">
          {t("docsLink")} →
        </Link>
      </section>
    </div>
  );
}
