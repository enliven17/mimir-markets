"use client";

/**
 * /campaign body: your score and invite link, how points are earned, and the
 * leaderboard. Joining is one free signature; `?ref=CODE` pre-fills the code.
 */
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";

import { SURFACE } from "@/components/arena/surface";
import { useSignText } from "@/components/copy/useSignText";
import Skeleton from "@/components/ui/Skeleton";
import ConnectWalletButton from "@/components/wallet/ConnectWalletButton";
import {
  CAMPAIGN_WEIGHTS,
  campaignJoinMessage,
  EARLY_MULTIPLIER,
  EARLY_SLOTS,
  HOLDER_MULTIPLIER,
  HOLDER_TIER_LABEL,
  INVITE_CODE_PATTERN,
  INVITE_POINTS,
  INVITE_SHARE,
  INVITED_MULTIPLIER,
  type CampaignMetrics,
} from "@/lib/campaign";
import { explorerUrl } from "@/lib/solana/config";

interface Row extends CampaignMetrics {
  wallet: string;
  invites: number;
  invited: boolean;
  early: boolean;
  tier: keyof typeof HOLDER_MULTIPLIER;
  score: number;
}
interface Board {
  rows: Row[];
  total: number;
  me: { row: Row | null; rank: number | null; code: string | null } | null;
}

const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export default function CampaignClient() {
  const { publicKey } = useWallet();
  const wallet = publicKey?.toBase58() ?? null;
  const [board, setBoard] = useState<Board | null>(null);

  const load = useCallback(() => {
    fetch(`/api/campaign${wallet ? `?wallet=${wallet}` : ""}`)
      .then((r) => r.json())
      .then((d: Board) => setBoard({ rows: d.rows ?? [], total: d.total ?? 0, me: d.me ?? null }))
      .catch(() => setBoard((prev) => prev ?? { rows: [], total: 0, me: null }));
  }, [wallet]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 sm:gap-8">
      <header className="grid gap-2">
        <p className="m-0 font-mono text-[12px] uppercase tracking-[0.2em] text-coral">Testnet campaign · devnet</p>
        <h1 className="m-0 font-display text-app-h1 text-cream">Climb the board.</h1>
        <p className="m-0 max-w-[60ch] text-[15px] leading-relaxed text-muted">
          Stake on devnet, connect agents, build and follow baskets, copy trade and invite friends. Every action scores points. Devnet USDC only:
          nothing here costs real money.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <YourScore wallet={wallet} board={board} onJoined={load} />
        <Points />
      </div>

      <Leaderboard board={board} wallet={wallet} />
    </div>
  );
}

