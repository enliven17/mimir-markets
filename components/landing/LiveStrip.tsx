"use client";

import { arcArenaEnabled } from "@/components/arc/arena/enabled";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Marquee, RollingNumber, useInViewOnce } from "@/components/motion";
import { liveStats, poolUsdc, tickerClaims } from "@/lib/landing";
import { formatUsdcBare } from "@/lib/money";
import { ST_RESOLVED } from "@/lib/solana/config";
import { useLandingFeed } from "./LandingFeed";

const whole = (n: number) => Math.round(n).toLocaleString("en-US");
const usdc = (n: number) => formatUsdcBare(n);
const MIN_TICKER_ITEMS = 8;
const QUESTION_MAX = 72;

const clip = (s: string) => (s.length > QUESTION_MAX ? `${s.slice(0, QUESTION_MAX - 1).trimEnd()}…` : s);

/**
 * Numbers sit at zero until the strip is on screen with real data, then roll
 * up once; later polls roll from the last value and flash red.
 */
function useRollIn(ready: boolean, target: React.RefObject<Element | null>): boolean {
  const seen = useInViewOnce(target, 0.2);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!ready || !seen || on) return;
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, [ready, seen, on]);
  return on;
}

/**
 * 2. Live strip + ticker: three live numbers from the arena feed (markets,
 * open pool, live inside the Ephemeral Rollup), then a ticker of the newest
 * claims that speeds up and turns with the scroll.
 */
export default function LiveStrip() {
  const t = useTranslations("home.strip");
  const { feed, status } = useLandingFeed();
  const ref = useRef<HTMLDListElement>(null);
  const ready = status === "ready";
  const rolled = useRollIn(ready, ref);
  const stats = liveStats(feed);

  const items = useMemo(() => {
    const list = tickerClaims(feed);
    if (list.length === 0) return [];
    // Too few claims to fill a wide screen: repeat the real ones.
    const out = [...list];
    while (out.length < MIN_TICKER_ITEMS) out.push(...list);
    return out;
  }, [feed]);

  const value = (n: number, format: (n: number) => string) =>
    ready ? (
      <RollingNumber value={rolled ? n : 0} format={format} flash duration={1.4} mono={false} className="num" />
    ) : (
      <span className="text-muted">-</span>
    );

  return (
    <div className="l-live">
      <dl ref={ref} className="l-strip" aria-label={t("label")} aria-busy={status === "loading" || undefined}>
        <div className="l-stat">
          <dt>
            {t("markets")}
            {ready ? <span className="px-dot !h-1.5 !w-1.5" aria-hidden /> : null}
          </dt>
          <dd>{value(stats.markets, whole)}</dd>
        </div>
        <div className="l-stat">
          <dt>{t("openPool")}</dt>
          <dd>
            {value(stats.openPool, usdc)} <small>{t("usdc")}</small>
          </dd>
        </div>
        <div className="l-stat">
          <dt>{arcArenaEnabled ? t("openNow") : t("liveOnEr")}</dt>
          <dd>{value(stats.liveOnEr, whole)}</dd>
        </div>
        <div className="l-src" data-state={status}>
          <dt className="sr-only">{t("network")}</dt>
          <dd className="flex items-center gap-2">
            <span aria-hidden className="live-dot !h-1.5 !w-1.5" />
            {status === "error" ? t("offline") : arcArenaEnabled ? t("networkArc") : t("networkValue")}
          </dd>
        </div>
      </dl>

      <div className="l-ticker" aria-hidden>
        <span className="l-ticker-label">
          <span className="px-dot !h-1.5 !w-1.5" />
          {t("tickerLabel")}
        </span>
        {items.length > 0 ? (
          <Marquee speed={42}>
            {items.map((c, i) => (
              <span key={`${c.id}-${i}`} className="l-tx">
                <span className="l-tx-sq" data-done={c.state === ST_RESOLVED || undefined} />
                <span className="l-tx-id">{c.label ?? `#${c.id}`}</span>
                <span>{clip(c.question)}</span>
                <span className="l-tx-pool">
                  {formatUsdcBare(poolUsdc(c))} {t("usdc")}
                </span>
              </span>
            ))}
          </Marquee>
        ) : status === "loading" ? null : (
          <p className="l-ticker-empty">{t("tickerEmpty")}</p>
        )}
      </div>
    </div>
  );
}
