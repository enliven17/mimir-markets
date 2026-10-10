"use client";

/** After publishing: the claim is live, with the create and delegate transactions as proof. */
import { SURFACE_DEEP } from "@/components/arena/surface";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Card";
import { Pending } from "@/components/ui/StatusPill";
import type { Published } from "./useCreateDraft";
import { explorerUrl, IS_MAINNET } from "@/lib/solana/config";
import { ExternalMark } from "@/components/ExternalMark";

export default function CreateSuccess({ published, onAnother }: { published: Published; onAnother: () => void }) {
  const t = useTranslations("arena.create");
  const tc = useTranslations("create");
  const rows = [
    published.createSig
      ? { label: t("proofCreate"), sig: published.createSig, href: explorerUrl("tx", published.createSig), where: "Solana" }
      : null,
    published.delegateSig
      ? { label: t("proofDelegate"), sig: published.delegateSig, href: `https://explorer.magicblock.app/tx/${published.delegateSig}${IS_MAINNET ? "" : "?cluster=devnet"}`, where: "ER" }
      : null,
  ].filter(Boolean) as { label: string; sig: string; href: string; where: string }[];

  return (
    <Sheet center className={`pop-in mx-auto max-w-[560px] ${SURFACE_DEEP}`}>
      <Pending>{tc("createSuccessBadgeLive")}</Pending>
      <h1 className="m-0 mt-5 font-display text-app-h1 text-cream">{t("successTitle")}</h1>
      <p className="m-0 mt-2 font-mono text-[13px] text-muted">#{published.id.toString()}</p>

      <div className="mt-7 grid gap-1.5 text-left">
        <p className="m-0 mb-1 text-[12px] text-muted">{t("proof")}</p>
        {rows.map((r) => (
          <a
            key={r.sig}
            href={r.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 rounded-xl bg-cream/[0.04] px-4 py-3 transition-colors hover:bg-cream/[0.07]"
          >
            <span className="min-w-0">
              <span className="block text-[13px] text-cream">{r.label}</span>
              <span className="block truncate font-mono text-[12px] text-muted">{r.sig.slice(0, 24)}…</span>
            </span>
            <span className="shrink-0 text-[13px] text-coral"><ExternalMark /> {r.where}</span>
          </a>
        ))}
      </div>

      <div className="mt-8 grid gap-2.5 sm:grid-cols-2">
        <Link href={`/arena/${published.id.toString()}`} className={buttonClass("primary", "sm", true)}>
          {tc("viewVS")}
        </Link>
        <button type="button" onClick={onAnother} className={buttonClass("ghost", "sm", true)}>
          {tc("createAnother")}
        </button>
      </div>
    </Sheet>
  );
}
