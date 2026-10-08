"use client";

/**
 * The terms, accepted with a click: a card at the bottom left on desktop and at the bottom on phones (above the
 * app's tab bar, via --tabbar-h), on every page until the visitor accepts this TERMS_VERSION. Not a modal: the
 * page stays usable behind it. The acceptance lives in localStorage, so a cleared browser asks again.
 */
import { useEffect, useState } from "react";

import { Link } from "@/i18n/navigation";
import { TERMS_SUMMARY, TERMS_VERSION } from "@/lib/terms";

const KEY = "mimir-terms-accepted";
/** Fired on accept, so announcements wait their turn instead of stacking on the card. */
export const TERMS_ACCEPTED_EVENT = "mimir:terms-accepted";

export function termsAccepted(): boolean {
  try {
    return localStorage.getItem(KEY) === TERMS_VERSION;
  } catch {
    return false;
  }
}

export default function ConsentNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(KEY) !== TERMS_VERSION);
    } catch {
      setOpen(true);
    }
  }, []);

  if (!open) return null;
  const accept = () => {
    try {
      localStorage.setItem(KEY, TERMS_VERSION);
    } catch {
      // Storage blocked: it closes for this visit and asks again next time.
    }
    setOpen(false);
    window.dispatchEvent(new Event(TERMS_ACCEPTED_EVENT));
  };

  return (
    <section
      role="region"
      aria-label="Terms of use"
      className="fixed inset-x-3 bottom-[calc(12px+var(--safe-bottom)+var(--tabbar-h,0px))] z-[70] grid gap-3 rounded-2xl border border-cream/10 bg-[#141110]/95 p-4 text-[13px] leading-snug text-muted shadow-[0_20px_60px_rgb(0_0_0/.5)] backdrop-blur-md sm:inset-x-auto sm:left-5 sm:bottom-5 sm:w-[360px]"
    >
      <p className="m-0 text-[14px] text-cream">By using Mimir you confirm that:</p>
      <ul className="m-0 grid gap-1.5 pl-4 marker:text-coral">
        {TERMS_SUMMARY.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/terms" className="text-coral underline-offset-2 hover:underline">
          Read the terms
        </Link>
        <button type="button" onClick={accept} className="rounded-full bg-coral px-4 py-2 text-[13px] font-medium text-[#160909] hover:brightness-110">
          I understand and accept
        </button>
      </div>
    </section>
  );
}
