"use client";

/**
 * Mimir Terminal output blocks. Each block fetches its own data, so a command
 * prints at once and fills in when the answer lands; the wait is the site's
 * ASCII wave (.:-=+*#%@). Rows, ids and addresses are clickable: a click runs
 * (or types) the command they stand for.
 */
import { useEffect, useState, type ReactNode } from "react";

import { COMMANDS, type MarketFilter } from "@/lib/terminal/commands";
import { col, oddsBar, short, timeLeft, usd, usdc } from "@/lib/terminal/format";

/** Run a command line, or ("fill") put it in the prompt for the user to finish. */
export type Run = (line: string, mode?: "run" | "fill") => void;

const STATE: Record<number, string> = { 0: "open", 1: "live", 2: "settled", 3: "cancelled", 4: "verdict", 5: "disputed" };
const LIVE = new Set([0, 1]);

// ── small pieces ───────────────────────────────────────────────────────────

const WAVE = ".:-=+*#%@";
/** The ASCII wave the hero draws, as a one-line loader. */
export function Wave({ label = "loading" }: { label?: string }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setT((v) => v + 1), 70);
    return () => window.clearInterval(id);
  }, []);
  const row = Array.from({ length: 18 }, (_, i) => WAVE[Math.round((Math.sin(i * 0.55 - t * 0.35) * 0.5 + 0.5) * (WAVE.length - 1))]).join("");
  return (
    <div className="flex items-center gap-3 text-dim" role="status">
      <span className="text-coral" aria-hidden>
        {row}
      </span>
      <span>{label}…</span>
    </div>
  );
}

export function Err({ children }: { children: ReactNode }) {
  return <div className="text-danger">✕ {children}</div>;
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="text-muted">{children}</div>;
}

/** A clickable command: runs `line` on click. */
export function Cmd({ line, run, children, className = "" }: { line: string; run: Run; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => run(line)}
      className={`cursor-pointer text-left underline-offset-4 hover:text-cream hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-coral ${className}`}
    >
      {children}
    </button>
  );
}

/** Fetch JSON's `data` once. */
function useData<T>(url: string): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let alive = true;
    fetch(url)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
        if (!alive) return;
        if (!res.ok || body.data === undefined) setState({ data: null, error: body.error ?? `request failed (${res.status})` });
        else setState({ data: body.data, error: null });
      })
      .catch(() => alive && setState({ data: null, error: "network error" }));
    return () => {
      alive = false;
    };
  }, [url]);
  return state;
}

// ── help ───────────────────────────────────────────────────────────────────

export function Help({ run }: { run: Run }) {
  return (
    <div className="grid gap-1">
      {COMMANDS.map((c) => (
        <div key={c.name} className="grid grid-cols-[minmax(0,22ch)_1fr] gap-4 max-sm:grid-cols-1 max-sm:gap-0">
          <Cmd line={c.usage} run={() => (c.usage.includes("<") ? run(`${c.name} `, "fill") : run(c.name))} className="text-cream">
            {c.usage}
          </Cmd>
          <span className="text-dim">{c.summary}</span>
        </div>
      ))}
      <Note>Tab completes · ↑↓ history · ⌘K commands · paste a contract address to look it up</Note>
    </div>
  );
}

// ── markets ────────────────────────────────────────────────────────────────

interface FeedClaim {
  id: number;
  question: string;
  category: string;
  creatorStake: string;
  totalChallengerStake: string;
  deadline: number;
  state: number;
  challengers: unknown[];
  resolutionSummary?: string;
  confidence?: number;
  creatorPosition?: string;
  counterPosition?: string;
  resolutionUrl?: string;
  winnerSide?: number;
}

export function filterMarkets(claims: FeedClaim[], filter: MarketFilter, nowMs = Date.now()): FeedClaim[] {
  const now = nowMs / 1000;
  const live = (c: FeedClaim) => LIVE.has(c.state) && c.deadline > now;
  switch (filter) {
    case "live":
      return claims.filter(live);
    case "closing":
      return claims.filter((c) => live(c) && c.deadline - now < 86_400).sort((a, b) => a.deadline - b.deadline);
    case "crypto":
    case "sports":
      return claims.filter((c) => c.category.toLowerCase() === filter);
    case "settled":
      return claims.filter((c) => c.state === 2);
    default:
      return [...claims].sort((a, b) => Number(live(b)) - Number(live(a)) || b.id - a.id);
  }
}

