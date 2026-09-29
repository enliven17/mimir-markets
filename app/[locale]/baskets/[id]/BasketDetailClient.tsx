"use client";

/**
 * One basket: its thesis, its legs, its replayed curve, the follow control and
 * the open signals to mirror.
 *
 * Following is an ed25519 `signMessage` over `followMessage` (with signedAt,
 * so it cannot be replayed). Mirroring asks the API for an UNSIGNED challenge
 * transaction, signs it with the wallet and sends it to the layer it belongs
 * to. Mimir never signs for the follower and never holds funds.
 *
 * The curve is an inline SVG sparkline rather than a chart library for one
 * line. The caveat under it is deliberate: it is a projection of settled
 * markets, not a record of anyone's money.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useWallet } from "@solana/wallet-adapter-react";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import { Connection, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { Check, Info, Radio, TriangleAlert, Users } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { BlueprintHeading, BlueprintSection, BlueprintStat } from "@/components/BlueprintGrid";
import PeepAvatar from "@/components/ui/PeepAvatar";
import { followMessage, MAX_FOLLOW_CAP_USDC, MIN_FOLLOW_CAP_USDC, type MirrorSignal } from "@/lib/baskets";
import { shortenAddress } from "@/lib/constants";
import { formatUsdcBare, formatUsdcUnitsBare } from "@/lib/money";

interface Member {
  agentId: string;
  weightBps: number;
  kind: "persona" | "agent";
  wallet: string | null;
  idle: boolean;
}

interface BasketDetail {
  basket: {
    id: string;
    name: string;
    thesis: string;
    creatorWallet: string;
    members: Member[];
    followers: number;
    createdAt: number;
  };
  performance: {
    initialNavUsdc: number;
    finalNavUsdc: number;
    totalReturn: number;
    maxDrawdown: number;
    settledMarkets: number;
    points: Array<{ day: string; navUsdc: number; dailyReturn: number; drawdown: number }>;
  };
}

interface SignalsPayload {
  following: boolean;
  perMarketCapUsdc: number;
  signals: MirrorSignal[];
}

interface PreparedTx {
  layer: "base" | "er";
  rpcUrl: string;
  transaction: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}

const DEFAULT_CAP_USDC = 2;

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

/** Base64 → bytes without relying on a Buffer polyfill in the browser. */
function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function memberSeed(m: Pick<Member, "agentId" | "kind" | "wallet">): string {
  return m.kind === "agent" && m.wallet ? `challenger-${m.wallet}` : `council-${m.agentId}`;
}

