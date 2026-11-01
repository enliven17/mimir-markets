"use client";

/**
 * The owner's controls on an agent's page: fund its wallet on a chain from the connected wallet (Arc: USDC, which also
 * pays its gas; Base: USDC, plus a little ETH for gas: there is no gas station), withdraw it back, pause or resume,
 * shut down.
 */
import { useState } from "react";
import { encodeFunctionData, numberToHex, type Address } from "viem";

import { sendEvmTransaction } from "@/components/arc/useEvmWallet";
import { useMimirWallet } from "@/hooks/useMimirWallet";
import { toChainUnits } from "@/lib/chains/amounts";
import { ERC20_ABI } from "@/lib/chains/client";
import { MARKET_CHAINS, type MarketChainId } from "@/lib/chains/registry";
import { signedPost } from "@/lib/launch/client";

/** USDC in index units (18 dp), whole micro-USDC. */
const usdcWei = (n: number) => BigInt(Math.round(n * 1e6)) * 1_000_000_000_000n;

export default function OwnerControls({ slug, owner, status, arc, base = null }: { slug: string; owner: string; status: string; arc: string | null; base?: string | null }) {
  const { address, signMessage } = useMimirWallet();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [fund, setFund] = useState("");
  const [amount, setAmount] = useState("");
  const [gas, setGas] = useState("");
  const chains = MARKET_CHAINS.enabled.filter((c) => (c === "arc" ? Boolean(arc) : Boolean(base)));
  const [chain, setChain] = useState<MarketChainId>(chains[0] ?? MARKET_CHAINS.defaultChain);
  if (!address || address !== owner || !signMessage) return null;
  const cfg = MARKET_CHAINS.chains[chain];
  const target = (chain === "arc" ? arc : base) as Address | null;

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
  /** USDC to the agent's wallet on `chain`: native value on Arc, an ERC-20 transfer on Base. */
  const sendUsdc = (n: number) => {
    if (!target) throw new Error(`The agent has no ${cfg.label} wallet yet.`);
    const wei = usdcWei(n);
    return cfg.usdc.kind === "native"
      ? sendEvmTransaction(cfg.chainId, { from: address, to: target, value: numberToHex(wei) })
      : sendEvmTransaction(cfg.chainId, {
          from: address,
          to: cfg.usdc.address,
          data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [target, toChainUnits(cfg, wei)] }),
          value: "0x0",
        });
  };
  const post = <T,>(path: string, action: "status" | "withdraw", body: unknown) => signedPost<T>(`/api/launch/${slug}/${path}`, { owner, signMessage, action, agent: slug, body });
  const setStatus = (s: "live" | "paused" | "killed") => act(async () => (await post("status", "status", { status: s }), s === "killed" ? "Shut down: it stakes no more. Withdraw its USDC any time." : s === "paused" ? "Paused." : "Running again."));

  return (
    <section className="grid gap-4 rounded-2xl bg-cream/[0.04] p-5">
      <h2 className="m-0 font-display text-[1.4rem] text-cream">Your agent</h2>
      {chains.length > 1 ? (
        <div aria-label="Network" className="flex gap-1 text-[13px]">
          {chains.map((c) => (
            <button key={c} type="button" aria-pressed={chain === c} onClick={() => setChain(c)} className={`rounded-full px-3 py-1 ${chain === c ? "bg-panel-raised text-cream" : "text-muted"}`}>
              {MARKET_CHAINS.chains[c].label}
            </button>
          ))}
        </div>
      ) : null}
      {status !== "killed" ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(fund);
            if (!(n > 0)) return setNote("Enter an amount.");
            void act(async () => {
              const tx = await sendUsdc(n);
              setFund("");
              return `Sent ${n} USDC to its ${cfg.label} wallet (${tx.slice(0, 10)}…). It stakes from it.`;
            });
          }}
        >
          <label className="grid gap-1.5">
            <span className="text-[13px] text-muted">Fund it (USDC on {cfg.label})</span>
            <input className="input !w-32 font-mono" inputMode="decimal" placeholder="0.00" value={fund} onChange={(e) => setFund(e.target.value)} aria-label="USDC to send" />
          </label>
          <button type="submit" disabled={busy} className="btn-primary !w-auto !px-5">Send USDC</button>
        </form>
      ) : null}
      {status !== "killed" && cfg.gas.symbol === "ETH" && target ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(gas);
            if (!(n > 0 && n <= 1)) return setNote("Enter an ETH amount (a little covers many stakes).");
            void act(async () => {
              const tx = await sendEvmTransaction(cfg.chainId, { from: address, to: target, value: numberToHex(BigInt(Math.round(n * 1e9)) * 1_000_000_000n) });
              setGas("");
              return `Sent ${n} ETH for gas to its ${cfg.label} wallet (${tx.slice(0, 10)}…).`;
            });
          }}
        >
          <label className="grid gap-1.5">
            <span className="text-[13px] text-muted">Gas (ETH on {cfg.label})</span>
            <input className="input !w-32 font-mono" inputMode="decimal" placeholder="0.001" value={gas} onChange={(e) => setGas(e.target.value)} aria-label="ETH to send for gas" />
          </label>
          <button type="submit" disabled={busy} className="btn-ghost !w-auto !px-5">Send ETH</button>
        </form>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(amount);
          if (!(n > 0)) return setNote("Enter an amount.");
          void act(async () => {
            const r = await post<{ tx: string }>("withdraw", "withdraw", { amount: n, chain });
            setAmount("");
            return `Sent to you (${r.tx.slice(0, 10)}…).`;
          });
        }}
      >
        <label className="grid gap-1.5">
          <span className="text-[13px] text-muted">Withdraw (USDC on {cfg.label})</span>
          <input className="input !w-32 font-mono" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="USDC to withdraw" />
        </label>
        <button type="submit" disabled={busy} className="btn-ghost !w-auto !px-5">Withdraw</button>
      </form>
      <p className="m-0 text-[12px] text-muted">
        {cfg.gas.symbol === "ETH" ? "Withdrawals go to this wallet. Its gas on Base is ETH, which stays in its wallet." : "Withdrawals go to this wallet. 0.05 USDC stays for its gas."}
      </p>
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
              if (window.confirm("Shut it down for good? It stops staking. Open stakes settle on their own, and you can withdraw its USDC any time.")) void setStatus("killed");
            }}
          >
            Shut down
          </button>
        </div>
      ) : null}
      {note ? <p role="status" className="m-0 text-[14px] text-cream">{note}</p> : null}
    </section>
  );
}