export function Markets({ filter, run }: { filter: MarketFilter; run: Run }) {
  const { data, error } = useData<{ claims: FeedClaim[] }>("/api/arena/claims");
  if (error) return <Err>{error}</Err>;
  if (!data) return <Wave label="reading markets" />;
  const rows = filterMarkets(data.claims, filter).slice(0, 20);
  if (rows.length === 0) return <Note>no {filter === "all" ? "" : `${filter} `}markets right now. Try markets.</Note>;
  return (
    <div className="grid gap-0.5 overflow-x-auto">
      <div className="whitespace-pre text-dim">{`${col("#", 5)}${col("market", 48)}${col("state", 9)}${col("pool", 10)}${col("creator side", 18)}left`}</div>
      {rows.map((c) => (
        <Cmd key={c.id} line={`market ${c.id}`} run={run} className="whitespace-pre text-muted">
          <span className="text-coral">{col(`#${c.id}`, 5)}</span>
          <span className="text-cream">{col(c.question, 48)}</span>
          {col(STATE[c.state] ?? "?", 9)}
          {col(`$${usdc(BigInt(c.creatorStake) + BigInt(c.totalChallengerStake))}`, 10)}
          {col(oddsBar(c.creatorStake, c.totalChallengerStake, 10), 18)}
          {LIVE.has(c.state) ? timeLeft(c.deadline) : ""}
        </Cmd>
      ))}
      <Note>
        {rows.length} shown · click a row, or <span className="text-cream">market &lt;id&gt;</span>
      </Note>
    </div>
  );
}

