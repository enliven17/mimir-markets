"use client";

/**
 * Header wallet button: the wallet-adapter multi button with a short,
 * single-line "Connect" label (the stock "Select Wallet" wraps in the bar).
 * Styling lives in the wallet-adapter block of app/globals.css.
 */
import { BaseWalletMultiButton } from "@solana/wallet-adapter-react-ui";

const LABELS = {
  "change-wallet": "Change wallet",
  connecting: "Connecting…",
  "copy-address": "Copy address",
  copied: "Copied",
  disconnect: "Disconnect",
  "has-wallet": "Connect",
  "no-wallet": "Connect",
} as const;

export default function WalletButton() {
  return <BaseWalletMultiButton labels={LABELS} />;
}
