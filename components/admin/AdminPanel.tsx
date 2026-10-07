"use client";

/**
 * The admin panel: a read-only view of everything that runs Mimir. Sign in with an ADMIN_WALLETS Solana wallet
 * (the holder proof); the server answers 404 to anyone else (app/api/admin/overview). Refreshes every 30 s.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { SURFACE } from "@/components/arena/surface";
import { holderProofHeaders, useHolderTier } from "@/components/token/useHolderTier";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import { Link } from "@/i18n/navigation";
import type { AdminOverview, Health } from "@/lib/server/admin-overview";

const REFRESH_MS = 30_000;
const BTN = "rounded-full bg-coral px-5 py-2.5 text-[14px] font-medium text-[#160909] disabled:opacity-60";
const TONE: Record<Health, string> = { ok: "text-win", warn: "text-pending", down: "text-danger" };
const DOT: Record<Health, string> = { ok: "bg-win", warn: "bg-pending", down: "bg-danger" };

const usdc = (wei: string | null | undefined) => (wei == null ? "–" : (Number(BigInt(wei)) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 2 }));
const short = (a: string | null | undefined) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "–");
const ago = (ms: number | null) => (ms ? `${Math.max(0, Math.round((Date.now() - ms) / 60_000))} min ago` : "never");

/** "2d 4h", "3h 12m", "45m", or "ended 5m ago". */
function until(sec: number, now: number): string {
  const d = sec - now;
  const a = Math.abs(d);
  const s = a >= 86_400 ? `${Math.floor(a / 86_400)}d ${Math.floor((a % 86_400) / 3600)}h` : a >= 3600 ? `${Math.floor(a / 3600)}h ${Math.floor((a % 3600) / 60)}m` : `${Math.floor(a / 60)}m`;
  return d >= 0 ? s : `ended ${s} ago`;
}

export default function AdminPanel() {
  const { wallet, proven, canSign, prove } = useHolderTier();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!wallet || !proven) return;
    try {
      const res = await fetch("/api/admin/overview", { headers: holderProofHeaders(wallet), cache: "no-store" });
      if (res.status === 404) return setDenied(true);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDenied(false);
      setError(null);
      setData((await res.json()) as AdminOverview);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [wallet, proven]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (!wallet || !proven || denied) {
    return (
      <div className="mx-auto grid max-w-[480px] gap-5 py-10">
        <h1 className="m-0 font-display text-app-h1 text-cream">Admin</h1>
        <section className={`${SURFACE} grid gap-4 p-5`}>
          {!wallet ? (
            <ConnectWalletButton />
          ) : !proven ? (
            <button className={BTN} disabled={!canSign || busy} onClick={() => (setBusy(true), void prove().catch(() => undefined).finally(() => setBusy(false)))}>
              {busy ? "Check your wallet…" : "Sign in"}
            </button>
          ) : (
            <p className="m-0 text-[14px] text-muted">This wallet has no access.</p>
          )}
        </section>
      </div>
    );
  }
  if (!data) return <p className="py-10 text-[14px] text-muted">{error ? `Could not load: ${error}` : "Loading…"}</p>;
  return <Dashboard d={data} error={error} />;
}

function Card({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className={`${SURFACE} grid min-w-0 content-start gap-3 p-4 sm:p-5`}>
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[15px] text-cream">{title}</h2>
        {note ? <span className="text-[12px] text-dim">{note}</span> : null}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-panel px-3 py-2.5">
      <p className="m-0 truncate text-[12px] text-muted">{label}</p>
      <p className={`m-0 mt-1 truncate font-mono text-[18px] tabular-nums ${tone ?? "text-cream"}`}>{value}</p>
    </div>
  );
}

