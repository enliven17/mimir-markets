"use client";

/**
 * /wallet body: connect the Solana wallet, create (or log in to) the passkey
 * Arc account, link the two, save a recovery phrase, then move USDC between
 * Solana and Arc. Or, signed in with an Arc wallet instead (ArcNativeSteps), spend
 * the wallet's USDC within a cap. docs/ARC.md is the design.
 */
import { useEffect, useState } from "react";

import { SURFACE } from "@/components/arena/surface";
import Skeleton from "@/components/ui/Skeleton";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import { ARC, arcExplorerUrl } from "@/lib/arc/config";
import { formatUsdcUnits } from "@/lib/arc/encoding";
import { SOLANA_CLUSTER } from "@/lib/solana/config";
import { loadArcAccount } from "@/lib/arc/lazy";
import ArcNativeSteps from "./ArcNativeSteps";
import { markRecoveryOn, readRecoveryFlag, RecoverWithPhrase, RecoverySetup, type RecoveryFlag } from "./RecoveryPanel";
import TransferPanel from "./TransferPanel";
import { useArcBalances } from "./useArcBalances";
import { useArcWallet, type ArcWallet } from "./useArcWallet";

const short = (k: string) => `${k.slice(0, 6)}…${k.slice(-4)}`;
const BTN_PRIMARY = "rounded-full bg-coral px-5 py-2.5 text-[14px] font-medium text-[#160909] disabled:opacity-60";
const BTN_SECONDARY = "press rounded-full bg-panel-raised px-5 py-2.5 text-[14px] text-cream disabled:opacity-60";

export default function ArcWalletClient() {
  return <ArcWalletView w={useArcWallet()} />;
}

/**
 * The wallet steps for a given wallet state. `bare` drops the page header, for
 * Portfolio, which shows these steps in place until the account exists.
 */
type EntryMode = "solana" | "arc";
const MODE_KEY = "mimir:entry-mode";

/** Which way in this browser uses: remembered, else Arc when only an Arc wallet is connected. */
function useEntryMode(w: ArcWallet): [EntryMode, (m: EntryMode) => void] {
  const [mode, setMode] = useState<EntryMode>("solana");
  const evmOnly = Boolean(w.evm && !w.solana);
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(MODE_KEY);
    } catch {
      /* storage blocked */
    }
    if (saved === "arc" || saved === "solana") setMode(saved);
    else if (evmOnly) setMode("arc");
  }, [evmOnly]);
  const choose = (m: EntryMode) => {
    setMode(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* storage blocked: not remembered */
    }
  };
  return [mode, choose];
}

