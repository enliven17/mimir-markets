"use client";

/**
 * Wallets to copy: the council personas, each with its own on-chain wallet.
 * "Copy" opens the grant sheet with that persona picked as the signal (or
 * the wallet sheet first when no wallet is connected), so the page always
 * shows who can be mirrored, before any signature.
 *
 * The roster comes from the server page (static per deploy), so this renders
 * with the HTML instead of after a fetch.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";

import { SURFACE } from "@/components/arena/surface";
import Button from "@/components/ui/Button";
import PeepAvatar from "@/components/ui/PeepAvatar";
import { shortenAddress } from "@/lib/constants";
import { explorerUrl } from "@/lib/solana/config";

export interface CopyLeader {
  slug: string;
  displayName: string;
  bio: string;
  track: "classic" | "philosopher";
  address: string;
  usesLlm: boolean;
}

const FIRST = 6;

export default function CopyLeaders({
  leaders,
  onCopy,
  canCopy,
}: {
  leaders: CopyLeader[];
  onCopy: (slug: string) => void;
  /** False while copy trading is switched off on this deploy. */
  canCopy: boolean;
}) {
  const t = useTranslations("copy.leaders");
  const [all, setAll] = useState(false);
  if (leaders.length === 0) return null;
  const shown = all ? leaders : leaders.slice(0, FIRST);

  return (
    <section aria-labelledby="copy-leaders-heading" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="copy-leaders-heading" className="m-0 font-display text-[1.45rem] leading-none text-cream">
          {t("title")}
        </h2>
        <p className="m-0 text-[14px] leading-relaxed text-muted">{t("lead")}</p>
      </div>
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 lg:grid-cols-3">
        {shown.map((l) => (
          <li key={l.slug} className={`${SURFACE} grid min-w-0 content-start gap-3 p-4`}>
            <div className="flex min-w-0 items-center gap-3">
              <PeepAvatar seed={`council-${l.slug}`} size={40} tone={l.track === "philosopher" ? "accent" : "neutral"} />
              <div className="min-w-0 flex-1">
                <p className="m-0 truncate text-[15px] text-cream">{l.displayName}</p>
                <p className="m-0 truncate text-[12px] text-muted">
                  {t(`track.${l.track}`)} · {l.usesLlm ? t("llm") : t("rule")}
                </p>
              </div>
            </div>
            <p className="m-0 line-clamp-2 min-h-[2.6em] text-[13px] leading-snug text-muted">{l.bio}</p>
            <div className="flex items-center justify-between gap-3">
              {l.address ? (
                <a
                  href={explorerUrl("address", l.address)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t("explorerAria", { name: l.displayName })}
                  className="inline-flex items-center gap-1 font-mono text-[12px] text-muted hover:text-coral"
                >
                  {shortenAddress(l.address)}
                  <ArrowUpRight className="size-3" aria-hidden />
                </a>
              ) : (
                <span />
              )}
              {canCopy ? (
                <Button
                  size="sm"
                  variant="ghost"
                  fullWidth={false}
                  onClick={() => onCopy(l.slug)}
                  aria-label={t("copyAria", { name: l.displayName })}
                >
                  {t("copy")}
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {leaders.length > FIRST ? (
        <Button
          size="sm"
          variant="ghost"
          fullWidth={false}
          className="justify-self-center"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
        >
          {all ? t("showFewer") : t("showAll", { count: leaders.length })}
        </Button>
      ) : null}
    </section>
  );
}
