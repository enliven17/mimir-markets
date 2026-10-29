"use client";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { walletProofHeaders, useWalletProof } from "@/components/wallet/useWalletProof";
import { signedPost } from "@/lib/launch/client";
type Inbox = { follows: string[]; items: { id: string; text: string; at: number; href: string }[] };
const requests = new Map<string, { until: number; promise: Promise<Inbox> }>();
function load(wallet: string) {
  const cached = requests.get(wallet); if (cached && cached.until > Date.now()) return cached.promise;
  const promise = fetch("/api/follows", { headers: walletProofHeaders(wallet) }).then(async (r) => { if (!r.ok) throw new Error("Could not load your watchlist. Verify your wallet and try again."); return r.json() as Promise<Inbox>; });
  requests.set(wallet, { until: Date.now() + 15_000, promise });
  if (requests.size > 10) requests.delete(requests.keys().next().value!);
  return promise;
}
export function useFollows() {
  const proof = useWalletProof();
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const { prove } = proof;
  const proven = proof.wallet === wallet && proof.proven, canSign = !!wallet && proof.canSign;
  const [inbox, setInbox] = useState<Inbox | null>(null), [error, setError] = useState("");
  useEffect(() => {
    setInbox(null); setError("");
    if (!wallet || !proven) return;
    let current = true;
    const refresh = () => { if (document.visibilityState === "visible") void load(wallet).then((v) => { if (current) { setInbox(v); setError(""); } }).catch((e) => { if (current) setError(e.message); }); };
    refresh(); const timer = setInterval(refresh, 60_000); window.addEventListener("mimir-follows", refresh);
    return () => { current = false; clearInterval(timer); window.removeEventListener("mimir-follows", refresh); };
  }, [wallet, proven]);
  const invalidate = useCallback(() => { if (wallet) requests.delete(wallet); window.dispatchEvent(new Event("mimir-follows")); }, [wallet]);
  return { wallet, proven, prove, canSign, inbox, error, invalidate };
}
export default function FollowButton({ target, label = "Follow" }: { target: string; label?: string }) {
  const { signMessage } = useWallet();
  const { wallet, proven, prove, canSign, inbox, error, invalidate } = useFollows();
  const [busy, setBusy] = useState(false), [note, setNote] = useState("");
  const following = inbox?.follows.includes(target) ?? false;
  return <span className="grid justify-items-start gap-1"><button type="button" disabled={busy || !wallet || !canSign} aria-pressed={following} className="rounded-full bg-cream/10 px-3 py-2 text-[12px] text-cream disabled:opacity-50" onClick={async () => {
    if (!wallet || !signMessage) return; setBusy(true); setNote("");
    try { if (!proven || !inbox) { await prove(); requests.delete(wallet); window.dispatchEvent(new Event("mimir-follows")); setNote("Wallet verified. Choose Follow once your watchlist loads."); }
      else { await signedPost("/api/follows", { owner: wallet, signMessage, action: "follow", agent: "discovery", body: { target, active: !following } }); invalidate(); } }
    catch (e) { setNote(e instanceof Error ? e.message : "Could not update follow."); } finally { setBusy(false); }
  }}>{busy ? "Updating…" : following ? `Following · ${label}` : label}</button>{note || error ? <span role="status" className="max-w-64 text-[11px] text-muted">{note || error}</span> : null}{!wallet ? <span className="text-[11px] text-muted">Connect a Solana wallet to follow.</span> : null}</span>;
}
