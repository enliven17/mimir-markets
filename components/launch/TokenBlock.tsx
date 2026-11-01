"use client";

/**
 * An agent's own token: optional, launched by its owner from their own wallet (lib/launch/token.ts). The owner is the
 * creator, pays the gas and gets every creator fee; Mimir takes none.
 *   No token yet, the owner: pick Argus (Arc) or Clanker (Base), sign, send the launch from the wallet, and it is
 *   recorded once the server has read the receipt.
 *   A token: its chart and launchpad link; the owner claims its fees here, a transaction from their own wallet
 *   (Argus: splitter distribute() then claim(owner), in USDC; Clanker: ClankerFeeLocker claim(owner, WETH)).
 */
import { useCallback, useEffect, useState } from "react";
import { createPublicClient, encodeFunctionData, http, type Address, type Hex } from "viem";

import { ExternalMark } from "@/components/ExternalMark";
import { sendEvmTransaction } from "@/components/arc/useEvmWallet";
import { useMimirWallet } from "@/hooks/useMimirWallet";
import { arcPublicClient } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { BASE_CHAIN } from "@/lib/base/chain";
import { ARGUS_SPLITTER_ABI } from "@/lib/launch/argus";
import { BASE_WETH, CLANKER_FEE_LOCKER, FEE_LOCKER_ABI } from "@/lib/launch/base/clanker";
import { signedPost } from "@/lib/launch/client";
import { tokenPage, type AgentToken } from "@/lib/launch/council-view";
import TokenChart from "./TokenChart";

type Token = Pick<AgentToken, "chain" | "address"> & { splitter?: string | null };
type LaunchTx = { chain: "arc" | "base"; chainId: number; to: Address; data: Hex; value: Hex; token: Address | null };

const baseClient = () => createPublicClient({ transport: http(BASE_CHAIN.rpcUrl, { timeout: 10_000 }) });
const MAX_IMAGE_BYTES = 500_000;

export default function TokenBlock({ slug, ticker, owner, status, token }: { slug: string; ticker: string; owner: string | null; status: string; token: Token | null }) {
  const { address, signMessage } = useMimirWallet();
  const mine = !!owner && !!address && address === owner && !!signMessage;
  if (token) {
    return (
      <section className="grid gap-4" aria-label={`$${ticker} token`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="m-0 font-display text-[1.4rem] text-cream">${ticker}</h2>
          <a href={tokenPage(token)} target="_blank" rel="noreferrer" className="text-[14px] text-coral hover:underline">
            Trade on {token.chain === "arc" ? "Argus" : "Clanker"} <ExternalMark />
          </a>
        </div>
        <div className="overflow-hidden rounded-2xl bg-ink-deep shadow-card">
          <TokenChart chain={token.chain} token={token.address} title={`$${ticker} chart`} tradeUrl={tokenPage(token)} tradeLabel={`Trade on ${token.chain === "arc" ? "Argus" : "Clanker"}`} />
        </div>
        {mine ? <ClaimFees owner={address!} token={token} /> : (
          <p className="m-0 text-[13px] text-muted">Its creator fees go to the agent's owner. Mimir takes no share.</p>
        )}
      </section>
    );
  }
  if (!mine || status === "killed") return null;
  return <LaunchToken slug={slug} ticker={ticker} owner={address!} signMessage={signMessage!} />;
}

function LaunchToken({ slug, ticker, owner, signMessage }: { slug: string; ticker: string; owner: Address; signMessage: (m: string) => Promise<string> }) {
  const [chain, setChain] = useState<"arc" | "base">("arc");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [buyTax, setBuyTax] = useState("2");
  const [sellTax, setSellTax] = useState("2");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const launch = async () => {
    setBusy(true);
    setNote("Preparing the launch…");
    try {
      const bps = (s: string) => Math.round(Number(s) * 100);
      const body = { step: "prepare", chain, description, ...(image ? { image } : {}), ...(chain === "arc" ? { argus: { buyTaxBps: bps(buyTax), sellTaxBps: bps(sellTax) } } : {}) };
      const tx = await signedPost<LaunchTx>(`/api/launch/${slug}/token`, { owner, signMessage, action: "token", agent: slug, body });
      setNote("Confirm the launch in your wallet. You pay the gas.");
      const hash = await sendEvmTransaction(tx.chainId, { from: owner, to: tx.to, data: tx.data, value: tx.value });
      setNote("Sent. Checking it on chain…");
      await signedPost(`/api/launch/${slug}/token`, { owner, signMessage, action: "token", agent: slug, body: { step: "record", chain, tx: hash } });
      setNote(`$${ticker} is live. Reload to see it.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-4 rounded-2xl bg-cream/[0.04] p-5">
      <div className="grid gap-1">
        <h2 className="m-0 font-display text-[1.4rem] text-cream">Launch ${ticker} (optional)</h2>
        <p className="m-0 max-w-[62ch] text-[14px] text-muted">
          Your wallet launches it and pays the gas, so you are its creator and every creator fee is yours. Mimir takes no share. The agent keeps staking either way.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Launchpad">
        {(["arc", "base"] as const).map((c) => (
          <button key={c} type="button" role="radio" aria-checked={chain === c} onClick={() => setChain(c)} className={`flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-4 text-[13px] ${chain === c ? "bg-cream text-ink" : "bg-cream/[0.06] text-muted hover:text-cream"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a small static logo */}
            <img src={c === "arc" ? "/launch/argus.jpg" : "/launch/clanker.svg"} alt="" width={24} height={24} className="h-6 w-6 rounded-full bg-white object-cover" />
            {c === "arc" ? "Argus on Arc · fees in USDC" : "Clanker on Base · fees in WETH"}
          </button>
        ))}
      </div>
      {chain === "arc" ? (
        <div className="flex flex-wrap gap-3">
          <label className="grid gap-1.5">
            <span className="text-[12px] text-muted">Buy tax %</span>
            <input className="input !w-24 font-mono" inputMode="decimal" value={buyTax} onChange={(e) => setBuyTax(e.target.value)} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[12px] text-muted">Sell tax %</span>
            <input className="input !w-24 font-mono" inputMode="decimal" value={sellTax} onChange={(e) => setSellTax(e.target.value)} />
          </label>
          <p className="m-0 self-end text-[12px] text-muted">0 to 10% each. Argus keeps 10% of the fees; the rest is yours.</p>
        </div>
      ) : (
        <p className="m-0 text-[12px] text-muted">A 1% fee on each trade, paid in WETH. Clanker adds its own cut on top; the rest is yours.</p>
      )}
      <label className="grid gap-1.5">
        <span className="text-[12px] text-muted">Description</span>
        <input className="input" maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One line about the agent" />
      </label>
      <label className="grid gap-1.5">
        <span className="text-[12px] text-muted">Image (optional; the agent's face otherwise)</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="text-[13px] text-muted"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return setImage(null);
            if (f.size > MAX_IMAGE_BYTES) return setNote("Image is too large (about 500 KB max).");
            const r = new FileReader();
            r.onload = () => setImage(typeof r.result === "string" ? r.result : null);
            r.readAsDataURL(f);
          }}
        />
      </label>
      <button type="button" disabled={busy} className="btn-primary justify-self-start !w-auto !px-6" onClick={() => void launch()}>
        Launch from my wallet
      </button>
      {note ? <p role="status" className="m-0 text-[14px] text-cream">{note}</p> : null}
    </section>
  );
}

