"use client";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMimirWallet } from "@/hooks/useMimirWallet";
import { signedPost } from "@/lib/launch/client";
import { sendWalletTransfer } from "@/lib/solana/transfers";
import { explorerUrl } from "@/lib/solana/config";

export default function SolanaOwnerControls({ slug, owner, status, solana }: { slug: string; owner: string; status: string; solana?: string | null; arc?: string | null; base?: string | null }) {
  const wallet = useWallet();
  const { address, signMessage } = useMimirWallet();
  const [busy, setBusy] = useState(false), [note, setNote] = useState<string | null>(null), [tx, setTx] = useState<string | null>(null);
  const [fund, setFund] = useState(""), [gas, setGas] = useState(""), [amount, setAmount] = useState("");
  if (!address || !signMessage || address !== owner || !solana) return null;
  const run = async (f: () => Promise<string>) => { setBusy(true); setNote(null); setTx(null); try { setNote(await f()); } catch (e) { setNote(e instanceof Error ? e.message : "The operation could not be confirmed."); } finally { setBusy(false); } };
  const change = (next: "live" | "paused" | "killed") => run(async () => {
    await signedPost(`/api/launch/${slug}/status`, { owner, signMessage, action: "status", agent: slug, body: { status: next } });
    return next === "live" ? "Agent resumed." : next === "paused" ? "Agent paused." : "Agent shut down. Free funds can still be withdrawn.";
  });
  return <section className="grid gap-4 rounded-2xl bg-cream/[0.04] p-5">
    <h2 className="m-0 font-display text-[1.4rem] text-cream">Your agent</h2>
    <p className="m-0 text-[13px] text-muted">Solana Devnet · test assets only. Your agent signs its own stakes within the rules you chose.</p>
    {status !== "killed" ? <>
      <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void run(async () => { const sig = await sendWalletTransfer(wallet, solana, fund, "usdc"); setTx(sig); setFund(""); return "Test USDC sent to the agent."; }); }}>
        <label className="grid gap-1.5 text-[13px] text-muted">Fund it (test USDC)<input className="input !w-32 font-mono" inputMode="decimal" placeholder="2.00" value={fund} onChange={e => setFund(e.target.value)} aria-label="USDC to send" /></label>
        <button type="submit" disabled={busy} className="btn-primary !w-auto !px-5">Send USDC</button>
      </form>
      <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void run(async () => { const sig = await sendWalletTransfer(wallet, solana, gas, "sol"); setTx(sig); setGas(""); return "Devnet SOL sent for gas."; }); }}>
        <label className="grid gap-1.5 text-[13px] text-muted">Gas (devnet SOL)<input className="input !w-32 font-mono" inputMode="decimal" placeholder="0.01" value={gas} onChange={e => setGas(e.target.value)} aria-label="SOL to send for gas" /></label>
        <button type="submit" disabled={busy} className="btn-ghost !w-auto !px-5">Send SOL</button>
      </form>
    </> : null}
    <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void run(async () => {
      const r = await signedPost<{ tx: string }>(`/api/launch/${slug}/withdraw`, { owner, signMessage, action: "withdraw", agent: slug, body: { amount: Number(amount), chain: "solana", asset: "usdc" } });
      setTx(r.tx); setAmount(""); return "Free test USDC sent to your wallet.";
    }); }}>
      <label className="grid gap-1.5 text-[13px] text-muted">Withdraw (test USDC)<input className="input !w-32 font-mono" inputMode="decimal" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} aria-label="USDC to withdraw" /></label>
      <button type="submit" disabled={busy} className="btn-ghost !w-auto !px-5">Withdraw</button>
    </form>
    <p className="m-0 text-[12px] text-muted">Withdrawals go to your signing wallet. Open stakes remain in the program until settlement.</p>
    {status !== "killed" ? <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} className="btn-ghost !w-auto !px-5" onClick={() => void change(status === "live" ? "paused" : "live")}>{status === "live" ? "Pause" : "Resume"}</button>
      <button type="button" disabled={busy} className="text-[14px] text-coral hover:underline" onClick={() => { if (window.confirm("Shut this agent down? It stops taking new stakes. You can still withdraw free funds.")) void change("killed"); }}>Shut down</button>
    </div> : null}
    {note ? <p role="status" className="m-0 text-[14px] text-cream">{note}</p> : null}
    {tx ? <a className="text-[13px] text-coral hover:underline" href={explorerUrl("tx", tx)} target="_blank" rel="noreferrer">View transaction on Solana Explorer ↗</a> : null}
  </section>;
}
