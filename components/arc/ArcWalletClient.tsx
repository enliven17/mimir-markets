"use client";

/**
 * /wallet body. Markets settle on Arc, and you stake from a passkey account there, owned by one wallet: a Solana wallet
 * or an EVM wallet (Arc, Robinhood Chain or Base: one ConnectKit connection, one address). Owning only takes a signed
 * message (/api/arc/bind), never a network switch, so any EVM wallet works, Robinhood Wallet included.
 * Solana: 1 wallet, 2 passkey account, 3 move USDC between Solana and Arc (CCTP).
 * EVM: 1 wallet, 2 passkey account, 3 fund on Arc, plus an optional spending cap so stakes draw from the wallet's USDC
 * on Arc (ArcWalletDraw). docs/ARC.md is the design.
 */
import { useEffect, useState } from "react";

import { SURFACE } from "@/components/arena/surface";
import Skeleton from "@/components/ui/Skeleton";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import { useWalletSheet } from "@/components/wallet/WalletSheetProvider";
import { ARC, arcExplorerUrl } from "@/lib/arc/config";
import { formatUsdcUnits } from "@/lib/arc/encoding";
import { SOLANA_CLUSTER } from "@/lib/solana/config";
import { loadArcAccount } from "@/lib/arc/lazy";
import ArcWalletDraw from "./ArcWalletDraw";
import { currentEvmIntent, disconnectEvm, evmNetworkName, useEvmAccount, type EvmChainIntent } from "./useEvmWallet";
import { markRecoveryOn, readRecoveryFlag, RecoverWithPhrase, RecoverySetup, type RecoveryFlag } from "./RecoveryPanel";
import TransferPanel from "./TransferPanel";
import { useArcBalances } from "./useArcBalances";
import { setEntryMode, useArcWallet, useEntryMode, type ArcWallet, type EntryMode } from "./useArcWallet";

const short = (k: string) => `${k.slice(0, 6)}…${k.slice(-4)}`;
const BTN_PRIMARY = "rounded-full bg-coral px-5 py-2.5 text-[14px] font-medium text-[#160909] disabled:opacity-60";
// An EVM owner is named by the network its wallet is used on (Arc, Robinhood Chain, Base).
const walletName = (w: ArcWallet, intent: EvmChainIntent | null = currentEvmIntent()) =>
  w.ownerKind === "robinhood" ? `${evmNetworkName(intent) ?? "EVM"} wallet` : "Solana wallet";
const BTN_SECONDARY = "press rounded-full bg-panel-raised px-5 py-2.5 text-[14px] text-cream disabled:opacity-60";
const EVM_NETWORKS = "Arc, Robinhood Chain or Base";

export default function ArcWalletClient() {
  return <ArcWalletView w={useArcWallet()} />;
}

/**
 * The way in shown: the one picked on this page, else the only kind of wallet connected, else the remembered pick,
 * else Solana. A pick is remembered and also decides which wallet owns the account when both are connected.
 */
function useWayIn(w: ArcWallet): [EntryMode, (m: EntryMode) => void] {
  const remembered = useEntryMode();
  const [picked, setPicked] = useState<EntryMode | null>(null);
  const hasSolana = Boolean(w.solanaWallet);
  const hasEvm = Boolean(w.evm);
  const onlyOne: EntryMode | null = hasSolana === hasEvm ? null : hasEvm ? "evm" : "solana";
  const choose = (m: EntryMode) => {
    setPicked(m);
    setEntryMode(m);
  };
  return [picked ?? onlyOne ?? remembered ?? "solana", choose];
}

/**
 * The wallet steps for a given wallet state. `bare` drops the page header, for
 * Portfolio, which shows these steps in place until the account exists.
 */
