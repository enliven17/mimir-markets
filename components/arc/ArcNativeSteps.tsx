"use client";

/**
 * /wallet, signed in with an Arc wallet (lib/arc/evm.ts): connect the wallet, create or log in to the passkey account,
 * link the two, then set a spending cap so stakes draw USDC straight from the wallet. Optional: link a Solana wallet
 * for $MIMIR perks.
 */
import { useCallback, useEffect, useState } from "react";
import { parseUnits, type Address } from "viem";

import { SURFACE } from "@/components/arena/surface";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import { arcUsdcUnits } from "@/lib/arc/chain";
import { arcExplorerUrl } from "@/lib/arc/config";
import { formatUsdcUnits } from "@/lib/arc/encoding";
import { approveData, DEFAULT_CAP_UNITS, sendBackCall, transferData, walletSpendableUnits, WEI_PER_UNIT } from "@/lib/arc/evm";
import type { ArcWallet } from "./useArcWallet";
import { connectEvmWallet, disconnectEvmWallet, readWalletFunding, sendUsdcTx } from "./useEvmWallet";

const short = (k: string) => `${k.slice(0, 6)}…${k.slice(-4)}`;
const BTN_PRIMARY = "rounded-full bg-coral px-5 py-2.5 text-[14px] font-medium text-[#160909] disabled:opacity-60";
const BTN_SECONDARY = "press rounded-full bg-panel-raised px-5 py-2.5 text-[14px] text-cream disabled:opacity-60";
const INPUT =
  "w-[9rem] min-w-0 rounded-xl bg-ink-deep px-4 py-2.5 font-mono text-[15px] text-cream outline-none focus-visible:shadow-[inset_0_0_0_1px_rgb(255_81_72/.7)]";

/** "12.5" → 12_500_000 units, or null. */
function toUnits(v: string): bigint | null {
  if (!/^\d{1,9}(\.\d{0,6})?$/.test(v.trim())) return null;
  return parseUnits(v.trim(), 6);
}

interface Funds {
  wallet: bigint;
  allowance: bigint;
  account: bigint;
}

function useFunds(evm: Address | null, account: Address | null) {
  const [funds, setFunds] = useState<Funds | null>(null);
  const reload = useCallback(async () => {
    if (!evm || !account) return setFunds(null);
    const [f, a] = await Promise.all([readWalletFunding(evm, account), arcUsdcUnits(account)]).catch(() => [null, null] as const);
    setFunds(f && a !== null ? { wallet: f.walletUnits, allowance: f.allowanceUnits, account: a } : null);
  }, [evm, account]);
  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 20_000);
    return () => clearInterval(t);
  }, [reload]);
  return { funds, reload };
}

