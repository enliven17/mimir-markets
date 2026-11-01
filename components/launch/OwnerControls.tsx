"use client";

/**
 * The owner's controls on an agent's page: fund its Arc wallet with USDC from the connected wallet, withdraw it back,
 * pause or resume, shut down.
 */
import { useState } from "react";
import { numberToHex, type Address } from "viem";

import { sendEvmTransaction } from "@/components/arc/useEvmWallet";
import { useMimirWallet } from "@/hooks/useMimirWallet";
import { ARC } from "@/lib/arc/config";
import { signedPost } from "@/lib/launch/client";

/** Native USDC on Arc has 18 decimals. */
const usdcWei = (n: number) => BigInt(Math.round(n * 1e6)) * 1_000_000_000_000n;

export default function OwnerControls({ slug, owner, status, arc }: { slug: string; owner: string; status: string; arc: string }) {
  const { address, signMessage } = useMimirWallet();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [fund, setFund] = useState("");
  const [amount, setAmount] = useState("");
  if (!address || address !== owner || !signMessage) return null;

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setNote(null);
    try {
      setNote(await fn());
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };
  const post = <T,>(path: string, action: "status" | "withdraw", body: unknown) => signedPost<T>(`/api/launch/${slug}/${path}`, { owner, signMessage, action, agent: slug, body });
  const setStatus = (s: "live" | "paused" | "killed") => act(async () => (await post("status", "status", { status: s }), s === "killed" ? "Shut down: it stakes no more. Withdraw its USDC any time." : s === "paused" ? "Paused." : "Running again."));

  return (
    <section className="grid gap-4 rounded-2xl bg-cream/[0.04] p-5">
      <h2 className="m-0 font-display text-[1.4rem] text-cream">Your agent</h2>
      {status !== "killed" ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(fund);
            if (!(n > 0)) return setNote("Enter an amount.");
            void act(async () => {
              const tx = await sendEvmTransaction(ARC.chain.id, { from: address, to: arc as Address, value: numberToHex(usdcWei(n)) });
              setFund("");
              return `Sent ${n} USDC to its Arc wallet (${tx.slice(0, 10)}…). It stakes from it.`;
            });
          }}
        >
          <label className="grid gap-1.5">
            <span className="text-[13px] text-muted">Fund it (USDC on Arc)</span>
            <input className="input !w-32 font-mono" inputMode="decimal" placeholder="0.00" value={fund} onChange={(e) => setFund(e.target.value)} aria-label="USDC to send" />
          </label>
          <button type="submit" disabled={busy} className="btn-primary !w-auto !px-5">Send USDC</button>
        </form>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(amount);
          if (!(n > 0)) return setNote("Enter an amount.");
          void act(async () => {
            const r = await post<{ tx: string }>("withdraw", "withdraw", { amount: n });
            setAmount("");
            return `Sent to you (${r.tx.slice(0, 10)}…).`;
          });
        }}
      >
        <label className="grid gap-1.5">
          <span className="text-[13px] text-muted">Withdraw (USDC on Arc)</span>
          <input className="input !w-32 font-mono" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="USDC to withdraw" />
        </label>
        <button type="submit" disabled={busy} className="btn-ghost !w-auto !px-5">Withdraw</button>
      </form>
      <p className="m-0 text-[12px] text-muted">Withdrawals go to this wallet. 0.05 USDC stays for its gas.</p>
      {status !== "killed" ? (
        <div className="flex flex-wrap gap-3">
          {status === "live" ? (
            <button type="button" disabled={busy} className="btn-ghost !w-auto !px-5" onClick={() => void setStatus("paused")}>Pause</button>
          ) : status === "paused" ? (
            <button type="button" disabled={busy} className="btn-primary !w-auto !px-5" onClick={() => void setStatus("live")}>Resume</button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            className="text-[14px] text-coral hover:underline"
            onClick={() => {
              if (window.confirm("Shut it down for good? It stops staking. Open stakes settle on their own, and you can withdraw its USDC any time.")) void setStatus("killed");
            }}
          >
            Shut down
          </button>
        </div>
      ) : null}
      {note ? <p role="status" className="m-0 text-[14px] text-cream">{note}</p> : null}
    </section>
  );
}
