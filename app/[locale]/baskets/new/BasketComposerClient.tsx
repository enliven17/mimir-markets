"use client";

/**
 * The basket composer.
 *
 * Weights must total exactly 10,000 bps, so the form shows the running total
 * and what is left rather than letting someone submit into a rejection. The
 * same rules run server-side; this is a courtesy, not the enforcement.
 * Publishing is one ed25519 `signMessage` over `composeMessage` (with signedAt).
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import bs58 from "bs58";
import { Check, Plus, Scale, TriangleAlert, X } from "lucide-react";

import { useRouter } from "@/i18n/navigation";
import { BlueprintHeading } from "@/components/BlueprintGrid";
import PeepAvatar from "@/components/ui/PeepAvatar";
import {
  composeMessage,
  DEFAULT_BASKET_POLICY,
  isValidBasketId,
  MAX_BASKET_NAME,
  MAX_BASKET_THESIS,
  WEIGHT_TOTAL_BPS,
  type BasketMember,
} from "@/lib/baskets";

interface Candidate {
  agentId: string;
  label: string;
  emoji: string;
  kind: "persona" | "agent";
  wallet: string;
}

function seedOf(c: Candidate | undefined, agentId: string): string {
  return c?.kind === "agent" ? `challenger-${c.wallet}` : `council-${agentId}`;
}

export default function BasketComposerClient() {
  const t = useTranslations("baskets");
  const router = useRouter();
  const { publicKey, connected, signMessage } = useWallet();

  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [thesis, setThesis] = useState("");
  const [members, setMembers] = useState<BasketMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/baskets/candidates")
      .then((r) => (r.ok ? r.json() : { candidates: [] }))
      .then((d: { candidates?: Candidate[] }) => {
        if (!cancelled) setCandidates(d.candidates ?? []);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totalBps = useMemo(() => members.reduce((a, m) => a + m.weightBps, 0), [members]);
  const remaining = WEIGHT_TOTAL_BPS - totalBps;
  const overCap = members.some((m) => m.weightBps > DEFAULT_BASKET_POLICY.maxSingleAgentBps);
  const idValid = isValidBasketId(id);

  const ready =
    connected &&
    idValid &&
    name.trim().length > 0 &&
    thesis.trim().length > 0 &&
    members.length >= DEFAULT_BASKET_POLICY.minMembers &&
    remaining === 0 &&
    !overCap;

  function addMember(agentId: string) {
    if (members.some((m) => m.agentId === agentId)) return;
    if (members.length >= DEFAULT_BASKET_POLICY.maxMembers) return;
    // Split evenly on add; the remainder goes to the first leg so the total
    // always lands on 10,000.
    const next = [...members, { agentId, weightBps: 0 }];
    const even = Math.floor(WEIGHT_TOTAL_BPS / next.length);
    setMembers(
      next.map((m, i) => ({ ...m, weightBps: i === 0 ? WEIGHT_TOTAL_BPS - even * (next.length - 1) : even })),
    );
  }

  function removeMember(agentId: string) {
    setMembers((prev) => prev.filter((m) => m.agentId !== agentId));
  }

  function setWeight(agentId: string, percent: number) {
    setMembers((prev) =>
      prev.map((m) => (m.agentId === agentId ? { ...m, weightBps: Math.round(percent * 100) } : m)),
    );
  }

  async function publish() {
    if (!publicKey) return;
    setError(null);
    setBusy(true);
    try {
      if (!signMessage) throw new Error(t("noSignMessage"));
      const creatorWallet = publicKey.toBase58();
      const signedAt = Date.now();
      const clean = { id, name: name.trim(), thesis: thesis.trim() };
      const message = composeMessage({ ...clean, creator: creatorWallet, members, signedAt });
      const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
      const res = await fetch("/api/baskets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...clean, creatorWallet, members, signature, signedAt }),
      });
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(payload.message ?? t("failed")));
      router.push(`/baskets/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
      setBusy(false);
    }
  }

  const byId = new Map((candidates ?? []).map((c) => [c.agentId, c]));
  const available = (candidates ?? []).filter((c) => !members.some((m) => m.agentId === c.agentId));

  return (
    <div className="pb-16">
      <BlueprintHeading as="h1" eyebrow={t("eyebrow")} subtitle={t("composeLead")}>
        {t("composeTitle")}
      </BlueprintHeading>

      <div className="mx-auto max-w-[820px] space-y-6 px-4 pt-8 sm:px-6 lg:px-8">
        <section className="card p-5">
          <h2 className="bp-label mb-3">{t("identity")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="basket-id" className="label">
                {t("basketId")}
              </label>
              <input
                id="basket-id"
                className="form-field-pv font-mono"
                placeholder="contrarian-mix"
                value={id}
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setId(e.target.value.toLowerCase().trim())}
              />
              <p className={`mt-1.5 text-[11px] ${id && !idValid ? "text-pv-danger" : "text-pv-muted"}`}>
                {t("basketIdHint")}
              </p>
            </div>
            <div>
              <label htmlFor="basket-name" className="label">
                {t("name")}
              </label>
              <input
                id="basket-name"
                className="form-field-pv"
                placeholder="Contrarian mix"
                value={name}
                maxLength={MAX_BASKET_NAME}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
          <div className="mt-4">
            <label htmlFor="basket-thesis" className="label">
              {t("thesis")}
            </label>
            <textarea
              id="basket-thesis"
              className="form-field-pv min-h-[88px] resize-y"
              placeholder={t("thesisPlaceholder")}
              value={thesis}
              maxLength={MAX_BASKET_THESIS}
              onChange={(e) => setThesis(e.target.value)}
            />
          </div>
        </section>

        <section className="card p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="bp-label">{t("members")}</h2>
            <span
              className={`font-mono text-[11px] uppercase tracking-[0.16em] ${
                remaining === 0 ? "text-pv-emerald" : "text-pv-muted"
              }`}
            >
              {remaining === 0
                ? t("allocated")
                : remaining > 0
                  ? t("left", { pct: (remaining / 100).toFixed(2) })
                  : t("over", { pct: (-remaining / 100).toFixed(2) })}
            </span>
          </div>

          {members.length === 0 ? (
            <p className="border border-dashed border-pv-border/40 px-4 py-6 text-center text-[12px] text-pv-muted">
              {t("addAtLeast", { count: DEFAULT_BASKET_POLICY.minMembers })}
            </p>
          ) : (
            <ul className="divide-y divide-pv-border/25 border border-pv-border/25">
              {members.map((m) => {
                const c = byId.get(m.agentId);
                const over = m.weightBps > DEFAULT_BASKET_POLICY.maxSingleAgentBps;
                return (
                  <li key={m.agentId} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                    <PeepAvatar seed={seedOf(c, m.agentId)} size={28} shape="square" alt="" />
                    <span className="min-w-0 flex-1 truncate text-sm text-pv-text">
                      {c ? `${c.emoji ? `${c.emoji} ` : ""}${c.label}` : m.agentId}
                    </span>
                    <label className="sr-only" htmlFor={`w-${m.agentId}`}>
                      {t("weight", { id: m.agentId })}
                    </label>
                    <input
                      id={`w-${m.agentId}`}
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={m.weightBps / 100}
                      onChange={(e) => setWeight(m.agentId, Number(e.target.value))}
                      className={`form-field-pv w-20 text-right font-mono tabular-nums ${
                        over ? "border-pv-danger/60" : ""
                      }`}
                    />
                    <span className="font-mono text-[11px] text-pv-muted">%</span>
                    <button
                      type="button"
                      onClick={() => removeMember(m.agentId)}
                      aria-label={t("remove", { id: m.agentId })}
                      className="focus-ring border border-pv-border/25 p-1.5 text-pv-muted transition-colors hover:border-pv-danger/50 hover:text-pv-danger"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {overCap && (
            <p className="mt-3 flex items-center gap-2 text-[12px] text-pv-danger">
              <Scale className="h-3.5 w-3.5 shrink-0" />
              {t("overCap", { pct: DEFAULT_BASKET_POLICY.maxSingleAgentBps / 100 })}
            </p>
          )}

          <div className="mt-4">
            <p className="label">{t("addAgent")}</p>
            {candidates !== null && candidates.length === 0 ? (
              <p className="text-[12px] text-pv-muted">{t("noCandidates")}</p>
            ) : (
              members.length < DEFAULT_BASKET_POLICY.maxMembers && (
                <div className="flex flex-wrap gap-1.5">
                  {available.map((c) => (
                    <button
                      key={c.agentId}
                      type="button"
                      onClick={() => addMember(c.agentId)}
                      className="focus-ring inline-flex items-center gap-1.5 border border-pv-border/25 bg-pv-bg px-2.5 py-1 text-[12px] text-pv-text/85 transition-colors hover:border-pv-emerald/50 hover:text-pv-text"
                    >
                      <Plus className="h-3 w-3 text-pv-muted" />
                      {c.emoji ? `${c.emoji} ` : ""}
                      {c.label}
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-pv-muted">{t(c.kind)}</span>
                    </button>
                  ))}
                </div>
              )
            )}
          </div>
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

        {!connected && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-center text-[12px] text-pv-muted">{t("connectPublish")}</p>
            <ConnectWalletButton />
          </div>
        )}
        <button
          type="button"
          className="btn-primary flex w-full items-center justify-center gap-2"
          disabled={!ready || busy}
          onClick={() => void publish()}
        >
          {busy ? t("waiting") : t("publish")}
          {!busy && <Check className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
