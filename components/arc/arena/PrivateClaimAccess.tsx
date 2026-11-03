"use client";

import { useState } from "react";
import type { Address } from "viem";
import { parseInviteWallets, readClaimInvitation } from "@/lib/chains/invites";
import { chainPublicClient } from "@/lib/chains/client";
import { explorerUrl } from "@/lib/chains/registry";
import { SURFACE } from "@/components/arena/surface";
import { BTN_PRIMARY, BTN_SECONDARY, type ArcMarket } from "./shared";
import type { useArcAccount } from "./useArcAccount";
import { useArcSend } from "./useArcSend";
import { useClaimInvitation } from "./useClaimInvitation";

/** On-demand management: the mapping cannot enumerate every previously approved wallet. */
export default function PrivateClaimAccess({ m, account }: { m: ArcMarket; account: ReturnType<typeof useArcAccount> }) {
  const cfg = account.chainConfig;
  const owner = account.address?.toLowerCase() === m.creator.toLowerCase();
  const editable = m.kind === "vs" && m.isPrivate && owner && ["open", "active"].includes(m.status);
  const support = useClaimInvitation(cfg, 0, account.address, editable);
  const { send, busy, error, last } = useArcSend(account);
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [results, setResults] = useState<{ key: string; rows: Array<{ wallet: Address; allowed: boolean }> } | null>(null);
  const key = `${cfg.id}:${cfg.contracts.mimirV3}:${m.marketId}:${account.address}:${text}`;
  let wallets: Address[] = [], problem: string | null = null;
  try { wallets = parseInviteWallets(text, m.creator); } catch (err) { problem = (err as Error).message; }
  if (!editable) return null;

  const check = async () => {
    if (problem || !cfg.contracts.mimirV3) return;
    setReading(true); setReadError(null);
    try {
      const rows = await Promise.all(wallets.map(async wallet => ({ wallet, allowed: await readClaimInvitation(chainPublicClient(cfg), cfg.contracts.mimirV3!, m.marketId, wallet) })));
      setResults({ key, rows });
    } catch { setResults(null); setReadError("Could not verify wallet approvals. Try again before sharing the claim."); }
    finally { setReading(false); }
  };
  const change = async (allowed: boolean) => {
    if (problem || !support.checked) return;
    if (await send({ type: "invite", marketId: m.marketId, accounts: wallets, allowed })) { await check(); void account.reload(); }
  };
  const disabled = busy || reading || Boolean(problem) || !support.checked;

  return <section aria-label="Private claim access" className={`${SURFACE} grid gap-3 p-5`}>
    <h2 className="m-0 text-[16px] text-cream">Manage approved wallets</h2>
    <p className="m-0 text-[13px] leading-relaxed text-muted">This claim starts closed to challengers. Only wallets you approve can join; sharing its link does not grant access. Questions, transactions and wallet approvals remain public on chain.</p>
    <label className="grid gap-1.5 text-[13px] text-muted">Wallet addresses
      <textarea rows={3} value={text} onChange={e => { setText(e.target.value); setReadError(null); }} placeholder="0x… · separate wallets with commas or new lines" className="w-full min-w-0 rounded-xl bg-ink-deep p-3 font-mono text-[13px] text-cream outline-none focus-visible:ring-1 focus-visible:ring-coral" />
    </label>
    <p className="m-0 text-[12px] leading-relaxed text-dim">Check or change up to 100 wallets per transaction. Enter a smart wallet&apos;s own address. Revoking approval prevents future entry; it does not remove an existing stake or payout right. Rematches need new approvals.</p>
    {text.trim() && problem ? <p className="m-0 text-[13px] text-pending">{problem}</p> : null}
    {!support.checked ? <p className="m-0 text-[13px] text-pending">{support.error ? "Wallet permissions are unavailable on this contract. Approval changes are blocked." : "Checking wallet-permission support…"}</p> : null}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={BTN_SECONDARY} disabled={disabled} onClick={() => void check()}>Check wallets</button>
      <button type="button" data-private-approve className={BTN_PRIMARY} disabled={disabled} onClick={() => void change(true)}>{busy ? "Confirm in your wallet…" : "Approve wallets"}</button>
      <button type="button" className={BTN_SECONDARY} disabled={disabled} onClick={() => void change(false)}>Revoke wallets</button>
    </div>
    {results?.key === key ? <ul className="m-0 grid list-none gap-2 p-0">{results.rows.map(({ wallet, allowed }) => <li key={wallet} className="flex flex-wrap justify-between gap-2 text-[12px]"><span className="break-all font-mono text-muted">{wallet}</span><span className={allowed ? "text-win" : "text-pending"}>{allowed ? "Approved" : "Not approved"}</span></li>)}</ul> : null}
    {reading ? <p role="status" className="m-0 text-[13px] text-muted">Reading current approvals…</p> : null}
    {readError || error ? <p role="alert" className="m-0 text-[13px] text-danger">{readError ?? error}</p> : null}
    {last ? <a href={explorerUrl(cfg, "tx", last.txHash)} target="_blank" rel="noreferrer" className="text-[13px] text-coral hover:underline">Approval change confirmed · view transaction</a> : null}
  </section>;
}
