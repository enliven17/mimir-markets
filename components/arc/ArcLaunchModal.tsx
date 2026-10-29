"use client";

/**
 * Everyone, once: Mimir is live on Arc mainnet, and a market is only as good as its terms (question, deadline,
 * source). A first visit reads the terms card first; the modal follows once they are accepted. Dismissal is
 * remembered in localStorage; a blocked or cleared store just means it shows again, never an error. Waits a beat
 * after load so it does not fight the landing's own entrance.
 */
import { PRODUCT_NOTICE_EVENT, productNoticeSeen } from "@/components/app/ProductNotice";
import { TERMS_ACCEPTED_EVENT, termsAccepted } from "@/components/legal/ConsentNotice";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import Modal from "@/components/ui/Modal";
import { Link } from "@/i18n/navigation";
import { NetworkLogos } from "./NetworkLogos";

const KEY = "mimir:mainnet-live-seen";

export default function ArcLaunchModal() {
  const t = useTranslations("arcLaunch");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = localStorage.getItem(KEY) === "1";
    } catch {}
    if (seen) return;
    let id: ReturnType<typeof setTimeout> | undefined;
    const show = () => (id = setTimeout(() => setOpen(true), termsAccepted() ? 1200 : 400));
    // A first visit accepts the terms card (components/legal/ConsentNotice.tsx) and reads the product notice
    // (components/app/ProductNotice.tsx) first; then this follows.
    if (!productNoticeSeen()) window.addEventListener(PRODUCT_NOTICE_EVENT, show, { once: true });
    else if (termsAccepted()) show();
    else window.addEventListener(TERMS_ACCEPTED_EVENT, show, { once: true });
    return () => {
      clearTimeout(id);
      window.removeEventListener(PRODUCT_NOTICE_EVENT, show);
      window.removeEventListener(TERMS_ACCEPTED_EVENT, show);
    };
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
      <div className="grid gap-3">
        <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">{t("eyebrow")}</p>
        <NetworkLogos className="h-6 max-sm:hidden" />
        <p className="m-0 text-[14px] leading-relaxed text-muted">{t("body")}</p>
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {(t.raw("points") as string[]).map((p) => (
            <li key={p} className="flex items-center gap-2 text-[14px] text-cream">
              <span aria-hidden className="h-1.5 w-1.5 bg-red" />
              {p}
            </li>
          ))}
        </ul>
        <div className="grid gap-1 rounded-xl bg-panel px-4 py-3 shadow-[inset_0_0_0_1px_rgb(255_81_72/.45)]">
          <p className="m-0 flex items-center gap-2 text-[14px] font-medium text-cream">
            <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-coral text-[12px] font-bold text-[#160909]">!</span>
            {t("warnTitle")}
          </p>
          <p className="m-0 text-[13px] leading-relaxed text-muted">{t("warn")}</p>
        </div>
      </div>
    </Modal>
  );
}