export default function BasketDetailClient({ basketId }: { basketId: string }) {
  const t = useTranslations("baskets");
  const { publicKey, connected, signMessage, signTransaction } = useWallet();
  const follower = publicKey?.toBase58() ?? null;

  const [data, setData] = useState<BasketDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [signals, setSignals] = useState<SignalsPayload | null>(null);
  const [cap, setCap] = useState(DEFAULT_CAP_USDC);
  const [busy, setBusy] = useState(false);
  const [mirroring, setMirroring] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ claimId: number; text: string; delegate?: boolean } | null>(null);

  const load = useCallback(() => {
    fetch(`/api/baskets/${basketId}`)
      .then(async (r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return (await r.json()) as BasketDetail;
      })
      .then((d) => {
        if (d) setData(d);
      })
      .catch(() => setNotFound(true));
  }, [basketId]);

  const loadSignals = useCallback(() => {
    const qs = follower ? `?follower=${encodeURIComponent(follower)}` : "";
    fetch(`/api/baskets/${basketId}/signals${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: SignalsPayload | null) => {
        if (!d) return;
        setSignals(d);
        if (d.following) setCap(d.perMarketCapUsdc);
      })
      .catch(() => setSignals(null));
  }, [basketId, follower]);

  useEffect(load, [load]);
  useEffect(loadSignals, [loadSignals]);

  async function submitCap(nextCap: number) {
    if (!follower) return;
    setError(null);
    setBusy(true);
    try {
      if (!signMessage) throw new Error(t("noSignMessage"));
      const signedAt = Date.now();
      const message = followMessage({ basketId, follower, perMarketCapUsdc: nextCap, signedAt });
      const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
      const res = await fetch(`/api/baskets/${basketId}/subscribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ follower, perMarketCapUsdc: nextCap, signature, signedAt }),
      });
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(payload.message ?? t("failed")));
      load();
      loadSignals();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  async function mirror(signal: MirrorSignal) {
    if (!follower) return;
    setError(null);
    setNotice(null);
    setMirroring(signal.claimId);
    try {
      if (!signTransaction) throw new Error(t("noSignTransaction"));
      const res = await fetch(`/api/baskets/${basketId}/mirror`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ follower, claimId: signal.claimId }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        reason?: string;
        message?: string;
        transactions?: PreparedTx[];
      };
      if (!res.ok) {
        if (payload.reason === "balance_not_delegated") {
          setNotice({ claimId: signal.claimId, text: t("delegateFirst"), delegate: true });
          return;
        }
        throw new Error(payload.message ?? t("failed"));
      }
      let last = "";
      for (const p of payload.transactions ?? []) {
        const signed = await signTransaction(Transaction.from(fromBase64(p.transaction)));
        const connection = new Connection(p.rpcUrl, "confirmed");
        last = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: p.layer === "er" });
        const confirmed = await connection.confirmTransaction(
          { signature: last, blockhash: p.recentBlockhash, lastValidBlockHeight: p.lastValidBlockHeight },
          "confirmed",
        );
        if (confirmed.value.err) throw new Error(t("failed"));
      }
      setNotice({ claimId: signal.claimId, text: t("mirrored", { sig: shortenAddress(last, 6) }) });
      loadSignals();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setMirroring(null);
    }
  }

  const sparkline = useMemo(() => {
    const values = (data?.performance.points ?? []).map((p) => p.navUsdc);
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const path = values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * 100;
        const y = 30 - ((v - min) / span) * 28 - 1;
        return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
    return { path, up: values[values.length - 1] >= values[0] };
  }, [data]);

  if (notFound) {
    return (
      <div className="pb-16">
        <BlueprintHeading as="h1">{t("notFound")}</BlueprintHeading>
        <div className="px-4 pt-10 text-center">
          <Link href="/baskets" className="font-mono text-[12px] text-pv-emerald hover:underline">
            ← {t("back")}
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="px-4 pt-16 sm:px-6">
        <div className="h-[420px] animate-pulse border border-pv-border/25 bg-pv-surface2/40" />
      </div>
    );
  }

  const { basket, performance } = data;

  return (
    <div className="pb-16">
      <BlueprintHeading as="h1" eyebrow={t("eyebrow")} subtitle={basket.thesis}>
        {basket.name}
      </BlueprintHeading>

      <div className="flex flex-wrap items-center justify-center gap-2 border-b border-pv-border/25 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em]">
        <span className="chip">{basket.id}</span>
        <span className="chip inline-flex items-center gap-1">
          <Users className="h-3 w-3" /> {t("followers", { count: basket.followers })}
        </span>
        <span className="chip">{t("composedBy", { address: shortenAddress(basket.creatorWallet) })}</span>
      </div>

      <div className="bp-cells grid-cols-2 border-b border-pv-border/25 lg:grid-cols-4">
        <BlueprintStat value={formatUsdcBare(performance.initialNavUsdc)} label={t("start")} tone="text" />
        <BlueprintStat value={formatUsdcBare(performance.finalNavUsdc)} label={t("now")} tone="gold" />
        <BlueprintStat
          value={pct(performance.totalReturn)}
          label={t("return")}
          tone={performance.totalReturn < 0 ? "danger" : "accent"}
        />
        <BlueprintStat value={pct(performance.maxDrawdown)} label={t("maxDrawdown")} tone="danger" />
      </div>

      <BlueprintSection title={t("curve")} eyebrow={t("settledMarkets", { count: performance.settledMarkets })}>
        {sparkline ? (
          <svg
            viewBox="0 0 100 30"
            preserveAspectRatio="none"
            className="h-32 w-full"
            role="img"
            aria-label={t("curve")}
          >
            <path
              d={sparkline.path}
              fill="none"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              className={sparkline.up ? "stroke-pv-emerald" : "stroke-pv-danger"}
            />
          </svg>
        ) : (
          <p className="bp-paper border border-dashed border-pv-border/40 px-4 py-8 text-center text-[12px] text-pv-muted">
            {t("noCurve")}
          </p>
        )}
        <p className="mt-4 flex items-start gap-2 border-t border-pv-border/25 pt-3 text-[11px] leading-relaxed text-pv-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t("curveCaveat", { nav: formatUsdcBare(performance.initialNavUsdc) })}
        </p>
      </BlueprintSection>

      <BlueprintSection title={t("legs")} bodyClassName="bp-cells grid-cols-1 border-b border-pv-border/25 sm:grid-cols-2">
        {basket.members.map((m) => (
          <div key={m.agentId} className="flex items-center gap-3 px-4 py-3">
            <PeepAvatar seed={memberSeed(m)} size={36} shape="square" alt="" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[13px] text-pv-text">{m.agentId}</p>
              <p className="font-mono text-[10px] text-pv-muted">
                {t(m.kind)} · {m.wallet ? shortenAddress(m.wallet) : t("unresolved")}
                {m.idle && <span className="ml-2 uppercase tracking-[0.14em]">{t("idle")}</span>}
              </p>
            </div>
            <span className="font-display text-lg font-bold tabular-nums text-pv-emerald">
              {(m.weightBps / 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </BlueprintSection>

      <BlueprintSection title={t("follow")}>
        <p className="mb-4 text-[12px] leading-relaxed text-pv-muted">{t("followHint")}</p>
        {signals?.following && (
          <p className="mb-4 inline-flex items-center gap-2 border border-pv-emerald/40 bg-pv-emerald/[0.06] px-3 py-2 text-[12px] text-pv-emerald">
            <Check className="h-3.5 w-3.5" /> {t("following", { cap: signals.perMarketCapUsdc })}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="cap" className="label">
              {t("cap")}
            </label>
            <input
              id="cap"
              type="number"
              min={MIN_FOLLOW_CAP_USDC}
              max={MAX_FOLLOW_CAP_USDC}
              step={0.5}
              value={cap}
              onChange={(e) => setCap(Number(e.target.value))}
              className="form-field-pv w-32 text-right font-mono tabular-nums"
            />
          </div>
          <p className="mb-2 font-mono text-[11px] text-pv-muted">
            {t("worstCase", { amount: (cap * basket.members.length).toFixed(2), legs: basket.members.length })}
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 border border-pv-danger/40 bg-pv-danger/[0.06] px-4 py-3 text-sm text-pv-danger"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}

        {connected && follower ? (
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              className="btn-primary flex items-center justify-center gap-2"
              disabled={busy || cap < MIN_FOLLOW_CAP_USDC || cap > MAX_FOLLOW_CAP_USDC}
              onClick={() => void submitCap(cap)}
            >
              {busy ? t("waiting") : signals?.following ? t("updateCap") : t("followCta")}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy || !signals?.following}
              onClick={() => void submitCap(0)}
            >
              {t("unfollow")}
            </button>
          </div>
        ) : (
          <div className="mt-5 flex flex-col items-center gap-2">
            <p className="text-center text-[12px] text-pv-muted">{t("connect")}</p>
            <ConnectWalletButton />
          </div>
        )}
      </BlueprintSection>

      <BlueprintSection title={t("signals")} bodyClassName="px-4 py-6 sm:px-6">
        <p className="mb-4 text-[12px] leading-relaxed text-pv-muted">{t("signalsHint")}</p>
        {notice && (
          <div className="mb-4 flex flex-wrap items-center gap-2 border border-pv-border/40 bg-pv-surface px-4 py-3 text-[12px] text-pv-text">
            <span className="min-w-0 flex-1">{notice.text}</span>
            {notice.delegate && (
              <Link href={`/arena/${notice.claimId}`} className="font-mono text-[11px] text-pv-emerald hover:underline">
                {t("openClaim")} →
              </Link>
            )}
          </div>
        )}
        {!signals || signals.signals.length === 0 ? (
          <p className="bp-paper border border-dashed border-pv-border/40 px-4 py-8 text-center text-[12px] text-pv-muted">
            {t("noSignals")}
          </p>
        ) : (
          <ul className="divide-y divide-pv-border/25 border border-pv-border/25">
            {signals.signals.map((s) => (
              <li key={s.claimId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Radio className="h-4 w-4 shrink-0 text-pv-emerald" />
                <div className="min-w-0 flex-1">
                  <Link href={`/arena/${s.claimId}`} className="font-mono text-[13px] text-pv-text hover:text-pv-emerald">
                    {t("claim", { id: s.claimId })}
                  </Link>
                  <p className="font-mono text-[10px] text-pv-muted">
                    {t("heldBy", { members: s.members.map((m) => m.agentId).join(", ") })} · {s.layer.toUpperCase()}
                  </p>
                </div>
                {signals.following ? (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={mirroring !== null}
                    onClick={() => void mirror(s)}
                  >
                    {mirroring === s.claimId
                      ? t("mirroring")
                      : t("mirror", { amount: formatUsdcUnitsBare(s.suggestedStakeUnits) })}
                  </button>
                ) : (
                  <span className="font-mono text-[11px] tabular-nums text-pv-muted">
                    {formatUsdcUnitsBare(s.suggestedStakeUnits)} USDC
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {signals && !signals.following && signals.signals.length > 0 && (
          <p className="mt-3 text-[11px] text-pv-muted">{t("signalsFollowFirst")}</p>
        )}
        <p className="mt-4 border-t border-pv-border/25 pt-3 text-[11px] text-pv-muted">
          {t("agentsHint")}{" "}
          <Link href="/docs" className="text-pv-emerald hover:underline">
            docs/AGENTS.md
          </Link>
        </p>
      </BlueprintSection>

      <nav className="mt-10 text-center">
        <Link href="/baskets" className="font-mono text-[12px] text-pv-muted hover:text-pv-text">
          ← {t("back")}
        </Link>
      </nav>
    </div>
  );
}
