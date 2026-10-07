"use client";

/**
 * First visit only: tells people Mimir now runs on Arc (testnet), funded from
 * Solana. Dismissal is remembered in localStorage; a blocked or cleared store
 * just means it shows again, never an error. Waits a beat after load so it
 * does not fight the landing's own entrance.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import Modal from "@/components/ui/Modal";
import { Link } from "@/i18n/navigation";
import { NetworkLogos } from "./NetworkLogos";

const KEY = "mimir:arc-launch-seen";

export default function ArcLaunchModal() {
  const t = useTranslations("arcLaunch");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(KEY) === "1";
    } catch {}
    if (seen) return;
    const id = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(id);
  }, []);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("title")}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={close} className="press rounded-full bg-panel-raised px-5 py-2.5 text-[14px] text-cream">
            {t("later")}
          </button>
          <Link href="/arena" onClick={close} className="rounded-full bg-coral px-5 py-2.5 text-[14px] font-medium text-[#160909]">
            {t("cta")}
          </Link>
        </div>
      }
    >
      <div className="grid gap-4">
        <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">{t("eyebrow")}</p>
        <NetworkLogos className="h-7" />
        <p className="m-0 text-[14px] leading-relaxed text-muted">{t("body")}</p>
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {(t.raw("points") as string[]).map((p) => (
            <li key={p} className="flex items-center gap-2 text-[14px] text-cream">
              <span aria-hidden className="h-1.5 w-1.5 bg-red" />
              {p}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
