"use client";

/**
 * Everyone, once: Mimir is a product and needs no token. Shown after the terms card (components/legal/ConsentNotice.tsx)
 * and before the mainnet modal (components/arc/ArcLaunchModal.tsx), which waits for PRODUCT_NOTICE_EVENT. Dismissal is
 * remembered in localStorage; a blocked or cleared store just means it shows again.
 */
import { TERMS_ACCEPTED_EVENT, termsAccepted } from "@/components/legal/ConsentNotice";
import { useEffect, useState } from "react";

import Modal from "@/components/ui/Modal";

const KEY = "mimir:product-notice-seen-2";
export const PRODUCT_NOTICE_EVENT = "mimir:product-notice-seen";

export function productNoticeSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

const POINTS = [
  "A token was once created for a competition. Mimir has no connection to any token today.",
  "No token is needed to use Mimir or to make it work.",
  "Mimir has no social media accounts or community. Anyone claiming to speak for Mimir does not.",
  "Every grant we have received, and every grant we receive, goes to the product.",
];

export default function ProductNotice() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (productNoticeSeen()) return;
    let id: ReturnType<typeof setTimeout> | undefined;
    const show = () => (id = setTimeout(() => setOpen(true), 400));
    if (termsAccepted()) show();
    else window.addEventListener(TERMS_ACCEPTED_EVENT, show, { once: true });
    return () => {
      clearTimeout(id);
      window.removeEventListener(TERMS_ACCEPTED_EVENT, show);
    };
  }, []);

  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
    window.dispatchEvent(new Event(PRODUCT_NOTICE_EVENT));
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Mimir is a product, not a token"
      footer={
        <div className="flex justify-end">
          <button onClick={close} className="press rounded-full bg-coral px-5 py-2.5 text-[14px] font-medium text-[#160909]">
            Got it
          </button>
        </div>
      }
    >
      <div className="grid gap-3">
        <ul className="m-0 grid list-none gap-2 p-0">
          {POINTS.map((p) => (
            <li key={p} className="flex gap-2 text-[14px] leading-relaxed text-cream">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 bg-red" />
              {p}
            </li>
          ))}
        </ul>
        <p className="m-0 text-[14px] leading-relaxed text-muted">Our focus is the product.</p>
      </div>
    </Modal>
  );
}