export function ArcWalletView({ w, bare = false }: { w: ArcWallet; bare?: boolean }) {
  const { arcUnits, solanaUnits, reload } = useArcBalances(w.session?.address ?? null, w.solana);
  const [recovery, setRecovery] = useState<RecoveryFlag>(null);
  const [mode, setMode] = useEntryMode(w);
  const clusterMismatch = ARC.solana.cluster !== SOLANA_CLUSTER;

  useEffect(() => {
    const address = w.session?.address;
    const flag = address ? readRecoveryFlag(address) : null;
    setRecovery(flag);
    // The flag is per browser: on another device (or with storage cleared) ask the chain, so a phrase is never
    // registered twice (each registration is gas we sponsor).
    if (!address || flag === "on") return;
    let live = true;
    void loadArcAccount()
      .then((m) => m.hasRecoveryOwner(address))
      .then((on) => {
        if (!live || !on) return;
        markRecoveryOn(address);
        setRecovery("on");
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [w.session]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      {bare ? null : (
        <header className="grid gap-2">
          <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">
            Arc · {ARC.network === "testnet" ? "testnet" : "mainnet"}
          </p>
          <h1 className="m-0 font-display text-app-h1 text-cream">Your Arc wallet.</h1>
          <p className="m-0 max-w-[62ch] text-[15px] leading-relaxed text-muted">
            Sign in with a Solana wallet or an Arc wallet. Either way you stake from a passkey account: a smart wallet unlocked by your
            device&apos;s Face ID, fingerprint or PIN. Mimir never holds a key, and gas on Arc is sponsored.
          </p>
        </header>
      )}

      <div role="radiogroup" aria-label="Sign in with" className="flex flex-wrap gap-2">
        {(
          [
            ["solana", "Solana wallet"],
            ["arc", "Arc wallet"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            data-testid={`entry-${m}`}
            onClick={() => setMode(m)}
            className={`rounded-full px-4 py-2 text-[14px] ${mode === m ? "bg-cream text-ink" : "bg-cream/[0.06] text-muted hover:text-cream"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "arc" ? <ArcNativeSteps w={w} /> : null}

      {mode === "solana" && clusterMismatch ? (
        <p role="alert" className="m-0 rounded-xl bg-ink-deep px-4 py-3 text-[13px] text-coral">
          This site&apos;s Solana network ({SOLANA_CLUSTER}) does not match Arc {ARC.network} ({ARC.solana.cluster}). Transfers are off until the
          deploy settings agree.
        </p>
      ) : null}

      {mode === "solana" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* The wallet chip's menu opens below the button: let it out of the card instead of clipping it. */}
          <section aria-labelledby="arc-step-solana" className={`${SURFACE} !overflow-visible z-10 grid content-start gap-3 p-5 sm:p-6`}>
            <h2 id="arc-step-solana" className="m-0 text-[1.2rem] leading-none text-cream">
              1. Solana wallet
            </h2>
            <p className="m-0 text-[14px] text-muted">Who you are on Mimir, and where your USDC comes from.</p>
            <div className="wallet-anchor-start justify-self-start">
              <ConnectWalletButton />
            </div>
          </section>

          <section aria-labelledby="arc-step-account" className={`${SURFACE} grid content-start gap-3 p-5 sm:p-6`}>
            <h2 id="arc-step-account" className="m-0 text-[1.2rem] leading-none text-cream">
              2. Arc account
            </h2>
            <AccountBody w={w} />
          </section>
        </div>
      ) : null}

      {w.session && recovery === null ? (
        <section aria-label="Recovery phrase" className={`${SURFACE} p-5 sm:p-6`}>
          <RecoverySetup session={w.session} onDone={setRecovery} />
        </section>
      ) : null}

      {mode === "solana" && w.session ? (
        <section aria-labelledby="arc-step-move" className={`${SURFACE} grid gap-4 p-5 sm:p-6`}>
          <h2 id="arc-step-move" className="m-0 text-[1.2rem] leading-none text-cream">
            3. Move USDC
          </h2>
          <dl className="m-0 grid grid-cols-2 gap-3">
            <Balance label="On Arc" units={arcUnits} />
            <Balance label="On Solana" units={w.solana ? solanaUnits : null} placeholder={w.solana ? undefined : "connect"} />
          </dl>
          {!w.solana ? (
            <p className="m-0 text-[14px] text-muted">Connect your Solana wallet to deposit or withdraw.</p>
          ) : !w.linked ? (
            <p className="m-0 text-[14px] text-muted">Link your Arc account to this Solana wallet first (step 2).</p>
          ) : clusterMismatch ? null : (
            <TransferPanel session={w.session} arcUnits={arcUnits} solanaUnits={solanaUnits} onSettled={() => void reload()} />
          )}
          {recovery === "skipped" ? (
            <button type="button" onClick={() => setRecovery(null)} className="justify-self-start text-[13px] text-muted underline underline-offset-2 hover:text-cream">
              Set up a recovery phrase
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Balance({ label, units, placeholder }: { label: string; units: bigint | null; placeholder?: string }) {
  return (
    <div className="grid gap-1 rounded-xl bg-ink-deep px-4 py-3">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="m-0 font-mono text-[1.25rem] text-cream">
        {units !== null ? `${formatUsdcUnits(units)} USDC` : (placeholder ?? "…")}
      </dd>
    </div>
  );
}

function AccountBody({ w }: { w: ArcWallet }) {
  const [showRecover, setShowRecover] = useState(false);
  const bound = w.binding.status === "loaded" ? w.binding.binding : null;

  if (!w.configured) {
    return <p className="m-0 text-[14px] text-muted">Arc accounts are not switched on for this site yet.</p>;
  }
  if (w.restoring) return <Skeleton className="h-[96px] rounded-xl" />;

  const status = (
    <>
      <p aria-live="polite" className="sr-only">
        {w.busy === "link" ? "Waiting for your signatures" : w.busy ? "Waiting for your passkey" : ""}
      </p>
      {w.error ? (
        <p role="alert" className="m-0 text-[13px] text-coral">
          {w.error}
        </p>
      ) : null}
    </>
  );

  if (!w.session) {
    return (
      <div className="grid gap-3">
        <p className="m-0 text-[14px] text-muted">
          A passkey is a sign-in key kept on your device and unlocked with Face ID, a fingerprint or your PIN. It signs everything you do on Arc.
        </p>
        {bound ? (
          <p className="m-0 text-[14px] text-cream">
            This wallet is linked to Arc account <span className="font-mono">{short(bound.arc)}</span>. Log in with its passkey.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {bound ? (
            <button type="button" disabled={Boolean(w.busy)} onClick={() => void w.login()} className={BTN_PRIMARY}>
              {w.busy === "login" ? "Follow your device's prompt…" : "Log in with your passkey"}
            </button>
          ) : null}
          <button type="button" disabled={!w.solana || Boolean(w.busy)} onClick={() => void w.create()} className={bound ? BTN_SECONDARY : BTN_PRIMARY}>
            {w.busy === "create" ? "Follow your device's prompt…" : bound ? "Start a new account" : "Create your Arc account"}
          </button>
          {!bound ? (
            <button type="button" disabled={Boolean(w.busy)} onClick={() => void w.login()} className={BTN_SECONDARY}>
              {w.busy === "login" ? "Follow your device's prompt…" : "I have a passkey: log in"}
            </button>
          ) : null}
        </div>
        {!w.solana ? <p className="m-0 text-[12px] text-muted">Connect your Solana wallet first (step 1).</p> : null}
        <button
          type="button"
          aria-expanded={showRecover}
          onClick={() => setShowRecover((v) => !v)}
          className="justify-self-start text-[13px] text-muted underline underline-offset-2 hover:text-cream"
        >
          Lost your passkey? Recover with your phrase
        </button>
        {showRecover ? <RecoverWithPhrase busy={w.busy === "recover"} onRecover={(p) => void w.recover(p)} /> : null}
        {status}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="m-0 text-[14px] text-muted">
        Account{" "}
        <a
          href={arcExplorerUrl("address", w.session.address)}
          target="_blank"
          rel="noreferrer"
          className="break-all font-mono text-cream underline underline-offset-2"
          data-testid="arc-address"
        >
          {w.session.address}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
      {w.linked ? (
        <p className="m-0 text-[14px] text-cream" data-testid="arc-linked">
          Linked to your Solana wallet <span className="font-mono">{short(w.solana ?? "")}</span>.
        </p>
      ) : w.solana && w.sessionOwner && w.sessionOwner !== w.solana ? (
        <div className="grid gap-2">
          <p className="m-0 text-[13px] text-coral">
            This Arc account belongs to your other Solana wallet ({short(w.sessionOwner)}). Each wallet gets its own Arc account.
          </p>
          <button type="button" disabled={Boolean(w.busy)} onClick={() => void w.startFresh()} className={`${BTN_PRIMARY} justify-self-start`}>
            {w.busy === "create" ? "Follow your device's prompt…" : "Create a new Arc account for this wallet"}
          </button>
          <p className="m-0 text-[12px] text-muted">A new passkey on this device, then link it. The other account stays with the other wallet.</p>
        </div>
      ) : w.solana ? (
        <div className="grid gap-2">
          {bound ? (
            <p className="m-0 text-[13px] text-coral">
              This Solana wallet is linked to a different Arc account ({short(bound.arc)}). Linking replaces it.
            </p>
          ) : null}
          <button type="button" disabled={Boolean(w.busy)} onClick={() => void w.link()} className={`${BTN_PRIMARY} justify-self-start`}>
            {w.busy === "link" ? "Sign in your wallet, then your passkey…" : "Link to your Solana wallet"}
          </button>
          <p className="m-0 text-[12px] text-muted">Two free signatures, no transaction: your Solana wallet, then your passkey.</p>
        </div>
      ) : (
        <p className="m-0 text-[13px] text-muted">Connect your Solana wallet to link it.</p>
      )}
      <button
        type="button"
        onClick={() => void w.signOut()}
        className="justify-self-start text-[12px] text-muted underline underline-offset-2 hover:text-cream"
      >
        Use a different passkey on this device
      </button>
      {status}
    </div>
  );
}
