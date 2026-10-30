"use client";

/**
 * /wallet, EVM way in, optional: let the passkey account draw from the EVM wallet's USDC on Arc (lib/arc/evm.ts). One
 * more binding (/api/arc/evm-bind), then a spending cap: an approve on Arc, so the wallet must be able to use Arc.
 */
import { useCallback, useEffect, useState } from "react";
import { parseUnits, type Address } from "viem";

import { arcUsdcUnits } from "@/lib/arc/chain";
import { formatUsdcUnits } from "@/lib/arc/encoding";
import { approveData, DEFAULT_CAP_UNITS, sendBackCall, transferData, walletSpendableUnits, WEI_PER_UNIT } from "@/lib/arc/evm";
import type { ArcWallet } from "./useArcWallet";
import { readWalletFunding, sendUsdcTx } from "./useEvmWallet";

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

export default function ArcWalletDraw({ w }: { w: ArcWallet }) {
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

  if (!w.session || !w.evm) return null;
  const otherWallet = w.evmBinding && w.evmBinding.evm !== w.evm ? w.evmBinding.evm : null;

  return (
    <details className="rounded-xl bg-ink-deep px-4 py-3" open={w.evmLinked || undefined}>
      <summary className="cursor-pointer text-[14px] text-cream">Optional: stake straight from your wallet&apos;s USDC on Arc</summary>
      <p className="m-0 mt-3 max-w-[62ch] text-[13px] leading-relaxed text-muted">
        Instead of sending USDC to your account, let it draw from your wallet&apos;s USDC on Arc, up to a cap, only when you stake. This needs a
        wallet that can use the Arc network (it is added on your first approval). If yours cannot, as with some mobile wallets, send USDC on Arc to
        your account instead.
      </p>

      {!w.evmLinked ? (
        otherWallet ? (
          <p className="m-0 mt-3 text-[13px] text-coral">This account already draws from another wallet ({short(otherWallet)}).</p>
        ) : (
          <div className="mt-3 grid gap-2">
            <button
              type="button"
              disabled={Boolean(w.busy) || w.evmBinding === undefined}
              onClick={() => void w.linkEvm()}
              className={`${BTN_PRIMARY} justify-self-start`}
            >
              {w.busy === "link" ? "Sign in your wallet, then your passkey…" : "Let this account draw from my wallet"}
            </button>
            <p className="m-0 text-[12px] text-muted">Two free signatures, no transaction: your wallet, then your passkey.</p>
          </div>
        )
      ) : (
        <div className="mt-3 grid gap-4">
          <dl className="m-0 grid gap-3 sm:grid-cols-3">
            <Stat label="Cap left" units={funds?.allowance ?? null} testid="arc-native-allowance" />
            <Stat label="In your wallet" units={funds?.wallet ?? null} />
            <Stat label="In the passkey account" units={funds?.account ?? null} />
          </dl>
          <p className="m-0 text-[13px] text-muted">One approval on Arc sets the cap. Lower or revoke it any time.</p>
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
              It can still draw from your wallet: <span className="text-cream">{formatUsdcUnits(walletSpendableUnits(funds.allowance, funds.wallet))} USDC</span>
            </p>
          ) : null}
          <div className="grid gap-2">
            <p className="m-0 text-[13px] text-muted">Rather move USDC in once? A plain transfer from your wallet to your account, no cap needed.</p>
            <AmountForm
              label="Deposit"
              busy={busy === "deposit"}
              disabled={Boolean(busy)}
              onSubmit={(u) => void act("deposit", () => sendUsdcTx(w.evm!, transferData(w.session!.address, u)))()}
            />
          </div>
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
        </div>
      )}
      {error ? (
        <p role="alert" className="m-0 mt-3 text-[13px] text-coral">
          {error}
        </p>
      ) : null}
    </details>
  );
}

function Stat({ label, units, testid }: { label: string; units: bigint | null; testid?: string }) {
  return (
    <div className="grid gap-1 rounded-xl bg-cream/[0.04] px-4 py-3">
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