function YourScore({ wallet, board, onJoined }: { wallet: string | null; board: Board | null; onJoined: () => void }) {
  const sign = useSignText();
  const ref = (useSearchParams().get("ref") ?? "").toUpperCase();
  const [code, setCode] = useState(INVITE_CODE_PATTERN.test(ref) ? ref : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const me = board?.me;

  async function join() {
    if (!wallet || !sign) return;
    const inviteCode = code.trim().toUpperCase() || null;
    if (inviteCode && !INVITE_CODE_PATTERN.test(inviteCode)) return setError("An invite code is 8 letters and digits.");
    setBusy(true);
    setError(null);
    try {
      const signature = await sign(campaignJoinMessage(wallet, inviteCode));
      const res = await fetch("/api/campaign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet, inviteCode, signature }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Joining failed.");
      onJoined();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signing was cancelled.");
    } finally {
      setBusy(false);
    }
  }

  const link = me?.code ? `${window.location.origin}${window.location.pathname}?ref=${me.code}` : "";

  return (
    <section className={`${SURFACE} grid content-start gap-4 p-5 sm:p-6`}>
      <h2 className="m-0 text-[1.2rem] leading-none text-cream">Your score</h2>
      {!wallet ? (
        <div className="grid justify-items-start gap-3">
          <p className="m-0 text-[14px] text-muted">Connect a wallet to see your points and get your invite link.</p>
          <ConnectWalletButton />
        </div>
      ) : !board ? (
        <Skeleton className="h-[120px] rounded-xl" />
      ) : (
        <>
          <div className="flex items-end gap-4">
            <span className="font-display text-[3rem] leading-none text-cream">{num(me?.row?.score ?? 0)}</span>
            <span className="pb-1 font-mono text-[13px] text-muted">
              {me?.rank ? `rank #${me.rank} of ${board.total}` : "no points yet"}
              {me?.row?.invited ? ` · ×${INVITED_MULTIPLIER} invited` : ""}
            </span>
            {me?.row?.early ? <EarlyBadge /> : null}
            {me?.row && me.row.tier !== "none" ? <HolderBadge tier={me.row.tier} /> : null}
          </div>
          {me?.row ? (
            <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px] text-muted">
              <span>{num(me.row.volumeUsdc)} USDC</span>
              <span>{me.row.agents} agents</span>
              <span>{me.row.baskets} baskets</span>
              <span>{me.row.follows} follows</span>
              <span>{me.row.copies} copies</span>
              <span>{me.row.invites} invites</span>
            </p>
          ) : null}
          {me?.code ? (
            <div className="grid gap-2 border-t border-line pt-4">
              <p className="m-0 text-[13px] text-muted">
                Your invite code <span className="font-mono text-cream">{me.code}</span>. Share the link:
              </p>
              <div className="flex items-stretch gap-2">
                <code className="min-w-0 flex-1 truncate rounded-xl bg-ink-deep px-3 py-2.5 font-mono text-[12px] text-cream">{link}</code>
                <button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard.writeText(link).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    })
                  }
                  className="press shrink-0 rounded-xl bg-panel-raised px-4 text-[13px] text-cream"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ) : (
            <form
              className="grid gap-3 border-t border-line pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                void join();
              }}
            >
              <label className="grid gap-1.5 text-[13px] text-muted">
                Invite code (optional, can't be changed later)
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={8}
                  placeholder="ABCD1234"
                  className="rounded-xl bg-ink-deep px-3 py-2.5 font-mono text-[14px] text-cream outline-none placeholder:text-dim"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !sign}
                className="justify-self-start rounded-full bg-coral px-6 py-2.5 text-[14px] font-medium text-[#160909] disabled:opacity-60"
              >
                {busy ? "Waiting for signature…" : sign ? "Join and get my invite link" : "This wallet cannot sign messages"}
              </button>
              <p className="m-0 text-[12px] text-muted">One free signature, no transaction. Your activity counts either way; joining gives you an invite code, and the first {EARLY_SLOTS} to join get ×{EARLY_MULTIPLIER} and the early badge.</p>
            </form>
          )}
          {error ? (
            <p role="alert" className="m-0 text-[13px] text-coral">
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function EarlyBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title={`One of the first ${EARLY_SLOTS} to join: ×${EARLY_MULTIPLIER} points`}
      className={`inline-flex items-center rounded-full bg-coral/[0.14] px-2 py-0.5 align-middle font-mono text-[10px] uppercase tracking-wider text-coral ${className}`}
    >
      Early
    </span>
  );
}

function HolderBadge({ tier, className = "" }: { tier: Exclude<Row["tier"], "none">; className?: string }) {
  return (
    <span
      title={`$MIMIR ${HOLDER_TIER_LABEL[tier]}: ×${HOLDER_MULTIPLIER[tier]} points`}
      className={`inline-flex items-center rounded-full bg-cream/[0.08] px-2 py-0.5 align-middle font-mono text-[10px] uppercase tracking-wider text-cream ${className}`}
    >
      {HOLDER_TIER_LABEL[tier]} ×{HOLDER_MULTIPLIER[tier]}
    </span>
  );
}

