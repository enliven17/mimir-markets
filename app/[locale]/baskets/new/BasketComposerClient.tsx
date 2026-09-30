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

import { Link, useRouter } from "@/i18n/navigation";
import { SURFACE } from "@/components/arena/surface";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Input, { Textarea } from "@/components/ui/Input";
import { Meter } from "@/components/ui/Progress";
import Skeleton from "@/components/ui/Skeleton";
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
    <div className="mx-auto grid w-full max-w-[var(--wrap-narrow)] grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <header className="grid gap-3">
        <Link href="/baskets" className="justify-self-start text-[14px] text-muted transition-colors hover:text-cream">
          ← {t("back")}
        </Link>
        <h1 className="m-0 font-display text-app-h1 text-cream">{t("composeTitle")}</h1>
        <p className="m-0 max-w-[60ch] text-[15px] leading-relaxed text-muted">{t("composeLead")}</p>
      </header>

      <section aria-labelledby="compose-identity" className={`${SURFACE} grid gap-4 p-5 sm:p-6`}>
        <h2 id="compose-identity" className="m-0 font-display text-[1.45rem] leading-none text-cream">
          {t("identity")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Input
              id="basket-id"
              label={t("basketId")}
              className="font-mono"
              placeholder="contrarian-mix"
              value={id}
              maxLength={64}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="basket-id-hint"
              aria-invalid={id !== "" && !idValid}
              onChange={(e) => setId(e.target.value.toLowerCase().trim())}
            />
            <p id="basket-id-hint" className={`m-0 mt-2 text-[13px] ${id && !idValid ? "text-danger" : "text-muted"}`}>
              {t("basketIdHint")}
            </p>
          </div>
          <Input
            id="basket-name"
            label={t("name")}
            placeholder="Contrarian mix"
            value={name}
            maxLength={MAX_BASKET_NAME}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Textarea
          id="basket-thesis"
          label={t("thesis")}
          className="!min-h-[88px]"
          placeholder={t("thesisPlaceholder")}
          value={thesis}
          maxLength={MAX_BASKET_THESIS}
          onChange={(e) => setThesis(e.target.value)}
        />
      </section>

      <section aria-labelledby="compose-members" className={`${SURFACE} grid gap-4 p-5 sm:p-6`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="compose-members" className="m-0 font-display text-[1.45rem] leading-none text-cream">
            {t("members")}
          </h2>
          <span aria-live="polite" className={`font-mono text-[13px] ${remaining === 0 ? "text-cream" : "text-muted"}`}>
            {remaining === 0
              ? t("allocated")
              : remaining > 0
                ? t("left", { pct: (remaining / 100).toFixed(2) })
                : t("over", { pct: (-remaining / 100).toFixed(2) })}
          </span>
        </div>
        <Meter value={totalBps / WEIGHT_TOTAL_BPS} />

        {members.length === 0 ? (
          <p className="m-0 rounded-lg bg-cream/[0.03] px-4 py-6 text-center text-[14px] text-muted">
            {t("addAtLeast", { count: DEFAULT_BASKET_POLICY.minMembers })}
          </p>
        ) : (
          <ul className="m-0 list-none divide-y divide-line p-0">
            {members.map((m) => {
              const c = byId.get(m.agentId);
              const over = m.weightBps > DEFAULT_BASKET_POLICY.maxSingleAgentBps;
              return (
                <li key={m.agentId} className="flex items-center gap-3 py-3">
                  <PeepAvatar seed={seedOf(c, m.agentId)} size={30} shape="square" alt="" />
                  <span className="min-w-0 flex-1 truncate text-[15px] text-cream">
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
                    aria-invalid={over || undefined}
                    onChange={(e) => setWeight(m.agentId, Number(e.target.value))}
                    className={`input !w-24 !px-4 !py-2.5 text-right font-mono tabular-nums ${
                      over ? "!shadow-[inset_0_0_0_1px_rgb(255_147_140/.7)]" : ""
                    }`}
                  />
                  <span className="font-mono text-[13px] text-muted">%</span>
                  <button
                    type="button"
                    onClick={() => removeMember(m.agentId)}
                    aria-label={t("remove", { id: m.agentId })}
                    className="focus-ring press grid size-9 flex-none place-items-center rounded-full bg-panel-raised text-muted transition-colors hover:text-danger"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {overCap ? (
          <p className="m-0 flex items-center gap-2 text-[13px] text-danger">
            <Scale className="size-3.5 shrink-0" aria-hidden />
            {t("overCap", { pct: DEFAULT_BASKET_POLICY.maxSingleAgentBps / 100 })}
          </p>
        ) : null}

        <div className="grid gap-2">
          <p className="label !mb-0">{t("addAgent")}</p>
          {candidates === null ? (
            <Skeleton className="!h-8 w-2/3 !rounded-full" />
          ) : candidates.length === 0 ? (
            <p className="m-0 text-[13px] text-muted">{t("noCandidates")}</p>
          ) : members.length < DEFAULT_BASKET_POLICY.maxMembers ? (
            <div className="flex flex-wrap gap-2">
              {available.map((c) => (
                <Chip key={c.agentId} onClick={() => addMember(c.agentId)}>
                  <Plus className="size-3.5" aria-hidden />
                  {c.emoji ? `${c.emoji} ` : ""}
                  {c.label}
                  <span className="text-[11px] text-dim">{t(c.kind)}</span>
                </Chip>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {error ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-lg bg-danger/[0.1] px-4 py-3 text-[14px] text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      ) : null}

      <div className="grid justify-items-center gap-3">
        {!connected ? (
          <>
            <p className="m-0 text-center text-[13px] text-muted">{t("connectPublish")}</p>
            <ConnectWalletButton />
          </>
        ) : (
          <Button size="sm" fullWidth={false} loading={busy} disabled={!ready} onClick={() => void publish()}>
            {busy ? t("waiting") : t("publish")}
            {!busy ? <Check className="size-4" aria-hidden /> : null}
          </Button>
        )}
      </div>
    </div>
  );
}
