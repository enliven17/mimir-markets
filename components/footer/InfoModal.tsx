"use client";

/**
 * Footer modal (`.footer-modal*`): short "How it
 * works", "About" and "Disclaimer" copy in a glass dialog instead of long
 * pages. Built on the shared Modal (focus trap, Esc, return focus).
 */
import { useTranslations } from "next-intl";
import Modal from "@/components/ui/Modal";
import { ExternalMark } from "@/components/ExternalMark";

export type InfoPanel = "how" | "about" | "disclaimer";

export const INFO_PANELS: readonly InfoPanel[] = ["how", "about", "disclaimer"];

const REPO_URL = "https://github.com/enliven17/mimir-solana";

export default function InfoModal({ panel, onClose }: { panel: InfoPanel | null; onClose: () => void }) {
  const t = useTranslations("footer");
  const key = panel ?? "how";
  return (
    <Modal open={panel !== null} onClose={onClose} title={t(`info.${key}.title`)} closeLabel={t("close")}>
      <div className="grid gap-3 text-[14px] leading-[1.6] text-muted">
        <p>{t(`info.${key}.p1`)}</p>
        <p>{t(`info.${key}.p2`)}</p>
        {key === "about" ? (
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-1 w-fit text-coral underline decoration-coral/40 underline-offset-4 hover:decoration-coral"
          >
            {t("github")} <ExternalMark />
          </a>
        ) : null}
      </div>
    </Modal>
  );
}