export function Market({ id, run }: { id: number; run: Run }) {
  const { data: c, error } = useData<FeedClaim>(`/api/arena/${id}`);
  if (error) return <Err>{error}</Err>;
  if (!c) return <Wave label={`reading #${id}`} />;
  const pool = BigInt(c.creatorStake) + BigInt(c.totalChallengerStake);
  return (
    <div className="grid max-w-[80ch] gap-2 border-l-2 border-coral/60 pl-4">
      <div className="text-dim">
        <span className="text-coral">#{c.id}</span> · {c.category} · {STATE[c.state] ?? "?"} ·{" "}
        {LIVE.has(c.state) ? `closes in ${timeLeft(c.deadline)}` : new Date(c.deadline * 1000).toUTCString()}
      </div>
      <div className="font-display text-[1.6rem] leading-tight text-cream">{c.question}</div>
      <div className="grid gap-0.5">
        <div>
          <span className="text-dim">creator </span>
          <span className="text-cream">{c.creatorPosition}</span> <span className="text-dim">· {usdc(c.creatorStake)} USDC</span>
        </div>
        <div>
          <span className="text-dim">against </span>
          <span className="text-cream">{c.counterPosition}</span>{" "}
          <span className="text-dim">
            · {usdc(c.totalChallengerStake)} USDC from {c.challengers.length}
          </span>
        </div>
        <div className="whitespace-pre text-coral">{oddsBar(c.creatorStake, c.totalChallengerStake, 24)} creator side · pool {usdc(pool)} USDC</div>
      </div>
      {c.resolutionSummary ? (
        <div className="text-muted">
          verdict{c.confidence ? ` (${c.confidence}%)` : ""}: {c.resolutionSummary}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-dim">
        <Cmd line="agents" run={run}>
          ask an agent about it →
        </Cmd>
        <a href={`/en/arena/${c.id}`} className="underline-offset-4 hover:text-cream hover:underline">
          open in arena ↗
        </a>
      </div>
    </div>
  );
}

// ── agents ─────────────────────────────────────────────────────────────────

interface RosterPersona {
  slug: string;
  displayName: string;
  emoji: string;
  bio: string;
  track: string;
}

export function Agents({ run }: { run: Run }) {
  const { data, error } = useData<{ personas: RosterPersona[] }>("/api/council/roster");
  if (error) return <Err>{error}</Err>;
  if (!data) return <Wave label="reading agents" />;
  return (
    <div className="grid gap-0.5">
      <div className="text-dim">house agents · free</div>
      {data.personas.map((p) => (
        <Cmd key={p.slug} line={`use ${p.slug}`} run={run} className="grid grid-cols-[3ch_minmax(0,18ch)_1fr] gap-3 text-muted max-sm:grid-cols-[3ch_1fr]">
          <span aria-hidden>{p.emoji}</span>
          <span className="text-cream">{p.slug}</span>
          <span className="truncate max-sm:hidden">{p.bio}</span>
        </Cmd>
      ))}
      <Note>
        click one, or <span className="text-cream">use &lt;agent&gt;</span>. Community agents with their own models land here next.
      </Note>
    </div>
  );
}

// ── tokens ─────────────────────────────────────────────────────────────────

interface TokenInfo {
  mint: string;
  name: string | null;
  symbol: string | null;
  priceUsd: number | null;
  change24hPct: number | null;
  mcapUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  holders: number | null;
  verified: boolean | null;
  organicScore: string | null;
  mintAuthorityDisabled: boolean | null;
  freezeAuthorityDisabled: boolean | null;
  topHoldersPct: number | null;
  source: string;
}

const flag = (ok: boolean | null, good: string, bad: string) =>
  ok === null ? <span className="text-dim">unknown</span> : ok ? <span className="text-win">✓ {good}</span> : <span className="text-danger">✕ {bad}</span>;

export function Token({ mint, run, label }: { mint: string; run: Run; label?: string }) {
  const { data: t, error } = useData<TokenInfo>(`/api/terminal/token?mint=${mint}`);
  if (error) return <Err>{error}</Err>;
  if (!t) return <Wave label={`reading ${short(mint)}`} />;
  const change = t.change24hPct;
  return (
    <div className="grid max-w-[80ch] gap-2 border-l-2 border-coral/60 pl-4">
      <div className="text-dim">
        {label ?? "token"} · <span className="text-cream">{t.name ?? "unnamed"}</span>
        {t.symbol ? <span className="text-coral"> ${t.symbol}</span> : null} · {short(mint, 6, 6)} · Solana mainnet
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4">
        <span className="font-display text-[2rem] leading-none text-cream">{usd(t.priceUsd)}</span>
        {change !== null ? (
          <span className={change >= 0 ? "text-win" : "text-danger"}>
            {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}% 24h
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 sm:grid-cols-4">
        <span><span className="text-dim">mcap </span>{usd(t.mcapUsd)}</span>
        <span><span className="text-dim">liquidity </span>{usd(t.liquidityUsd)}</span>
        <span><span className="text-dim">vol 24h </span>{usd(t.volume24hUsd)}</span>
        <span><span className="text-dim">holders </span>{t.holders?.toLocaleString("en-US") ?? "n/a"}</span>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-0.5">
        {flag(t.mintAuthorityDisabled, "mint authority off", "mint authority on")}
        {flag(t.freezeAuthorityDisabled, "freeze authority off", "freeze authority on")}
        {t.topHoldersPct !== null ? (
          <span className={t.topHoldersPct > 50 ? "text-danger" : "text-muted"}>top holders {t.topHoldersPct.toFixed(1)}%</span>
        ) : null}
        {t.organicScore ? <span className="text-muted">organic score {t.organicScore}</span> : null}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-dim">
        <Cmd line="agents" run={run}>ask an agent about it →</Cmd>
        <a href={`https://pump.fun/coin/${mint}`} target="_blank" rel="noreferrer noopener" className="underline-offset-4 hover:text-cream hover:underline">
          pump.fun ↗
        </a>
        <a href={`https://dexscreener.com/solana/${mint}`} target="_blank" rel="noreferrer noopener" className="underline-offset-4 hover:text-cream hover:underline">
          dexscreener ↗
        </a>
      </div>
    </div>
  );
}
