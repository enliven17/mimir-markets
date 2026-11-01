"use client";

/**
 * Connect sheet in the glass look: pick the network (Base first, the main network; then Arc), then ConnectKit opens with every EVM wallet
 * (browser extensions over EIP-6963, MetaMask, Coinbase Wallet, WalletConnect for phones). Both networks share one
 * connection: the same address is the user's account on each; the pick only labels it, and each transaction switches
 * the wallet to its chain right before sending.
 *
 * Keyboard, focus trap, Esc, aria-modal and pausing Lenis come from Modal.
 */
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import Modal from "@/components/ui/Modal";
import { connectEvm, type EvmChainIntent } from "@/components/arc/useEvmWallet";
import { MARKET_CHAINS } from "@/lib/chains/registry";

const rowClass =
  "group flex min-h-[58px] w-full items-center gap-3.5 rounded-2xl bg-cream/[0.04] px-3.5 py-2.5 text-left transition-[background-color,transform] duration-200 ease-out hover:bg-panel-raised focus-visible:bg-panel-raised active:scale-[.985] disabled:cursor-wait";

/** Closing ConnectKit without picking a wallet is not an error worth a toast. */
const cancelled = (e: unknown) => /no wallet was connected|reject|denied|cancel|closed/i.test(e instanceof Error ? e.message : "");

export default function ConnectSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("wallet");

  const pick = (intent: EvmChainIntent) => {
    onClose();
    connectEvm(intent).then(
      () => toast.success(t(intent === "arc" ? "arcConnected" : "baseConnected")),
      (e: unknown) => {
        if (!cancelled(e)) toast.error(t(intent === "arc" ? "arcFailed" : "baseFailed"));
      },
    );
  };

  const rows = [
    ["base", "/networks/base-icon.svg", t("pickBase"), t("pickBaseHint")],
    ["arc", "/networks/arc-icon.svg", t("pickArc"), t("pickArcHint")],
  ] as const;

  return (
    <Modal open={open} onClose={onClose} title={t("pickTitle")} variant="sheet" closeLabel={t("close")}>
      <p className="text-[14px] leading-snug text-muted">{t("pickLead")}</p>
      <ul className="mt-5 grid gap-2">
        {rows.filter(([key]) => MARKET_CHAINS.enabled.includes(key)).map(([key, icon, name, hint]) => (
          <li key={key}>
            <button type="button" onClick={() => pick(key)} className={rowClass}>
              {/* eslint-disable-next-line @next/next/no-img-element -- small static network icons */}
              <img src={icon} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-xl" />
              <span className="grid min-w-0 flex-1 gap-1">
                <span className="font-display text-[1.3rem] leading-none text-cream">{MARKET_CHAINS.chains[key].name}</span>
                <span className="text-[13px] leading-snug text-muted">{hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-6 flex items-center gap-2 text-[12px] text-muted">
        <span aria-hidden className="h-[5px] w-[5px] rounded-full bg-coral" />
        {MARKET_CHAINS.chains[MARKET_CHAINS.defaultChain].network === "testnet" ? "Testnet: test USDC and ETH. Connecting moves no funds." : t("footnote")}
      </p>
    </Modal>
  );
}