/** A table that scrolls inside its card, never the page. */
function Table({ head, rows, empty = "None." }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="m-0 text-[13px] text-muted">{empty}</p>;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
        <thead>
          <tr>{head.map((h) => <th key={h} className="whitespace-nowrap px-1 pb-2 font-normal text-muted">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/5 align-top">
              {r.map((c, j) => <td key={j} className="px-1 py-1.5 text-cream">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Yes = ({ on, n }: { on: boolean; n?: number }) => <span className={on ? "text-win" : "text-dim"}>{on ? (n && n > 1 ? `set ×${n}` : "set") : "not set"}</span>;

function Dashboard({ d, error }: { d: AdminOverview; error: string | null }) {
  const b = d.backend.data;
  const now = Math.floor(d.at / 1000);
  const ex = (kind: "tx" | "address", id: string) => `${d.explorer}/${kind}/${id}`;
  const counts = b?.markets.counts;
  const STATES = ["open", "active", "proposed", "disputed", "resolved", "cancelled", "refundable"];
  const db = d.database.data;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 py-6 sm:gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="m-0 font-display text-app-h1 text-cream">Admin</h1>
        <p className="m-0 text-[12px] text-muted">
          Arc {d.network} · invite-only {d.inviteOnly ? "on" : "off"} · updated {new Date(d.at).toLocaleTimeString("en-GB")} · every 30 s
          {error ? <span className="text-danger"> · last refresh failed: {error}</span> : null}
        </p>
      </header>

      <section aria-label="Status" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {d.status.map((s) => (
          <div key={s.name} className="min-w-0 rounded-xl bg-panel px-3 py-2.5" title={s.note}>
            <p className="m-0 flex items-center gap-2 text-[13px] text-cream">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[s.health]}`} />
              {s.name}
            </p>
            <p className={`m-0 mt-1 truncate text-[12px] ${TONE[s.health]}`}>{s.note}</p>
          </div>
        ))}
      </section>

      {!b ? <Card title="Backend">{<p className="m-0 text-[13px] text-danger">{d.backend.error}</p>}</Card> : null}

      {b ? (
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="Markets" value={b.markets.total} />
          <Stat label="Live" value={b.markets.live.length} />
          <Stat label="New in 24 h" value={b.markets.createdLast24h} />
          <Stat label="Volume (USDC)" value={b.markets.volumeUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })} />
          <Stat label="Fees (USDC)" value={usdc(b.markets.feesWei)} />
          <Stat label="Arc accounts staking" value={b.people.arcAccounts} />
          <Stat label="People (not ours)" value={b.people.nonHouse} />
          <Stat label="Oracle verdicts" value={b.oracle.verdicts} />
        </section>
      ) : null}

      {b && counts ? (
        <Card title="Markets by state" note={`house ${b.markets.byRole.house} · council ${b.markets.byRole.council} · users ${b.markets.byRole.user}`}>
          <Table head={["", ...STATES]} rows={(["vs", "pool"] as const).map((k) => [k.toUpperCase(), ...STATES.map((s) => counts[k][s] ?? 0)])} />
        </Card>
      ) : null}

      {b ? (
        <Card title="Live markets" note="soonest deadline first">
          <Table
            head={["Market", "Question", "State", "Deadline", "Dispute ends", "Stakes A / B", "People", "Creator", "Take"]}
            rows={b.markets.live.map((m) => [
              <Link key="l" href={`/arena/arc/${m.kind}/${m.marketId}`} className="whitespace-nowrap text-coral hover:underline">{m.kind.toUpperCase()} #{m.marketId}</Link>,
              <span key="q" className="line-clamp-2 min-w-[220px]">{m.question}</span>,
              m.status,
              <span key="d" className={`whitespace-nowrap ${m.deadline < now ? "text-pending" : ""}`}>{until(m.deadline, now)}</span>,
              m.disputableUntil ? <span key="u" className="whitespace-nowrap">{until(m.disputableUntil, now)}</span> : "–",
              <span key="s" className="whitespace-nowrap font-mono">{usdc(m.stakeA)} / {usdc(m.stakeB)}</span>,
              m.participants,
              <a key="c" href={ex("address", m.creator)} target="_blank" rel="noreferrer" className="whitespace-nowrap font-mono hover:text-coral">{m.creatorRole === "user" ? short(m.creator) : m.creatorRole}</a>,
              m.hasTake ? "yes" : "–",
            ])}
          />
        </Card>
      ) : null}

      {b ? (
        <Card title="Oracle queue" note={`${b.oracle.waiting} past deadline and waiting · oracle ${short(b.oracle.address)}`}>
          <Table
            head={["Market", "Question", "Attempts", "Next try", "Last error"]}
            rows={b.oracle.deferred.map((t) => [
              <Link key="l" href={`/arena/arc/${t.kind}/${t.marketId}`} className="whitespace-nowrap text-coral hover:underline">{t.kind.toUpperCase()} #{t.marketId}</Link>,
              <span key="q" className="line-clamp-2 min-w-[200px]">{t.question}</span>,
              <span key="a" className={t.attempts >= 5 ? "text-pending" : ""}>{t.attempts}</span>,
              <span key="n" className="whitespace-nowrap">{until(Math.floor(t.notBefore / 1000), now)}</span>,
              <span key="e" className="line-clamp-2 min-w-[240px] text-muted">{t.lastError ?? "–"}</span>,
            ])}
            empty="Nothing deferred."
          />
        </Card>
      ) : null}

      {b ? (
        <Card title="Recently settled">
          <Table
            head={["Market", "Question", "Result", "Confidence", "Summary", "Tx"]}
            rows={b.markets.settled.map((m) => [
              <Link key="l" href={`/arena/arc/${m.kind}/${m.marketId}`} className="whitespace-nowrap text-coral hover:underline">{m.kind.toUpperCase()} #{m.marketId}</Link>,
              <span key="q" className="line-clamp-2 min-w-[200px]">{m.question}</span>,
              m.status === "cancelled" ? "cancelled" : m.winner === 1 ? "A" : m.winner === 2 ? "B" : m.winner === 3 ? "draw" : "refund",
              m.confidence == null ? "–" : `${m.confidence}%`,
              <span key="s" className="line-clamp-2 min-w-[240px] text-muted">{m.summary || "–"}</span>,
              m.txHash ? <a key="t" href={ex("tx", m.txHash)} target="_blank" rel="noreferrer" className="font-mono hover:text-coral">{short(m.txHash)}</a> : "–",
            ])}
          />
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="People on Solana" note="app records">
          {db ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Wallets linked to Arc" value={db.arcAccounts} />
              <Stat label="Let in as holders" value={db.grants.holder ?? 0} />
              <Stat label="Let in by invite" value={db.grants.invite ?? 0} />
              <Stat label="Invite codes used" value={db.invitesUsed} />
              <Stat label="Invite codes unused" value={db.invitesFree} />
              <Stat label="Telegram chats" value={`${db.telegram} (${db.telegramLinked} linked)`} />
              <Stat label="Agents" value={Object.entries(db.agents).map(([k, n]) => `${n} ${k}`).join(" · ") || 0} />
              <Stat label="Agents on Arc" value={db.agentsArc} />
              <Stat label="Deploy fees paid" value={`${db.agentPayments.count} · ${usdc(db.agentPayments.wei)}`} />
              <Stat label="Baskets" value={db.baskets} />
              <Stat label="Basket followers" value={db.subscribers} />
              <Stat label="Copy followers" value={db.copyFollowers} />
              <Stat label="Campaign sign-ups" value={db.campaign} />
              <Stat label="Solana-era markets" value={db.legacyClaims} />
            </div>
          ) : (
            <p className="m-0 text-[13px] text-danger">{d.database.error}</p>
          )}
        </Card>

        <Card title="On Arc" note="backend index">
          {b ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Accounts that staked" value={b.people.arcAccounts} />
              <Stat label="Of them, not ours" value={b.people.nonHouse} />
              <Stat label="Positions" value={b.people.positions} />
              <Stat label="Council takes" value={`${b.council.takes} (${b.council.takesLast24h} in 24 h)`} />
              <Stat label="Council stakes" value={b.council.decisions.staked ?? 0} />
              <Stat label="Council wallets" value={b.council.wallets.length} />
            </div>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Scheduled jobs" note={`indexer at block ${b?.cursorBlock ?? "?"} · chain ${d.chain.head.data ?? "?"}`}>
          <Table
            head={["Job", "Runs every", "Last start", ""]}
            rows={d.jobs.map((j) => [j.name, `${j.everyMinutes < 1 ? `${j.everyMinutes * 60} s` : `${j.everyMinutes} min`}`, ago(j.lastAt), <span key="h" className={TONE[j.health]}>{j.health}</span>])}
          />
        </Card>

        <Card title="Contracts" note="Arc">
          <Table
            head={["", "MimirV3 (VS)", "MimirPool"]}
            rows={[
              ["Address", ...[d.chain.v3, d.chain.pool].map((c, i) => c.data ? <a key={i} href={ex("address", c.data.address)} target="_blank" rel="noreferrer" className="font-mono hover:text-coral">{short(c.data.address)}</a> : <span key={i} className="text-danger">{c.error}</span>)],
              ["Owner (arbiter)", short(d.chain.v3.data?.owner), short(d.chain.pool.data?.owner)],
              ["Oracle", short(d.chain.v3.data?.oracle), short(d.chain.pool.data?.oracle)],
              ["Fee recipient", short(d.chain.v3.data?.feeRecipient), short(d.chain.pool.data?.feeRecipient)],
              ["Paused", String(d.chain.v3.data?.paused ?? "–"), String(d.chain.pool.data?.paused ?? "–")],
              ["Holds (USDC)", usdc(d.chain.v3.data?.balanceWei), usdc(d.chain.pool.data?.balanceWei)],
              ["Owes, estimated", usdc(d.chain.solvency.vs?.owedWei), usdc(d.chain.solvency.pool?.owedWei)],
              ["Surplus", ...[d.chain.solvency.vs, d.chain.solvency.pool].map((s, i) => <span key={i} className={s ? (s.ok ? "text-win" : "text-danger") : ""}>{usdc(s?.surplusWei)}</span>)],
            ]}
          />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Operating wallets" note="USDC on Arc, below 1 flagged">
          <Table
            head={["Wallet", "Address", "USDC"]}
            rows={(d.chain.wallets.data ?? []).map((w) => [w.label, <a key="a" href={ex("address", w.address)} target="_blank" rel="noreferrer" className="font-mono hover:text-coral">{short(w.address)}</a>, <span key="u" className={w.low ? "text-pending" : ""}>{w.usdc?.toFixed(2) ?? "–"}</span>])}
            empty={d.chain.wallets.error ?? "No wallets configured."}
          />
        </Card>

        <Card title="Services">
          <Table
            head={["Service", "State", "Detail"]}
            rows={[
              ["Backend", d.backend.ok ? "up" : "down", d.backend.ok ? `${d.backend.ms} ms` : d.backend.error],
              ["App records", d.database.ok ? "up" : "down", d.database.ok ? `${d.database.ms} ms` : d.database.error],
              ["Arc RPC", d.chain.head.ok ? "up" : "down", d.chain.head.ok ? `block ${d.chain.head.data} · ${d.chain.head.ms} ms` : d.chain.head.error],
              ["Solana devnet RPC", d.solana.devnet.ok ? "up" : "down", d.solana.devnet.ok ? `slot ${d.solana.devnet.data}` : d.solana.devnet.error],
              ["Solana mainnet RPC", d.solana.mainnet.ok ? "up" : "down", d.solana.mainnet.ok ? `slot ${d.solana.mainnet.data}` : d.solana.mainnet.error],
              ["Telegram", d.telegram.ok ? d.telegram.data?.bot : "down", d.telegram.ok ? `${d.telegram.data?.webhook ? "webhook" : "polling"} · ${d.telegram.data?.pending} pending${d.telegram.data?.lastError ? ` · ${d.telegram.data.lastError}` : ""}` : d.telegram.error],
            ]}
          />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Backend settings">
          <Table head={["Setting", "Value"]} rows={Object.entries(b?.settings ?? {}).map(([k, v]) => [<span key="k" className="font-mono">{k}</span>, v ?? <span key="v" className="text-dim">default</span>])} />
        </Card>
        <Card title="Keys" note="whether each is set, never the value">
          <Table
            head={["Key", "Backend", "Site"]}
            rows={[...new Set([...Object.keys(b?.keys ?? {}), ...Object.keys(d.siteKeys)])].sort().map((k) => [
              <span key="k" className="font-mono">{k}</span>,
              b && k in b.keys ? <Yes key="b" on={b.keys[k] > 0} n={b.keys[k]} /> : "–",
              k in d.siteKeys ? <Yes key="s" on={d.siteKeys[k as keyof typeof d.siteKeys]} /> : "–",
            ])}
          />
        </Card>
      </div>
    </div>
  );
}