export default function ArcNativeSteps({ w }: { w: ArcWallet }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { funds, reload } = useFunds(w.evmLinked ? w.evm : null, w.session?.address ?? null);

  const act = (label: string, fn: () => Promise<unknown>) => async () => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      const e = err as {
        shortMessage?: string;
        message?: string;
        code?: number;
      };
      setError(e.code === 4001 ? "The request was cancelled in the wallet." : (e.shortMessage ?? e.message ?? "Something went wrong."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-labelledby="arc-native-wallet" className={`${SURFACE} grid content-start gap-3 p-5 sm:p-6`}>
          <h2 id="arc-native-wallet" className="m-0 text-[1.2rem] leading-none text-cream">
            1. Arc wallet
          </h2>
          <p className="m-0 text-[14px] text-muted">Who you are on Mimir, and where your USDC stays until you stake.</p>
          {w.evm ? (
            <div className="grid gap-2">
              <p className="m-0 text-[14px] text-cream" data-testid="arc-native-evm">
                Connected <span className="font-mono">{short(w.evm)}</span>
              </p>
              <button
                type="button"
                onClick={disconnectEvmWallet}
                className="justify-self-start text-[12px] text-muted underline underline-offset-2 hover:text-cream"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void act("connect", connectEvmWallet)()}
              className={`${BTN_PRIMARY} justify-self-start`}
            >
              {busy === "connect" ? "Check your wallet…" : "Connect Arc wallet"}
            </button>
          )}
        </section>

        <section aria-labelledby="arc-native-account" className={`${SURFACE} grid content-start gap-3 p-5 sm:p-6`}>
          <h2 id="arc-native-account" className="m-0 text-[1.2rem] leading-none text-cream">
            2. Passkey account
          </h2>
          <PasskeyBody w={w} />
        </section>
      </div>

      {w.session && w.evmLinked ? (
        <section aria-labelledby="arc-native-cap" className={`${SURFACE} grid gap-4 p-5 sm:p-6`}>
          <h2 id="arc-native-cap" className="m-0 text-[1.2rem] leading-none text-cream">
            3. Spending cap
          </h2>
          <p className="m-0 max-w-[62ch] text-[14px] leading-relaxed text-muted">
            One approval in your wallet lets your passkey account draw up to this much USDC from it, only when you stake. Your USDC stays in your
            wallet until then. Lower or revoke it any time.
          </p>
          <dl className="m-0 grid gap-3 sm:grid-cols-3">
            <Stat label="Cap left" units={funds?.allowance ?? null} testid="arc-native-allowance" />
            <Stat label="In your wallet" units={funds?.wallet ?? null} />
            <Stat label="In the passkey account" units={funds?.account ?? null} />
          </dl>
          <CapForm busy={busy} onSet={(units) => void act("cap", () => sendUsdcTx(w.evm!, approveData(w.session!.address, units)))()} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={Boolean(busy) || !funds?.allowance}
              onClick={() => void act("revoke", () => sendUsdcTx(w.evm!, approveData(w.session!.address, 0n)))()}
              className={BTN_SECONDARY}
            >
              {busy === "revoke" ? "Check your wallet…" : "Revoke"}
            </button>
          </div>
          {funds ? (
            <p className="m-0 text-[13px] text-muted">
              You can stake up to{" "}
              <span className="text-cream">{formatUsdcUnits(funds.account + walletSpendableUnits(funds.allowance, funds.wallet))} USDC</span> right
              now.
            </p>
          ) : null}

          <details className="grid gap-3 rounded-xl bg-ink-deep px-4 py-3">
            <summary className="cursor-pointer text-[14px] text-cream">Rather move USDC in? Deposit once</summary>
            <p className="m-0 mt-2 text-[13px] text-muted">A plain transfer from your wallet to your passkey account, no cap needed.</p>
            <AmountForm
              label="Deposit"
              busy={busy === "deposit"}
              disabled={Boolean(busy)}
              onSubmit={(u) => void act("deposit", () => sendUsdcTx(w.evm!, transferData(w.session!.address, u)))()}
            />
          </details>

          {funds && funds.account > 0n ? (
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void act("send", () => w.session!.sendCalls([sendBackCall(w.evm!, funds.account * WEI_PER_UNIT)]))()}
              className={`${BTN_SECONDARY} justify-self-start`}
            >
              {busy === "send" ? "Follow your device's prompt…" : `Send ${formatUsdcUnits(funds.account)} USDC back to my wallet`}
            </button>
          ) : null}
          {error ? (
            <p role="alert" className="m-0 text-[13px] text-coral">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}

      {w.session && w.evmLinked ? (
        <section aria-labelledby="arc-native-perks" className={`${SURFACE} !overflow-visible grid gap-3 p-5 sm:p-6`}>
          <h2 id="arc-native-perks" className="m-0 text-[1.2rem] leading-none text-cream">
            Link a Solana wallet for $MIMIR perks
          </h2>
          <p className="m-0 max-w-[62ch] text-[14px] text-muted">
            Hold $MIMIR on Solana? Link that wallet to this account and its balance lowers your entry fee. Optional: everything else works without it.
          </p>
          <div className="wallet-anchor-start justify-self-start">
            <ConnectWalletButton />
          </div>
          {w.solana && w.linked ? (
            <p className="m-0 text-[14px] text-cream">
              Linked to your Solana wallet <span className="font-mono">{short(w.solana)}</span>.
            </p>
          ) : w.solana ? (
            <button type="button" disabled={Boolean(w.busy)} onClick={() => void w.link()} className={`${BTN_PRIMARY} justify-self-start`}>
              {w.busy === "link" ? "Sign in your wallet, then your passkey…" : "Link this Solana wallet"}
            </button>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function Stat({ label, units, testid }: { label: string; units: bigint | null; testid?: string }) {
  return (
    <div className="grid gap-1 rounded-xl bg-ink-deep px-4 py-3">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="m-0 font-mono text-[1.15rem] text-cream" data-testid={testid}>
        {units !== null ? `${formatUsdcUnits(units)} USDC` : "…"}
      </dd>
    </div>
  );
}

function CapForm({ busy, onSet }: { busy: string | null; onSet(units: bigint): void }) {
  return <AmountForm label="Set cap" initial={formatUsdcUnits(DEFAULT_CAP_UNITS)} busy={busy === "cap"} disabled={Boolean(busy)} onSubmit={onSet} />;
}

function AmountForm({
  label,
  initial = "",
  busy,
  disabled,
  onSubmit,
}: {
  label: string;
  initial?: string;
  busy: boolean;
  disabled: boolean;
  onSubmit(units: bigint): void;
}) {
  const [value, setValue] = useState(initial.replace(/,/g, ""));
  const units = toUnits(value);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (units) onSubmit(units);
      }}
    >
      <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" aria-label={`${label} (USDC)`} className={INPUT} />
      <span className="text-[13px] text-muted">USDC</span>
      <button type="submit" disabled={disabled || !units} className={BTN_PRIMARY}>
        {busy ? "Check your wallet…" : label}
      </button>
    </form>
  );
}

function PasskeyBody({ w }: { w: ArcWallet }) {
  if (!w.configured) return <p className="m-0 text-[14px] text-muted">Arc accounts are not switched on for this site yet.</p>;
  const status = w.error ? (
    <p role="alert" className="m-0 text-[13px] text-coral">
      {w.error}
    </p>
  ) : null;

  if (!w.session) {
    return (
      <div className="grid gap-3">
        <p className="m-0 text-[14px] text-muted">
          Your passkey (Face ID, a fingerprint or your PIN) signs every stake, so your wallet never pops up for each one. Gas is sponsored.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!w.evm || Boolean(w.busy)} onClick={() => void w.create()} className={BTN_PRIMARY}>
            {w.busy === "create" ? "Follow your device's prompt…" : "Create your passkey account"}
          </button>
          <button type="button" disabled={Boolean(w.busy)} onClick={() => void w.login()} className={BTN_SECONDARY}>
            {w.busy === "login" ? "Follow your device's prompt…" : "I have a passkey: log in"}
          </button>
        </div>
        {!w.evm ? <p className="m-0 text-[12px] text-muted">Connect your Arc wallet first (step 1).</p> : null}
        {status}
      </div>
    );
  }

  const otherWallet = w.evmBinding && w.evm && w.evmBinding.evm !== w.evm ? w.evmBinding.evm : null;
  return (
    <div className="grid gap-3">
      <p className="m-0 text-[14px] text-muted">
        Account{" "}
        <a
          href={arcExplorerUrl("address", w.session.address)}
          target="_blank"
          rel="noreferrer"
          className="break-all font-mono text-cream underline underline-offset-2"
        >
          {w.session.address}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
      {w.evmLinked ? (
        <p className="m-0 text-[14px] text-cream" data-testid="arc-native-linked">
          Linked to your Arc wallet <span className="font-mono">{short(w.evm ?? "")}</span>.
        </p>
      ) : otherWallet ? (
        <div className="grid gap-2">
          <p className="m-0 text-[13px] text-coral">
            This passkey account belongs to your other Arc wallet ({short(otherWallet)}). Each wallet gets its own account.
          </p>
          <button type="button" disabled={Boolean(w.busy)} onClick={() => void w.startFresh()} className={`${BTN_PRIMARY} justify-self-start`}>
            {w.busy === "create" ? "Follow your device's prompt…" : "Create a new account for this wallet"}
          </button>
        </div>
      ) : w.evm ? (
        <div className="grid gap-2">
          <button
            type="button"
            disabled={Boolean(w.busy) || w.evmBinding === undefined}
            onClick={() => void w.linkEvm()}
            className={`${BTN_PRIMARY} justify-self-start`}
          >
            {w.busy === "link" ? "Sign in your wallet, then your passkey…" : "Link to your Arc wallet"}
          </button>
          <p className="m-0 text-[12px] text-muted">Two free signatures, no transaction: your wallet, then your passkey.</p>
        </div>
      ) : (
        <p className="m-0 text-[13px] text-muted">Connect your Arc wallet to link it.</p>
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
