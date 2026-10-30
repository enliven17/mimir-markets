"use client";

/** Connect (or disconnect) the EVM wallet through ConnectKit: Robinhood Wallet, a browser extension or a phone wallet. `base`: for Base. */
import { useState } from "react";

import { useRobinhoodWallet } from "./useRobinhoodWallet";

const BTN = "press rounded-full bg-panel-raised px-4 py-2 text-[13px] text-cream disabled:opacity-60";
const short = (k: string) => `${k.slice(0, 6)}…${k.slice(-4)}`;

export default function RobinhoodConnect({ base = false }: { base?: boolean }) {
  const rh = useRobinhoodWallet();
  const [error, setError] = useState<string | null>(null);
  const connect = () => {
    setError(null);
    rh.connect(base ? "base" : "robinhood").catch((err: { message?: string }) =>
      setError(/rejected|closed|no wallet was connected/i.test(err?.message ?? "") ? "The request was cancelled." : (err?.message ?? "Could not connect.")),
    );
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
        <button type="button" disabled={rh.connecting} onClick={connect} className={BTN}>
          {rh.connecting ? "Approve in your wallet…" : base ? "Connect EVM wallet" : "Connect Robinhood Wallet"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="m-0 text-[12px] text-coral">
          {error}
        </p>
      ) : null}
    </div>
  );
}
