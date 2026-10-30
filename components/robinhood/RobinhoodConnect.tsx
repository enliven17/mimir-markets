"use client";

/** Connect (or disconnect) a Robinhood Chain wallet: Robinhood Wallet by QR, or the browser's own wallet. `base`: any EVM wallet, for Base. */
import { useEffect, useState } from "react";

import { useRobinhoodWallet } from "./useRobinhoodWallet";

const BTN = "press rounded-full bg-panel-raised px-4 py-2 text-[13px] text-cream disabled:opacity-60";
const short = (k: string) => `${k.slice(0, 6)}…${k.slice(-4)}`;

export default function RobinhoodConnect({ base = false }: { base?: boolean }) {
  const rh = useRobinhoodWallet();
  const [error, setError] = useState<string | null>(null);
  // After mount, so the server render matches.
  const [hasInjected, setHasInjected] = useState(false);
  useEffect(() => setHasInjected(Boolean((window as unknown as { ethereum?: unknown }).ethereum)), []);

  const connect = (via: "injected" | "walletconnect") => {
    setError(null);
    rh.connect(via).catch((err: { message?: string }) => setError(/rejected|closed/i.test(err?.message ?? "") ? "The request was cancelled." : (err?.message ?? "Could not connect.")));
  };

  if (rh.address) {
    return (
      <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-muted">
        {base ? "EVM wallet" : "Robinhood wallet"} <span className="font-mono text-cream">{short(rh.address)}</span>
        <button type="button" onClick={() => void rh.disconnect()} className="text-muted underline underline-offset-2 hover:text-cream">
          Disconnect
        </button>
      </p>
    );
  }
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {rh.walletConnectReady ? (
          <button type="button" disabled={rh.connecting} onClick={() => connect("walletconnect")} className={BTN}>
            {rh.connecting ? "Approve in your wallet…" : base ? "Connect with WalletConnect" : "Connect Robinhood Wallet"}
          </button>
        ) : null}
        {hasInjected ? (
          <button type="button" disabled={rh.connecting} onClick={() => connect("injected")} className={BTN}>
            Browser wallet (EVM)
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="m-0 text-[12px] text-coral">
          {error}
        </p>
      ) : null}
    </div>
  );
}
