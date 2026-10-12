"use client";

/**
 * Share a market: the phone's own share sheet where there is one, else X, Telegram and a copied link. The link
 * opens the market page, whose preview is the market's card (app/api/telegram/card/share). `fresh` is the banner
 * shown right after the creator opened it (?new=1).
 */
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";

import { SITE_URL } from "@/lib/site";

const PILL = "press inline-flex items-center gap-1.5 rounded-full bg-panel-raised px-3.5 py-2 text-[13px] text-cream hover:bg-panel";

export function marketShareText(question: string, fresh: boolean): string {
  const q = question.length > 180 ? `${question.slice(0, 177)}…` : question;
  return fresh ? `I just opened a market on Mimir: ${q} Take the other side 👇` : `${q} Pick a side on Mimir 👇`;
}

export default function ShareMarket({ kind, marketId, question, fresh = false }: { kind: string; marketId: number; question: string; fresh?: boolean }) {
  const url = `${SITE_URL}/${useLocale()}/arena/arc/${kind}/${marketId}`;
  const text = marketShareText(question, fresh);
  const [copied, setCopied] = useState(false);
  const [native, setNative] = useState(false);
  useEffect(() => setNative(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);

  const copy = () =>
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });

  const links = (
    <>
      {native ? (
        <button type="button" className={PILL} onClick={() => void navigator.share({ title: question, text, url }).catch(() => undefined)}>
          Share…
        </button>
      ) : null}
      <a className={PILL} href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">
        Post on X
      </a>
      <a className={PILL} href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
        Telegram
      </a>
      <button type="button" className={PILL} onClick={copy}>
        {copied ? "Link copied" : "Copy link"}
      </button>
    </>
  );

  if (!fresh) return <div className="flex flex-wrap items-center gap-2">{links}</div>;
  return (
    <section aria-label="Share your market" className="grid gap-3 rounded-2xl bg-panel p-4 shadow-[inset_0_0_0_1px_rgb(255_81_72/.45)] sm:p-5">
      <div className="grid gap-1">
        <h2 className="m-0 text-[16px] text-cream">Your market is live. Bring the other side.</h2>
        <p className="m-0 text-[13px] text-muted">Share the link: it opens with this market&apos;s card, and anyone with the link can take a side.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{links}</div>
    </section>
  );
}
