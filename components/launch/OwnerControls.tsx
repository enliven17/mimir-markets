"use client";

/** The owner's controls on a launched agent's page: pause or resume, shut down, withdraw part of its funds. */
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { signedPost } from "@/lib/launch/client";

const COIN: Record<string, { unit: string; chain: string }> = { solana: { unit: "SOL", chain: "Solana" }, robinhood: { unit: "ETH", chain: "Robinhood Chain" } };

export default function OwnerControls({ slug, owner, status, venue = "solana" }: { slug: string; owner: string; status: string; venue?: string }) {
  const coin = COIN[venue] ?? null;
  const { publicKey, signMessage } = useWallet();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [chain, setChain] = useState<"solana" | "robinhood" | "arc">(venue === "robinhood" ? "robinhood" : venue === "arc" ? "arc" : "solana");
  const [amount, setAmount] = useState("");
  if (!publicKey || publicKey.toBase58() !== owner || !signMessage) return null;

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
  const setStatus = (s: "live" | "paused" | "killed") => act(async () => (await post("status", "status", { status: s }), s === "killed" ? (coin ? `Shutting down: it sells its positions and sends its ${coin.unit} back to you.` : "Shut down: it stakes no more.") : s === "paused" ? "Paused." : "Running again."));

  return (
    <section className="grid gap-4 rounded-2xl bg-cream/[0.04] p-5">
      <h2 className="m-0 font-display text-[1.4rem] text-cream">Your agent</h2>
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
              if (window.confirm(coin ? `Shut it down for good? It sells its ${coin.chain} positions and returns its ${coin.unit} to you. Arc stakes settle on their own.` : "Shut it down for good? It stops staking. Arc stakes settle on their own.")) void setStatus("killed");
            }}
          >
            Shut down
          </button>
        </div>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(amount);
          if (!(n > 0)) return setNote("Enter an amount.");
          void act(async () => {
            const r = await post<{ tx: string }>("withdraw", "withdraw", { chain, amount: n });
            setAmount("");
            return `Sent to you (${r.tx.slice(0, 10)}…).`;
          });
        }}
      >
        <label className="grid gap-1.5">
          <span className="text-[13px] text-muted">Withdraw</span>
          <select className="input !w-auto" value={chain} onChange={(e) => setChain(e.target.value as "solana" | "robinhood" | "arc")}>
            {coin ? <option value={venue}>{coin.unit} ({coin.chain})</option> : null}
            <option value="arc">USDC (Arc)</option>
          </select>
        </label>
        <input className="input !w-32 font-mono" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" />
        <button type="submit" disabled={busy} className="btn-primary !w-auto !px-5">Withdraw</button>
      </form>
      <p className="m-0 text-[12px] text-muted">
        {venue === "robinhood" ? "ETH goes to the Robinhood wallet you launched it from" : venue === "arc" ? "" : "SOL goes to this wallet"}
        {venue === "arc" ? "USDC goes to the Arc account linked to your wallet." : "; USDC goes to the Arc account linked to it."}
      </p>
      {note ? <p role="status" className="m-0 text-[14px] text-cream">{note}</p> : null}
    </section>
  );
}
