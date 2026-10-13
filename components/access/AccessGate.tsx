"use client";

/**
 * Invite-only gate (mainnet launch; lib/access.ts). Off on testnet: renders the
 * page as is. On, a gated route first asks for the Solana wallet and one signed
 * proof (the holder proof, lib/token-proof.ts); then /api/access says whether
 * the wallet is in: a holder of the minimum $MIMIR is let in on the spot,
 * anyone else enters an invite code. Browsing is never gated, only the screens that
 * act (GATED). The server enforces the same rule where it
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
import CouncilMark from "@/components/launch/CouncilMark";
import { mimirTokenUrl } from "@/lib/token-config";

const INVITE_ONLY = inviteOnly(ARC.network, process.env.NEXT_PUBLIC_INVITE_ONLY?.trim());
// Only the screens that act are gated: setting up and funding the Arc account, the portfolio, creating markets and
// agents, linking Telegram. Everyone can browse the arena, markets, baskets and the rest; a stake needs an account,
// and the account is set up on /wallet.
const GATED = ["/wallet", "/dashboard", "/arena/create", "/agents/new", "/launch/new", "/telegram"];
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
  const step = !a.wallet ? 0 : !a.proven ? 1 : 2;
  let body: ReactNode;
  if (step === 0) {
    body = (
      <div className="grid justify-items-center gap-4 text-center">
        <p className="m-0 max-w-[40ch] text-[15px] leading-relaxed text-muted">Connect the Solana wallet you hold $MIMIR in, or the one you will use with an invite code.</p>
        <ConnectWalletButton />
      </div>
    );
  } else if (step === 1) {
    body = (
      <div className="grid justify-items-center gap-4 text-center">
        <p className="m-0 max-w-[40ch] text-[15px] leading-relaxed text-muted">Sign one message to prove this wallet is yours. It moves no funds.</p>
        <button
          className={`${BTN} min-w-[200px]`}
          disabled={!a.canSign || busy}
          onClick={() => {
            setBusy(true);
            void a.prove().catch(() => undefined).finally(() => setBusy(false));
          }}
        >
          {busy ? "Check your wallet…" : "Sign in"}
        </button>
      </div>
    );
  } else {
    body = (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid content-start gap-3 rounded-2xl bg-cream/[0.04] p-5">
          <p className="m-0 font-mono text-[11px] uppercase tracking-[0.18em] text-coral">Have an invite</p>
          <form
            className="grid gap-2"
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
              aria-label="Invite code"
              className="min-w-0 rounded-xl bg-ink-deep px-4 py-3 text-center font-mono text-[16px] uppercase tracking-[0.06em] text-cream outline-none focus-visible:shadow-[inset_0_0_0_1px_rgb(255_81_72/.7)]"
            />
            <button type="submit" className={BTN} disabled={busy || code.trim().length < 15}>
              {busy ? "Checking…" : "Enter Mimir"}
            </button>
          </form>
          {a.error ? <p className="m-0 text-[13px] text-danger">{a.error}</p> : null}
        </div>
        <div className="grid content-start gap-3 rounded-2xl bg-cream/[0.04] p-5">
          <p className="m-0 font-mono text-[11px] uppercase tracking-[0.18em] text-coral">Or hold $MIMIR</p>
          <p className="m-0 text-[14px] leading-relaxed text-muted">
            This wallet holds less than <span className="text-cream">{min} $MIMIR</span>. Holders get in on the spot, no code needed.
          </p>
          <a href={mimirTokenUrl()} target="_blank" rel="noreferrer" className="rounded-full px-5 py-2.5 text-center text-[14px] text-cream shadow-[inset_0_0_0_1px_rgb(243_234_214/.2)] hover:bg-cream/5">
            Get $MIMIR ↗
          </a>
          <button type="button" onClick={() => void a.reload()} className="text-[13px] text-muted hover:text-cream">
            I hold it now, check again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-[calc(100svh-220px)] place-items-center py-8">
      <div className="grid w-full max-w-[640px] gap-6">
        <header className="grid justify-items-center gap-3 text-center">
          <CouncilMark size={64} />
          <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">Invite only</p>
          <h1 className="m-0 font-display text-app-h1 text-cream">Mimir is opening in waves.</h1>
          <p className="m-0 max-w-[48ch] text-[15px] leading-relaxed text-muted">
            Hold {min} $MIMIR on Solana, or use an invite code from someone already in. Everyone inside gets codes to share.
          </p>
        </header>
        <ol className="m-0 flex list-none justify-center gap-2 p-0" aria-label="Steps">
          {["Connect", "Sign", "Get in"].map((s, i) => (
            <li
              key={s}
              aria-current={i === step ? "step" : undefined}
              className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] ${i === step ? "bg-cream text-ink" : i < step ? "bg-cream/10 text-cream" : "bg-cream/[0.04] text-dim"}`}
            >
              <span className="font-mono text-[11px]">{i < step ? "✓" : `0${i + 1}`}</span>
              {s}
            </li>
          ))}
        </ol>
        <section className={`${SURFACE} grid gap-4 p-5 sm:p-7`}>{body}</section>
      </div>
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
