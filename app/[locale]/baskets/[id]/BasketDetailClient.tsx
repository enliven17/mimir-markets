"use client";

/**
 * One basket: the replayed curve and the follow card first, then the open
 * signals to mirror and the legs behind disclosures.
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
import bs58 from "bs58";
import { Check, TriangleAlert, Users } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { SURFACE } from "@/components/arena/surface";
import Button from "@/components/ui/Button";
import Disclosure from "@/components/ui/Disclosure";
import Input from "@/components/ui/Input";
import Skeleton from "@/components/ui/Skeleton";
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
    /** Shipped with the app (a council mix): there is no composer wallet. */
    house?: boolean;
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
    points: Array<{
      day: string;
      navUsdc: number;
      dailyReturn: number;
      drawdown: number;
    }>;
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
  /** Which card shows the error: the follow card or the signals list. */
  const [errorAt, setErrorAt] = useState<"follow" | "signals">("follow");
  const [notice, setNotice] = useState<{
    claimId: number;
    text: string;
    delegate?: boolean;
  } | null>(null);

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
    setErrorAt("follow");
    setBusy(true);
    try {
      if (!signMessage) throw new Error(t("noSignMessage"));
      const signedAt = Date.now();
      const message = followMessage({
        basketId,
        follower,
        perMarketCapUsdc: nextCap,
        signedAt,
      });
      const signature = bs58.encode(await signMessage(new TextEncoder().encode(message)));
      const res = await fetch(`/api/baskets/${basketId}/subscribe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          follower,
          perMarketCapUsdc: nextCap,
          signature,
          signedAt,
        }),
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
    setErrorAt("signals");
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
          setNotice({
            claimId: signal.claimId,
            text: t("delegateFirst"),
            delegate: true,
          });
          return;
        }
        throw new Error(payload.message ?? t("failed"));
      }
      const { Connection, Transaction } = await import("@solana/web3.js");
      let last = "";
      for (const p of payload.transactions ?? []) {
        const signed = await signTransaction(Transaction.from(fromBase64(p.transaction)));
        const connection = new Connection(p.rpcUrl, "confirmed");
        last = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: p.layer === "er",
        });
        const confirmed = await connection.confirmTransaction(
          {
            signature: last,
            blockhash: p.recentBlockhash,
            lastValidBlockHeight: p.lastValidBlockHeight,
          },
          "confirmed",
        );
        if (confirmed.value.err) throw new Error(t("failed"));
      }
      setNotice({
        claimId: signal.claimId,
        text: t("mirrored", { sig: shortenAddress(last, 6) }),
      });
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

  const back = (
    <Link href="/baskets" className="justify-self-start text-[14px] text-muted transition-colors hover:text-cream">
      ← {t("back")}
    </Link>
  );

  if (notFound) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {back}
        <h1 className="m-0 font-display text-app-h1 text-cream">{t("notFound")}</h1>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6" aria-label={t("loading")}>
        {back}
        <Skeleton className="!h-12 w-2/3" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Skeleton className="!h-[300px] !rounded-2xl" />
          <Skeleton className="!h-[300px] !rounded-2xl" />
        </div>
      </div>
    );
  }

  const { basket, performance } = data;
  const alert = (
    <div role="alert" className="flex items-start gap-2.5 rounded-lg bg-danger/[0.1] px-4 py-3 text-[14px] text-danger">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">{error}</span>
    </div>
  );
  const list = signals?.signals ?? [];
  const stats: Array<[string, string, string]> = [
    [t("now"), formatUsdcBare(performance.finalNavUsdc), "text-cream"],
    [t("return"), pct(performance.totalReturn), performance.totalReturn < 0 ? "text-danger" : "text-cream"],
    [t("maxDrawdown"), pct(performance.maxDrawdown), "text-danger"],
  ];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <header className="grid gap-3">
        {back}
        <h1 className="m-0 break-words font-display text-app-h1 text-cream">{basket.name}</h1>
        <p className="m-0 max-w-[62ch] text-[15px] leading-relaxed text-muted">{basket.thesis}</p>
        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
          <span className="font-mono">{basket.id}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" aria-hidden /> {t("followers", { count: basket.followers })}
          </span>
          <span aria-hidden>·</span>
          <span>
            {basket.house ? t("composedByCouncil") : t("composedBy", { address: shortenAddress(basket.creatorWallet) })}
          </span>
        </p>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section aria-labelledby="basket-curve" className={`${SURFACE} grid gap-5 p-5 sm:p-6`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="basket-curve" className="m-0 font-display text-[1.45rem] leading-none text-cream">
              {t("curve")}
            </h2>
            <span className="text-[13px] text-muted">{t("settledMarkets", { count: performance.settledMarkets })}</span>
          </div>
          <dl className="m-0 grid grid-cols-3 gap-4">
            {stats.map(([label, value, tone]) => (
              <div key={label} className="flex min-w-0 flex-col justify-between">
                <dt className="text-[11px] uppercase tracking-[0.06em] text-muted">{label}</dt>
                <dd className={`m-0 mt-1 truncate font-mono text-[clamp(1.05rem,3.6vw,1.5rem)] tabular-nums ${tone}`}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
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
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                className={sparkline.up ? "stroke-coral" : "stroke-danger"}
              />
            </svg>
          ) : (
            <p className="m-0 grid h-32 place-items-center rounded-lg bg-cream/[0.03] px-4 text-center text-[13px] text-muted">
              {t("noCurve")}
            </p>
          )}
          <Disclosure summary={t("curveAbout")}>
            <p className="m-0 text-[13px] leading-relaxed text-muted">
              {t("curveCaveat", {
                nav: formatUsdcBare(performance.initialNavUsdc),
              })}
            </p>
          </Disclosure>
        </section>

        <section aria-labelledby="basket-follow" className={`${SURFACE} grid gap-4 p-5 sm:p-6`}>
          <h2 id="basket-follow" className="m-0 font-display text-[1.45rem] leading-none text-cream">
            {t("follow")}
          </h2>
          {signals?.following ? (
            <p className="m-0 inline-flex items-center gap-2 justify-self-start rounded-full bg-coral/[0.14] px-3 py-1.5 text-[13px] text-pending">
              <Check className="size-3.5" aria-hidden /> {t("following", { cap: signals.perMarketCapUsdc })}
            </p>
          ) : (
            <p className="m-0 text-[14px] leading-relaxed text-muted">{t("followLead")}</p>
          )}
          <Input
            id="cap"
            label={t("cap")}
            type="number"
            min={MIN_FOLLOW_CAP_USDC}
            max={MAX_FOLLOW_CAP_USDC}
            step={0.5}
            value={cap}
            onChange={(e) => setCap(Number(e.target.value))}
            className="font-mono tabular-nums"
            hint={t("worstCase", {
              amount: (cap * basket.members.length).toFixed(2),
              legs: basket.members.length,
            })}
          />
          {error && errorAt === "follow" ? alert : null}
          {connected && follower ? (
            <div className="grid gap-2">
              <Button
                size="sm"
                loading={busy}
                disabled={cap < MIN_FOLLOW_CAP_USDC || cap > MAX_FOLLOW_CAP_USDC}
                onClick={() => void submitCap(cap)}
              >
                {busy ? t("waiting") : signals?.following ? t("updateCap") : t("followCta")}
              </Button>
              {signals?.following ? (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void submitCap(0)}>
                  {t("unfollow")}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="grid justify-items-start gap-2">
              <p className="m-0 text-[13px] text-muted">{t("connect")}</p>
              <ConnectWalletButton />
            </div>
          )}
          <Disclosure summary={t("followHow")}>
            <p className="m-0 text-[13px] leading-relaxed text-muted">{t("followHint")}</p>
          </Disclosure>
        </section>
      </div>

      <div className="grid gap-3">
        <Disclosure
          summary={t("signals")}
          meta={signals ? list.length : undefined}
          defaultOpen={Boolean(signals?.following && list.length > 0)}
        >
          <div className="grid gap-4">
            <p className="m-0 text-[13px] leading-relaxed text-muted">{t("signalsHint")}</p>
            {error && errorAt === "signals" ? alert : null}
            {notice ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-cream/[0.05] px-4 py-3 text-[14px] text-cream">
                <span className="min-w-0 flex-1 break-words">{notice.text}</span>
                {notice.delegate ? (
                  <Link href={`/arena/${notice.claimId}`} className="text-[13px] text-coral hover:underline">
                    {t("openClaim")} →
                  </Link>
                ) : null}
              </div>
            ) : null}
            {list.length === 0 ? (
              <p className="m-0 text-[14px] text-muted">{t("noSignals")}</p>
            ) : (
              <ul className="m-0 list-none divide-y divide-line p-0">
                {list.map((s) => (
                  <li key={s.claimId} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/arena/${s.claimId}`} className="text-[15px] text-cream hover:text-coral">
                        {t("claim", { id: s.claimId })}
                      </Link>
                      <p className="m-0 mt-0.5 truncate text-[13px] text-muted">
                        {t("heldBy", {
                          members: s.members.map((m) => m.agentId).join(", "),
                        })}{" "}
                        · {s.layer.toUpperCase()}
                      </p>
                    </div>
                    {signals?.following ? (
                      <Button
                        size="sm"
                        fullWidth={false}
                        loading={mirroring === s.claimId}
                        disabled={mirroring !== null}
                        onClick={() => void mirror(s)}
                      >
                        {mirroring === s.claimId
                          ? t("mirroring")
                          : t("mirror", {
                              amount: formatUsdcUnitsBare(s.suggestedStakeUnits),
                            })}
                      </Button>
                    ) : (
                      <span className="font-mono text-[13px] tabular-nums text-muted">
                        {formatUsdcUnitsBare(s.suggestedStakeUnits)} USDC
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {signals && !signals.following && list.length > 0 ? (
              <p className="m-0 text-[13px] text-muted">{t("signalsFollowFirst")}</p>
            ) : null}
            <p className="m-0 text-[13px] text-muted">
              {t("agentsHint")}{" "}
              <Link href="/docs" className="text-coral underline decoration-coral/40 underline-offset-2 hover:decoration-coral">
                docs/AGENTS.md
              </Link>
            </p>
          </div>
        </Disclosure>

        <Disclosure summary={t("legs")} meta={basket.members.length}>
          <ul className="m-0 grid list-none gap-x-6 p-0 sm:grid-cols-2">
            {basket.members.map((m) => (
              <li key={m.agentId} className="flex items-center gap-3 border-b border-line py-3">
                <PeepAvatar seed={memberSeed(m)} size={34} shape="square" alt="" />
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate font-mono text-[13px] text-cream">{m.agentId}</p>
                  <p className="m-0 truncate text-[12px] text-muted">
                    {t(m.kind)} · {m.wallet ? shortenAddress(m.wallet) : t("unresolved")}
                    {m.idle ? ` · ${t("idle")}` : ""}
                  </p>
                </div>
                <span className="font-mono text-[15px] tabular-nums text-cream">{(m.weightBps / 100).toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      </div>
    </div>
  );
}