function Points() {
  return (
    <section className={`${SURFACE} grid content-start gap-3 p-5 sm:p-6`}>
      <h2 className="m-0 text-[1.2rem] leading-none text-cream">How points work</h2>
      <ul className="m-0 grid list-none gap-2 p-0">
        {Object.values(CAMPAIGN_WEIGHTS).map((w) => (
          <li key={w.label} className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="text-cream">{w.label}</span>
            <span className="text-right font-mono text-[12px] text-muted">
              <span className="text-coral">{w.points} pts</span> {w.unit}
              {w.cap ? ` · up to ${w.cap}` : ""}
            </span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 text-[14px]">
          <span className="text-cream">Invites</span>
          <span className="text-right font-mono text-[12px] text-muted">
            <span className="text-coral">{INVITE_POINTS} pts</span> per active invitee + {INVITE_SHARE * 100}% of their points
          </span>
        </li>
        <li className="flex items-baseline justify-between gap-3 text-[14px]">
          <span className="flex items-center gap-2 text-cream">
            First {EARLY_SLOTS} to join <EarlyBadge />
          </span>
          <span className="font-mono text-[12px] text-coral">×{EARLY_MULTIPLIER} on your points</span>
        </li>
        <li className="grid gap-1.5 text-[14px]">
          <span className="text-cream">Hold $MIMIR</span>
          <span className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px] text-muted">
            <span>10k <span className="text-coral">×{HOLDER_MULTIPLIER.holder}</span></span>
            <span>1M <span className="text-coral">×{HOLDER_MULTIPLIER.backer}</span></span>
            <span>10M <span className="text-coral">×{HOLDER_MULTIPLIER["oracle-circle"]}</span></span>
            <span>on mainnet, read live</span>
          </span>
        </li>
        <li className="flex items-baseline justify-between gap-3 text-[14px]">
          <span className="text-cream">Joined with a code</span>
          <span className="font-mono text-[12px] text-coral">×{INVITED_MULTIPLIER} on your points</span>
        </li>
      </ul>
      <p className="m-0 text-[12px] leading-relaxed text-muted">
        Volume is USDC staked as a creator or challenger, by you or by agents you own. An invite counts once the invited wallet has points of its own.
      </p>
    </section>
  );
}

function Leaderboard({ board, wallet }: { board: Board | null; wallet: string | null }) {
  return (
    <section aria-labelledby="campaign-board" className="grid gap-3">
      <h2 id="campaign-board" className="m-0 font-display text-[1.6rem] leading-none text-cream">
        Leaderboard {board ? <span className="ml-2 font-mono text-[14px] text-muted">{board.total}</span> : null}
      </h2>
      {!board ? (
        <Skeleton className="h-[320px] rounded-2xl" />
      ) : board.rows.length === 0 ? (
        <p className={`${SURFACE} m-0 p-6 text-[14px] text-muted`}>No points yet. Stake on a devnet market to be first.</p>
      ) : (
        <div className={`${SURFACE} overflow-x-auto`} data-lenis-prevent>
          <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
            <thead className="font-mono text-[11px] uppercase tracking-wide text-muted">
              <tr>
                {["#", "Wallet", "Volume", "Agents", "Baskets", "Follows", "Copies", "Invites", "Score"].map((h, i) => (
                  <th key={h} scope="col" className={`px-4 py-3 font-normal ${i >= 2 ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.rows.map((r, i) => (
                <tr key={r.wallet} className={`border-t border-line ${r.wallet === wallet ? "bg-coral/[0.08]" : ""}`}>
                  <td className={`px-4 py-3 font-mono ${i < 3 ? "text-coral" : "text-muted"}`}>{i + 1}</td>
                  <td className="px-4 py-3">
                    <a href={explorerUrl("address", r.wallet)} target="_blank" rel="noreferrer" className="font-mono text-cream hover:text-coral">
                      {short(r.wallet)}
                    </a>
                    {r.early ? <EarlyBadge className="ml-2" /> : null}
                    {r.tier !== "none" ? <HolderBadge tier={r.tier} className="ml-2" /> : null}
                    {r.wallet === wallet ? <span className="ml-2 font-mono text-[11px] text-coral">you</span> : null}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-cream">{num(r.volumeUsdc)}</td>
                  <td className="px-4 py-3 text-right font-mono text-muted">{r.agents}</td>
                  <td className="px-4 py-3 text-right font-mono text-muted">{r.baskets}</td>
                  <td className="px-4 py-3 text-right font-mono text-muted">{r.follows}</td>
                  <td className="px-4 py-3 text-right font-mono text-muted">{r.copies}</td>
                  <td className="px-4 py-3 text-right font-mono text-muted">{r.invites}</td>
                  <td className="px-4 py-3 text-right font-mono text-cream">{num(r.score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
