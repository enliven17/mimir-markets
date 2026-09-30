"use client";

/**
 * The council's jurors, one track at a time (Classic / Philosophers). Each
 * card is compact: portrait, name, archetype, record and the one-line
 * temperament; bankroll, stakes, categories and recent bets open in a
 * dropdown that floats over the grid, so opening one never stretches the row.
 * One dropdown is open at a time. Data arrives from the server page already
 * tallied.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { SURFACE_DEEP } from "@/components/arena/surface";
import Segmented from "@/components/ui/Segmented";
import PeepAvatar from "@/components/ui/PeepAvatar";
import { Link } from "@/i18n/navigation";
import { formatUsdcUnitsBare } from "@/lib/money";

export type Track = "classic" | "philosopher";

export interface RosterPersona {
  slug: string;
  displayName: string;
  bio: string;
  archetype: string;
  track: Track;
  address: string;
  categoryFilter?: string[];
  /** USDC base units, as strings (the page is server-rendered). */
  bankroll: string;
  atRisk: string;
  stakes: number;
  won: number;
  lost: number;
  recentBets: { claimId: number; stake: string }[];
}

const TRACKS: Track[] = ["classic", "philosopher"];

const short = (a: string) => (a.length > 8 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || "—");

export default function CouncilRoster({ personas }: { personas: RosterPersona[] }) {
  const t = useTranslations("council");
  const [track, setTrack] = useState<Track>("classic");
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const tracks = TRACKS.filter((k) => personas.some((p) => p.track === k));
  const members = personas.filter((p) => p.track === track);

  return (
    <section aria-label={t("tracksLabel")} className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-5">
        {tracks.length > 1 ? (
          <Segmented
            label={t("tracksLabel")}
            value={track}
            onChange={(k) => {
              setOpenSlug(null);
              setTrack(k);
            }}
            tone="maroon"
            className="sm:w-[340px] sm:flex-none"
            options={tracks.map((k) => ({
              value: k,
              label: t(`tracks.${k}.title`),
              count: personas.filter((p) => p.track === k).length,
            }))}
          />
        ) : null}
        <p className="m-0 text-[14px] text-muted">{t(`tracks.${track}.blurb`)}</p>
      </div>
      <div key={track} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((p, i) => (
          <PersonaCard
            key={p.slug}
            persona={p}
            index={i}
            open={openSlug === p.slug}
            onOpenChange={(on) => setOpenSlug(on ? p.slug : null)}
          />
        ))}
      </div>
    </section>
  );
}

// Same fill as SURFACE, without its overflow clip so the dropdown can leave the card.
const CARD = "relative rounded-2xl bg-[rgb(27_19_20/.93)] shadow-card";

function PersonaCard({
  persona: p,
  index,
  open,
  onOpenChange,
}: {
  persona: RosterPersona;
  index: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("council");
  const active = p.stakes > 0;
  const hasRecord = p.won + p.lost > 0;
  const panelId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onOpenChange(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <article
      ref={rootRef}
      className={`${CARD} card-in grid content-start gap-3 p-4 ${open ? "z-30" : ""}`}
      style={{ "--i": index } as React.CSSProperties}
    >
      <div className="flex items-center gap-3">
        <PeepAvatar seed={`council-${p.slug}`} size={44} shape="square" tone={active ? "accent" : "neutral"} />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate font-display text-[1.3rem] leading-none text-cream">{p.displayName}</h3>
          <p className="m-0 mt-1 truncate text-[12px] text-muted">{t(`archetype.${p.archetype}` as never)}</p>
        </div>
        <span
          className={`shrink-0 font-mono text-[15px] tabular-nums ${hasRecord ? "text-cream" : "text-dim"}`}
          title={hasRecord ? t("recordTitle", { won: p.won, lost: p.lost }) : t("noRecord")}
        >
          <span className="sr-only">{hasRecord ? t("recordTitle", { won: p.won, lost: p.lost }) : t("noRecord")}</span>
          <span aria-hidden>{hasRecord ? t("record", { won: p.won, lost: p.lost }) : "—"}</span>
        </span>
      </div>
      <p className="m-0 line-clamp-2 min-h-[2.8em] text-[13px] leading-[1.4] text-muted">{p.bio}</p>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
        className="flex min-h-[32px] w-full items-center gap-3 rounded-xs border-t border-cream/10 pt-3 text-left text-[13px] text-cream hover:text-coral focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
      >
        <span className="min-w-0 truncate">{t("details")}</span>
        <span className="ml-auto flex items-center gap-3">
          {active ? <span className="font-mono tabular-nums text-muted">{p.stakes}</span> : null}
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            shapeRendering="crispEdges"
            fill="currentColor"
            aria-hidden
            className={`text-coral transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          >
            <path d="M0 2h2v2h2v2h2V4h2V2h2v2H8v2H6v2H4V6H2V4H0z" />
          </svg>
        </span>
      </button>
      <div
        id={panelId}
        role="region"
        aria-label={t("details")}
        // `invisible` (visibility: hidden) also takes the closed panel out of tab order and the a11y tree.
        className={`absolute inset-x-0 top-[calc(100%-6px)] z-30 origin-top rounded-2xl p-4 ${SURFACE_DEEP} !bg-[rgb(16_10_11)] transition-[opacity,transform,visibility] duration-200 ease-out motion-reduce:transition-none ${
          open ? "visible translate-y-0 scale-100 opacity-100" : "invisible -translate-y-1 scale-[0.98] opacity-0"
        }`}
      >
        <div className="grid gap-3">
          <dl className="kv">
            <dt>{t("bankroll")}</dt>
            <dd>{formatUsdcUnitsBare(p.bankroll)} USDC</dd>
            <dt>{t("stakes")}</dt>
            <dd>{p.stakes}</dd>
            <dt>{t("atRisk")}</dt>
            <dd>{formatUsdcUnitsBare(p.atRisk)} USDC</dd>
          </dl>
          {p.categoryFilter?.length ? (
            <p className="m-0 text-[12px] text-muted">
              {t("only")} <span className="capitalize text-cream">{p.categoryFilter.join(", ")}</span>
            </p>
          ) : null}
          {p.recentBets.length > 0 ? (
            <ul className="m-0 grid list-none gap-1.5 p-0 text-[13px]">
              {p.recentBets.map((b) => (
                <li key={b.claimId} className="flex items-baseline justify-between gap-2">
                  <Link href={`/arena/${b.claimId}`} className="text-coral hover:underline">
                    {t("claim", { id: b.claimId })}
                  </Link>
                  <span className="font-mono tabular-nums text-cream">{formatUsdcUnitsBare(b.stake)} USDC</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13px] text-muted">
              {p.bankroll === "0" && p.address ? t("unfunded") : t("noBets")}
            </p>
          )}
          {p.address ? (
            <a
              href={`https://explorer.solana.com/address/${p.address}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[12px] text-muted hover:text-coral"
            >
              {short(p.address)} ↗
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