export function ArcWalletView({ w, bare = false }: { w: ArcWallet; bare?: boolean }) {
  const evmAccount = useEvmAccount(); // re-render when the EVM wallet changes network, so its label follows
  const network = evmNetworkName(evmAccount.intent);
  const { arcUnits, solanaUnits, reload } = useArcBalances(w.session?.address ?? null, w.ownerKind === "solana" ? w.solana : null);
  const [recovery, setRecovery] = useState<RecoveryFlag>(null);
  const [mode, setMode] = useWayIn(w);
  // This way in's wallet owns the account (useArcWallet): steps 2 and 3 may use it.
  const ready = w.ownerKind === (mode === "evm" ? "robinhood" : "solana");
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

  const evmLabel = w.evm && network ? `${network} wallet` : "EVM wallet";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      {bare ? null : (
        <header className="grid gap-2">
          <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">
            Markets settle on Arc · {ARC.network === "testnet" ? "testnet" : "mainnet"}
          </p>
          <h1 className="m-0 font-display text-app-h1 text-cream">Your wallet.</h1>
          <p className="m-0 max-w-[62ch] text-[15px] leading-relaxed text-muted">
            Sign in with a Solana wallet or an EVM wallet ({EVM_NETWORKS}: the same address on all three). Either way you stake from a passkey
            account on Arc: a smart wallet unlocked by your device&apos;s Face ID, fingerprint or PIN. Mimir never holds a key, and gas on Arc is
            sponsored.
          </p>
        </header>
      )}

      <div role="radiogroup" aria-label="Sign in with" className="flex flex-wrap gap-2">
        {(
          [
            ["solana", "Solana wallet", w.solanaWallet ? short(w.solanaWallet) : null],
            ["evm", evmLabel, w.evm ? short(w.evm) : "Arc · Robinhood Chain · Base"],
          ] as const
        ).map(([m, label, hint]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            data-testid={`entry-${m}`}
            onClick={() => setMode(m)}
            className={`grid rounded-2xl px-4 py-2 text-left ${mode === m ? "bg-cream text-ink" : "bg-cream/[0.06] text-muted hover:text-cream"}`}
          >
            <span className="text-[14px]">{label}</span>
            {hint ? <span className={`font-mono text-[11px] ${mode === m ? "text-ink/70" : "text-muted"}`}>{hint}</span> : null}
          </button>
        ))}
      </div>

      {mode === "solana" && clusterMismatch ? (
        <p role="alert" className="m-0 rounded-xl bg-ink-deep px-4 py-3 text-[13px] text-coral">
          This site&apos;s Solana network ({SOLANA_CLUSTER}) does not match Arc {ARC.network} ({ARC.solana.cluster}). Transfers are off until the
          deploy settings agree.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* The wallet chip's menu opens below the button: let it out of the card instead of clipping it. */}
        <section aria-labelledby="wallet-step-1" className={`${SURFACE} !overflow-visible z-10 grid content-start gap-3 p-5 sm:p-6`}>
          <h2 id="wallet-step-1" className="m-0 text-[1.2rem] leading-none text-cream">
            1. {mode === "evm" ? evmLabel : "Solana wallet"}
          </h2>
          {mode === "evm" ? <EvmStep w={w} network={network} /> : <SolanaStep w={w} />}
        </section>

        <section aria-labelledby="arc-step-account" className={`${SURFACE} grid content-start gap-3 p-5 sm:p-6`}>
          <h2 id="arc-step-account" className="m-0 text-[1.2rem] leading-none text-cream">
            2. Passkey account on Arc
          </h2>
          <AccountBody w={w} ready={ready} mode={mode} />
        </section>
      </div>

      {w.session && recovery === null ? (
        <section aria-label="Recovery phrase" className={`${SURFACE} p-5 sm:p-6`}>
          <RecoverySetup session={w.session} onDone={setRecovery} />
        </section>
      ) : null}

      {w.session ? (
        <section aria-labelledby="arc-step-move" className={`${SURFACE} grid gap-4 p-5 sm:p-6`}>
          <h2 id="arc-step-move" className="m-0 text-[1.2rem] leading-none text-cream">
            {mode === "evm" ? "3. Fund on Arc" : "3. Move USDC"}
          </h2>
          <dl className="m-0 grid grid-cols-2 gap-3">
            <Balance label="On Arc" units={arcUnits} />
            {mode === "solana" ? (
              <Balance label="On Solana" units={ready ? solanaUnits : null} placeholder={ready ? undefined : "connect"} />
            ) : null}
          </dl>
          {mode === "evm" ? (
            <>
              <p className="m-0 max-w-[62ch] text-[14px] leading-relaxed text-muted">
                Send USDC on Arc to your account address above. Mimir moves USDC between chains only from Solana: if yours is on Base or Robinhood
                Chain, get it onto Arc first, then send it here.
              </p>
              <ArcWalletDraw w={w} />
            </>
          ) : !ready ? (
            <p className="m-0 text-[14px] text-muted">Connect your Solana wallet to deposit or withdraw.</p>
          ) : !w.linked ? (
            <p className="m-0 text-[14px] text-muted">Link your passkey account to this Solana wallet first (step 2).</p>
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

function SolanaStep({ w }: { w: ArcWallet }) {
  const { open, warm } = useWalletSheet();
  return (
    <>
      <p className="m-0 text-[14px] text-muted">Who you are on Mimir, and where your USDC comes from: Mimir moves it to Arc and back for you.</p>
      {w.solanaWallet ? (
        <div className="wallet-anchor-start justify-self-start">
          <ConnectWalletButton />
        </div>
      ) : (
        <button type="button" onClick={open} onPointerEnter={warm} onFocus={warm} className={`${BTN_PRIMARY} justify-self-start`}>
          Connect Solana wallet
        </button>
      )}
    </>
  );
}

function EvmStep({ w, network }: { w: ArcWallet; network: string | null }) {
  const { open, warm } = useWalletSheet();
  return (
    <>
      <p className="m-0 text-[14px] text-muted">
        Who you are on Mimir. {EVM_NETWORKS}: one address on all three. It only signs a message, so it never has to switch to Arc.
      </p>
      {w.evm ? (
        <div className="grid gap-2">
          <p className="m-0 text-[14px] text-cream" data-testid="wallet-evm">
            Connected <span className="font-mono">{short(w.evm)}</span>
            {network ? <span className="text-muted"> · {network}</span> : null}
          </p>
          <button
            type="button"
            onClick={() => void disconnectEvm()}
            className="justify-self-start text-[12px] text-muted underline underline-offset-2 hover:text-cream"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button type="button" onClick={open} onPointerEnter={warm} onFocus={warm} className={`${BTN_PRIMARY} justify-self-start`}>
          Connect EVM wallet
        </button>
      )}
    </>
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

function AccountBody({ w, ready, mode }: { w: ArcWallet; ready: boolean; mode: EntryMode }) {
  const [showRecover, setShowRecover] = useState(false);
  const bound = ready && w.binding.status === "loaded" ? w.binding.binding : null;
  const connectFirst = `Connect your ${mode === "evm" ? "EVM" : "Solana"} wallet first (step 1).`;

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
        <ol className="m-0 grid list-none gap-1 p-0 text-[13px] text-muted">
          <li><span className="mr-2 font-mono text-coral">1</span>Your device asks for Face ID, a fingerprint or your PIN.</li>
          <li><span className="mr-2 font-mono text-coral">2</span>Your {walletName(w)} signs once to link the account. Free, no transaction.</li>
          <li><span className="mr-2 font-mono text-coral">3</span>Your passkey confirms the link. Done.</li>
        </ol>
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
          <button type="button" disabled={!ready || Boolean(w.busy)} onClick={() => void w.create()} className={bound ? BTN_SECONDARY : BTN_PRIMARY}>
            {w.busy === "create" ? "Follow your device's prompt…" : w.busy === "link" ? "Approve in your wallet…" : bound ? "Start a new account" : "Create your passkey account"}
          </button>
          {!bound ? (
            <button type="button" disabled={Boolean(w.busy)} onClick={() => void w.login()} className={BTN_SECONDARY}>
              {w.busy === "login" ? "Follow your device's prompt…" : "I have a passkey: log in"}
            </button>
          ) : null}
        </div>
        {!ready ? <p className="m-0 text-[12px] text-muted">{connectFirst}</p> : null}
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
          Linked to your {walletName(w)} <span className="font-mono">{short(w.solana ?? "")}</span>.
        </p>
      ) : ready && w.sessionOwner && w.sessionOwner !== w.solana ? (
        <div className="grid gap-2">
          <p className="m-0 text-[13px] text-coral">
            This Arc account belongs to your other wallet ({short(w.sessionOwner)}). Each wallet gets its own Arc account.
          </p>
          <button type="button" disabled={Boolean(w.busy)} onClick={() => void w.startFresh()} className={`${BTN_PRIMARY} justify-self-start`}>
            {w.busy === "create" ? "Follow your device's prompt…" : "Create a new Arc account for this wallet"}
          </button>
          <p className="m-0 text-[12px] text-muted">A new passkey on this device, then link it. The other account stays with the other wallet.</p>
        </div>
      ) : ready ? (
        <div className="grid gap-2">
          {bound ? (
            <p className="m-0 text-[13px] text-coral">
              This {walletName(w)} is linked to a different Arc account ({short(bound.arc)}). Linking replaces it.
            </p>
          ) : null}
          <button type="button" disabled={Boolean(w.busy)} onClick={() => void w.link()} className={`${BTN_PRIMARY} justify-self-start`}>
            {w.busy === "link" ? "Sign in your wallet, then your passkey…" : `Link to your ${walletName(w)}`}
          </button>
          <p className="m-0 text-[12px] text-muted">Two free signatures, no transaction: your {walletName(w)}, then your passkey.</p>
        </div>
      ) : (
        <p className="m-0 text-[13px] text-muted">{connectFirst}</p>
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