function ClaimFees({ owner, token }: { owner: Address; token: Token }) {
  const [owed, setOwed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const read = useCallback(async () => {
    try {
      if (token.chain === "arc" && token.splitter) {
        const units = await arcPublicClient(ARC).readContract({ address: token.splitter as Address, abi: ARGUS_SPLITTER_ABI, functionName: "claimableQuote6", args: [owner] });
        setOwed(`${(Number(units) / 1e6).toFixed(2)} USDC ready (more after distribute)`);
      } else if (token.chain === "base") {
        const wei = await baseClient().readContract({ address: CLANKER_FEE_LOCKER, abi: FEE_LOCKER_ABI, functionName: "availableFees", args: [owner, BASE_WETH] });
        setOwed(`${(Number(wei) / 1e18).toFixed(5)} WETH ready`);
      }
    } catch {
      setOwed(null);
    }
  }, [owner, token]);
  useEffect(() => void read(), [read]);

  const claim = async () => {
    setBusy(true);
    setNote(null);
    try {
      if (token.chain === "arc") {
        if (!token.splitter) throw new Error("This token has no splitter on record.");
        const splitter = token.splitter as Address;
        const client = arcPublicClient(ARC);
        // distribute() moves the splitter's revenue into each bucket (Argus's 10%, the rest to you); claim pays you.
        const d = await sendEvmTransaction(ARC.chain.id, { from: owner, to: splitter, data: encodeFunctionData({ abi: ARGUS_SPLITTER_ABI, functionName: "distribute" }) });
        await client.waitForTransactionReceipt({ hash: d, timeout: 120_000 });
        const c = await sendEvmTransaction(ARC.chain.id, { from: owner, to: splitter, data: encodeFunctionData({ abi: ARGUS_SPLITTER_ABI, functionName: "claim", args: [owner] }) });
        await client.waitForTransactionReceipt({ hash: c, timeout: 120_000 });
        setNote(`Claimed to your wallet (${c.slice(0, 10)}…).`);
      } else {
        const c = await sendEvmTransaction(BASE_CHAIN.id, { from: owner, to: CLANKER_FEE_LOCKER, data: encodeFunctionData({ abi: FEE_LOCKER_ABI, functionName: "claim", args: [owner, BASE_WETH] }) });
        await baseClient().waitForTransactionReceipt({ hash: c, timeout: 120_000 });
        setNote(`Claimed WETH to your wallet (${c.slice(0, 10)}…).`);
      }
      await read();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 rounded-2xl bg-cream/[0.04] p-5">
      <h3 className="m-0 text-[15px] text-cream">Your creator fees</h3>
      <p className="m-0 text-[13px] text-muted">
        All yours: Mimir takes no share. {token.chain === "arc" ? "Argus keeps 10%." : "Clanker adds its own cut on top of the 1%."} Claiming is a transaction from your wallet.
      </p>
      {owed ? <p className="m-0 font-mono text-[14px] text-cream">{owed}</p> : null}
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" disabled={busy} className="btn-primary !w-auto !px-5" onClick={() => void claim()}>
          Claim fees
        </button>
        <a href={tokenPage(token)} target="_blank" rel="noreferrer" className="text-[14px] text-coral hover:underline">
          Or on {token.chain === "arc" ? "Argus" : "Clanker"} <ExternalMark />
        </a>
      </div>
      {note ? <p role="status" className="m-0 text-[14px] text-cream">{note}</p> : null}
      {token.chain === "arc" ? <p className="m-0 text-[12px] text-dim">Two transactions on Arc: distribute, then claim.</p> : null}
    </div>
  );
}
