"use client";

/**
 * Invite-only gate (mainnet launch; lib/access.ts). Off on testnet: renders the
 * page as is. On, a gated route first asks for the Solana wallet and one signed
 * proof (the holder proof, lib/token-proof.ts); then /api/access says whether
 * the wallet is in: a holder of the minimum $MIMIR is let in on the spot,
 * anyone else enters an invite code. Public pages (home, docs, token, council,
 * stats, legal) are never gated. The server enforces the same rule where it
 * acts for a wallet (binding an Arc account), so skipping this UI gains nothing.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { SURFACE } from "@/components/arena/surface";
import { holderProofHeaders, useHolderTier } from "@/components/token/useHolderTier";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import { usePathname } from "@/i18n/navigation";
import { inviteOnly, type AccessStatus } from "@/lib/access";
import { inviteKind, xIntentUrl } from "@/lib/invite-share";
import { ARC } from "@/lib/arc/config";

const INVITE_ONLY = inviteOnly(ARC.network, process.env.NEXT_PUBLIC_INVITE_ONLY?.trim());
const GATED = ["/arena", "/wallet", "/dashboard", "/agents/new", "/baskets", "/copy", "/campaign", "/telegram"];
const BTN = "rounded-full bg-coral px-5 py-2.5 text-[14px] font-medium text-[#160909] disabled:opacity-60";

export function useAccess() {
  const { wallet, proven, canSign, prove } = useHolderTier();
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!wallet || !proven) return setStatus(null);
    try {
      const res = await fetch("/api/access", { headers: holderProofHeaders(wallet), cache: "no-store" });
      setStatus(res.ok ? ((await res.json()) as AccessStatus) : null);
    } catch {
      setStatus(null);
    }
  }, [wallet, proven]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const redeem = useCallback(
    async (code: string) => {
      setError(null);
      const res = await fetch("/api/access/redeem", {
        method: "POST",
        headers: { "content-type": "application/json", ...holderProofHeaders(wallet) },
        body: JSON.stringify({ code }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; status?: AccessStatus };
      if (!res.ok) return setError(json.error ?? "Redeeming failed.");
      if (json.status) setStatus(json.status);
    },
    [wallet],
  );

  return { wallet, proven, canSign, prove, status, error, redeem, reload };
}

export default function AccessGate({ children }: { children: ReactNode }) {
  const path = usePathname();
  const gated = INVITE_ONLY && GATED.some((p) => path === p || path.startsWith(`${p}/`));
  if (!gated) return <>{children}</>;
  return <Gate>{children}</Gate>;
}

function Gate({ children }: { children: ReactNode }) {
  const a = useAccess();
  const [code, setCode] = useState("");
  // A shared invite (/i/<code>) arrives as ?invite=CODE: fill it in.
  useEffect(() => {
    const fromLink = inviteKind(new URLSearchParams(window.location.search).get("invite") ?? "");
    if (fromLink?.kind === "access") setCode(fromLink.code);
  }, []);
  const [busy, setBusy] = useState(false);
  if (a.status?.allowed) return <>{children}</>;

  const min = (a.status?.minMimir ?? 5_000_000).toLocaleString("en-US");
  let body: ReactNode;
  if (!a.wallet) {
    body = (
      <>
        <p className="m-0 text-[14px] leading-relaxed text-muted">Connect the Solana wallet you hold $MIMIR in, or the one you will use with an invite code.</p>
        <ConnectWalletButton />
      </>
    );
  } else if (!a.proven) {
    body = (
      <>
        <p className="m-0 text-[14px] leading-relaxed text-muted">Sign one message to prove this wallet is yours. It moves no funds.</p>
        <button
          className={BTN}
          disabled={!a.canSign || busy}
          onClick={() => {
            setBusy(true);
            void a.prove().catch(() => undefined).finally(() => setBusy(false));
          }}
        >
          {busy ? "Check your wallet…" : "Sign in"}
        </button>
      </>
    );
  } else {
    body = (
      <>
        <p className="m-0 text-[14px] leading-relaxed text-muted">
          This wallet holds less than {min} $MIMIR. Enter an invite code from a holder to get in; you do not need $MIMIR for it.
        </p>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void a.redeem(code).finally(() => setBusy(false));
          }}
        >
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="MIMIR-XXXX-XXXX"
            autoCapitalize="characters"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-xl bg-ink-deep px-4 py-3 font-mono text-[15px] uppercase text-cream outline-none focus-visible:shadow-[inset_0_0_0_1px_rgb(255_81_72/.7)]"
          />
          <button type="submit" className={BTN} disabled={busy || code.trim().length < 15}>
            {busy ? "Checking…" : "Enter"}
          </button>
        </form>
        {a.error ? <p className="m-0 text-[13px] text-danger">{a.error}</p> : null}
      </>
    );
  }

  return (
    <div className="mx-auto grid max-w-[560px] gap-6 py-10">
      <header className="grid gap-2">
        <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">Invite only</p>
        <h1 className="m-0 font-display text-app-h1 text-cream">Mimir is opening in waves.</h1>
        <p className="m-0 text-[15px] leading-relaxed text-muted">
          Hold {min} $MIMIR on Solana to get in, or use an invite code from someone who is already in. Everyone inside gets codes to share.
        </p>
      </header>
      <section className={`${SURFACE} grid gap-4 p-5 sm:p-6`}>{body}</section>
    </div>
  );
}

/** A member's invite codes, for the dashboard. Nothing when the app is open or the wallet has none. */
export function InvitesPanel() {
  const a = useAccess();
  const [copied, setCopied] = useState<string | null>(null);
  if (!INVITE_ONLY || !a.status?.allowed) return null;
  // New members' codes unlock after a few days (lib/access.ts inviteMintAllowance).
  if (!a.status.invites.length) {
    const at = a.status.invitesUnlockAt;
    return at ? (
      <section aria-label="Your invites" className={`${SURFACE} grid gap-2 p-5`}>
        <h2 className="m-0 text-[15px] text-cream">Your invite codes</h2>
        <p className="m-0 text-[13px] text-muted">They unlock on {new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.</p>
      </section>
    ) : null;
  }
  return (
    <section aria-label="Your invites" className={`${SURFACE} grid gap-3 p-5`}>
      <h2 className="m-0 text-[15px] text-cream">Your invite codes</h2>
      <p className="m-0 text-[13px] text-muted">Each works once. The person you send it to does not need $MIMIR.</p>
      <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
        {a.status.invites.map((inv) => (
          <li key={inv.code} className="flex items-center justify-between gap-3 rounded-xl bg-panel px-4 py-3">
            <span className={`font-mono text-[15px] ${inv.used ? "text-dim line-through" : "text-cream"}`}>{inv.code}</span>
            {inv.used ? (
              <span className="text-[12px] text-dim">used</span>
            ) : (
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(inv.code).then(() => setCopied(inv.code))}
                  className="text-[12px] text-coral hover:underline"
                >
                  {copied === inv.code ? "Copied" : "Copy"}
                </button>
                {/* X's composer, prefilled; the /i/<code> link brings the invite card (lib/invite-share.ts). */}
                <a href={xIntentUrl("access", inv.code)} target="_blank" rel="noreferrer" className="text-[12px] text-coral hover:underline">
                  Share on X
                </a>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
