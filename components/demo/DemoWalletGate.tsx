"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletSheet } from "@/components/wallet/WalletSheetProvider";
import { authorizePreview, demoGet } from "@/lib/demo/client";
import { SURFACE } from "@/components/arena/surface";

export default function DemoWalletGate({ children }: { children: ReactNode }) {
  const { publicKey, signMessage } = useWallet();
  const { open } = useWalletSheet();
  const owner = publicKey?.toBase58() ?? "";
  const [verified, setVerified] = useState("");
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setVerified(""); setError("");
    if (!owner) { setChecking(false); return; }
    setChecking(true);
    void demoGet(owner).then((r) => { if (!cancelled && r.ok) setVerified(owner); })
      .catch(() => { if (!cancelled) setError("Could not check your preview. Try again."); })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [owner]);
  async function verify() {
    if (!owner || !signMessage) { setError("Connect a Solana wallet that supports message signing."); return; }
    setBusy(true); setError("");
    try { await authorizePreview(owner, signMessage); setVerified(owner); }
    catch (e) { setError(e instanceof Error ? e.message : "Wallet verification failed."); }
    finally { setBusy(false); }
  }
  if (owner && verified === owner) return <div key={owner}>{children}</div>;
  return <section className={`${SURFACE} grid gap-3 p-6`} aria-label="Preview wallet access">
    <h2 className="m-0 font-display text-[1.6rem] text-cream">Connect your wallet to try Mimir Preview</h2>
    <p className="m-0 max-w-[65ch] text-[14px] text-muted">Connect a Solana wallet and sign a message to verify ownership. Your 3-agent allowance belongs to this wallet. All trading funds are virtual; no deposit or token holding is required.</p>
    {error ? <p role="alert" className="m-0 text-[13px] text-coral">{error}</p> : null}
    <button disabled={checking || busy} onClick={() => owner ? void verify() : open()} className="btn-primary !w-auto justify-self-start !px-5 disabled:opacity-50">{checking ? "Checking wallet…" : busy ? "Verify in your wallet…" : owner ? "Verify wallet for Preview" : "Connect wallet for Preview"}</button>
  </section>;
}
