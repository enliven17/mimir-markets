"use client";

/**
 * /dashboard on Arc: the passkey account's balances (Arc and the linked
 * Solana wallet), any payout a contract parked for it (a refused push, pulled
 * with withdraw()), its record, and every position it holds, live from Convex.
 * Payouts are pushed to the account at settlement (VS) or by the oracle
 * (pools), so there is nothing to claim here except a parked one.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { encodeFunctionData, parseAbi, type Address } from "viem";

import { api } from "@/convex/_generated/api";
import { SURFACE } from "@/components/arena/surface";
import { useNowSec } from "@/components/arena/settlement/useSettleAction";
import Skeleton from "@/components/ui/Skeleton";
import { Link } from "@/i18n/navigation";
import { arcPublicClient } from "@/lib/arc/chain";
import { ARC, arcExplorerUrl } from "@/lib/arc/config";
import { formatUsdcUnits } from "@/lib/arc/encoding";
import AccountGate from "../arena/AccountGate";
import { arcPhase, BTN_PRIMARY, BTN_SECONDARY, KIND_LABEL, PHASE_DOT, PHASE_LABEL, usd, type ArcMarket } from "../arena/shared";
import { useArcAccount } from "../arena/useArcAccount";
import { useArcSend } from "../arena/useArcSend";
import { useArcBalances } from "../useArcBalances";

const PARKED_ABI = parseAbi(["function pendingWithdrawals(address) view returns (uint256)", "function withdraw()"]);

type Result = "open" | "won" | "lost" | "refunded" | "settling";

function resultOf(m: ArcMarket, side: number, now: number): Result {
  const phase = arcPhase(m, now);
  if (phase === "cancelled") return "refunded";
  if (phase !== "resolved") return phase === "open" ? "open" : "settling";
  if (m.winner === side) return "won";
  return m.winner === 1 || m.winner === 2 ? "lost" : "refunded";
}

const RESULT_LABEL: Record<Result, string> = { open: "Open", settling: "Settling", won: "Won", lost: "Lost", refunded: "Refunded" };
const RESULT_TONE: Record<Result, string> = { open: "text-cream", settling: "text-pending", won: "text-win", lost: "text-danger", refunded: "text-muted" };

export default function ArcDashboard() {
  const account = useArcAccount();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="m-0 font-display text-app-h1 text-cream">Portfolio</h1>
        {account.address ? (
          <a href={arcExplorerUrl("address", account.address)} target="_blank" rel="noreferrer" className="truncate font-mono text-[13px] text-muted hover:text-coral">
            {account.address.slice(0, 6)}…{account.address.slice(-4)} ↗
          </a>
        ) : null}
      </header>
      <AccountGate account={account}>{account.address ? <Body account={account} address={account.address} /> : null}</AccountGate>
    </div>
  );
}

function Body({ account, address }: { account: ReturnType<typeof useArcAccount>; address: Address }) {
  const now = useNowSec(30_000);
  const positions = useQuery(api.arc.positionsOf, { user: address });
  const { arcUnits, solanaUnits, reload } = useArcBalances(address, account.wallet.solana);
  const parked = useParked(address);
  const { send, busy, error } = useArcSend(account.session);

  const rows = useMemo(
    () =>
      (positions ?? [])
        .filter((p): p is typeof p & { market: ArcMarket } => p.market !== null)
        .map((p) => ({ ...p, result: resultOf(p.market, p.side, now) }))
        .sort((a, b) => b.market.createdAt - a.market.createdAt),
    [positions, now],
  );
  const won = rows.filter((r) => r.result === "won").length;
  const lost = rows.filter((r) => r.result === "lost").length;
  const atRisk = rows.filter((r) => r.result === "open" || r.result === "settling").reduce((s, r) => s + BigInt(r.amount), 0n);

  const withdraw = async (contract: Address) => {
    if (await send([{ to: contract, data: encodeFunctionData({ abi: PARKED_ABI, functionName: "withdraw" }) }])) {
      void parked.reload();
      void reload();
    }
  };

  return (
    <>
      <section aria-label="Balances" className={`${SURFACE} grid gap-5 p-5 sm:flex sm:items-end sm:justify-between sm:p-7`}>
        <div className="min-w-0">
          <p className="m-0 text-[13px] text-muted">Arc balance · {ARC.network}</p>
          <p className="m-0 mt-2 flex h-[clamp(2.6rem,11vw,3.6rem)] items-center font-mono text-[clamp(2.3rem,10vw,3.4rem)] leading-none tabular-nums text-cream">
            {arcUnits === null ? (
              <Skeleton className="h-[70%] w-40" />
            ) : (
              <>
                <span className="mr-1 text-[0.6em] text-muted">$</span>
                {formatUsdcUnits(arcUnits)}
              </>
            )}
          </p>
          <p className="m-0 mt-2 text-[13px] text-muted">
            {account.wallet.solana ? `${solanaUnits === null ? "…" : formatUsdcUnits(solanaUnits)} USDC in your Solana wallet` : "Connect your Solana wallet to move USDC in or out"}
          </p>
        </div>
        <Link href="/wallet" className={`${BTN_PRIMARY} text-center sm:flex-none`}>
          Deposit or withdraw
        </Link>
      </section>

      {parked.items.length > 0 ? (
        <section aria-label="Parked payouts" className={`${SURFACE} grid gap-3 p-5`}>
          <h2 className="m-0 text-[15px] text-cream">Payouts waiting for you</h2>
          <p className="m-0 text-[13px] text-muted">A payout your account did not accept automatically. Pull it in one step, no gas.</p>
          {parked.items.map((p) => (
            <div key={p.contract} className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-mono text-[15px] text-cream">{usd(p.amount)}</span>
              <button type="button" disabled={busy} onClick={() => void withdraw(p.contract)} className={BTN_SECONDARY}>
                {busy ? "Confirm with your passkey…" : "Withdraw"}
              </button>
            </div>
          ))}
          {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}
        </section>
      ) : null}

      <section aria-labelledby="positions" className="grid gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="positions" className="m-0 font-display text-[1.6rem] leading-none text-cream">
            Positions
          </h2>
          {rows.length ? (
            <p className="m-0 text-[13px] text-muted">
              {won} won · {lost} lost · {usd(atRisk)} at risk
            </p>
          ) : null}
        </div>
        {positions === undefined ? (
          <Skeleton className="h-32 w-full rounded-2xl" />
        ) : rows.length === 0 ? (
          <p className="m-0 py-10 text-center text-[14px] text-muted">
            No positions yet.{" "}
            <Link href="/arena" className="text-coral hover:underline">
              Find a market
            </Link>
          </p>
        ) : (
          <ul className={`${SURFACE} m-0 grid list-none gap-0 p-2 sm:p-3`}>
            {rows.map((r) => {
              const phase = arcPhase(r.market, now);
              return (
                <li key={r._id} className="border-b border-line last:border-0">
                  <Link href={`/arena/arc/${r.kind}/${r.marketId}`} className="grid gap-1 rounded-xl px-3 py-3 hover:bg-panel sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[12px] text-muted">
                        <span className="font-mono uppercase tracking-[0.12em] text-coral">{KIND_LABEL[r.kind]}</span>
                        <span className="font-mono text-dim">#{r.marketId}</span>
                        <span aria-hidden className={`h-[6px] w-[6px] rounded-full ${PHASE_DOT[phase]}`} />
                        {PHASE_LABEL[phase]}
                      </span>
                      <span className="mt-1 block truncate text-[15px] text-cream">{r.market.question}</span>
                      <span className="text-[12px] text-muted">On {r.side === 1 ? r.market.labelA : r.market.labelB}</span>
                    </span>
                    <span className="flex items-baseline gap-3 sm:justify-end">
                      <span className="font-mono text-[14px] text-cream">{usd(r.amount)}</span>
                      <span className={`text-[13px] ${RESULT_TONE[r.result]}`}>{RESULT_LABEL[r.result]}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

/** Payouts a contract parked for this account (pendingWithdrawals), on both market contracts. */
function useParked(address: Address) {
  const [items, setItems] = useState<{ contract: Address; amount: bigint }[]>([]);
  const reload = useCallback(async () => {
    const contracts = [ARC.contracts.mimirV3, ARC.contracts.mimirPool].filter((c): c is Address => Boolean(c));
    const client = arcPublicClient();
    const read = await Promise.all(
      contracts.map((c) =>
        client
          .readContract({ address: c, abi: PARKED_ABI, functionName: "pendingWithdrawals", args: [address] })
          .then((amount) => ({ contract: c, amount }))
          .catch(() => ({ contract: c, amount: 0n })),
      ),
    );
    setItems(read.filter((r) => r.amount > 0n));
  }, [address]);
  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 30_000);
    return () => clearInterval(t);
  }, [reload]);
  return { items, reload };
}
