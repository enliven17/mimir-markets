"use client";

/**
 * Invite codes in the admin panel: mint codes (with a note saying who they are for) and see every code, who it came
 * from and who used it. Talks to /api/admin/invites with the panel's admin session.
 */
import { useCallback, useEffect, useState } from "react";

import type { InviteRow } from "@/lib/server/access";
import { Card, Table } from "./ui";

type Filter = "all" | "unused" | "used";
const INPUT = "min-w-0 rounded-full border border-white/10 bg-panel px-4 py-2 text-[14px] text-cream placeholder:text-dim focus:border-coral/60 focus:outline-none";
const BTN = "rounded-full bg-coral px-5 py-2 text-[14px] font-medium text-[#160909] disabled:opacity-60";
const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "–");

function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="whitespace-nowrap rounded-full border border-white/10 px-3 py-1 text-[12px] text-muted hover:border-coral/60 hover:text-cream"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export default function InvitesCard({ token }: { token: string }) {
  const [invites, setInvites] = useState<InviteRow[] | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const [count, setCount] = useState("5");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(
    async (init?: RequestInit) => {
      const res = await fetch("/api/admin/invites", { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as { invites?: InviteRow[]; codes?: string[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.invites) setInvites(body.invites);
      return body;
    },
    [token],
  );

  useEffect(() => {
    call().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [call]);

  const mint = async () => {
    setBusy(true);
    setError(null);
    try {
      const { codes } = await call({ method: "POST", body: JSON.stringify({ count: Number(count), note }) });
      setFresh(codes ?? []);
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const all = invites ?? [];
  const used = all.filter((i) => i.usedBy);
  const shown = filter === "all" ? all : filter === "used" ? used : all.filter((i) => !i.usedBy);

  return (
    <Card title="Invite codes" note={invites ? `${all.length} made · ${used.length} used · ${all.length - used.length} free` : undefined}>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void mint();
        }}
      >
        <input aria-label="How many codes" type="number" min={1} max={50} value={count} onChange={(e) => setCount(e.target.value)} className={`${INPUT} w-20`} />
        <input aria-label="Note" placeholder="Who are they for? (optional)" maxLength={60} value={note} onChange={(e) => setNote(e.target.value)} className={`${INPUT} flex-1 basis-48`} />
        <button className={BTN} disabled={busy || !(Number(count) >= 1 && Number(count) <= 50)}>
          {busy ? "Making…" : "Make codes"}
        </button>
      </form>
      {error ? <p className="m-0 text-[13px] text-danger">{error}</p> : null}

      {fresh.length ? (
        <div className="grid gap-2 rounded-xl bg-panel p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-muted">New codes</span>
            <Copy text={fresh.join("\n")} label="Copy all" />
          </div>
          <div className="flex flex-wrap gap-2">
            {fresh.map((c) => (
              <span key={c} className="flex items-center gap-2 rounded-full bg-white/5 py-1 pl-3 pr-1 font-mono text-[13px] text-cream">
                {c}
                <Copy text={c} />
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div role="tablist" className="flex gap-1 text-[13px]">
        {(["all", "unused", "used"] as const).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 ${filter === f ? "bg-white/10 text-cream" : "text-muted hover:text-cream"}`}
          >
            {f === "all" ? "All" : f === "unused" ? "Free" : "Used"}
          </button>
        ))}
      </div>

      {invites === null && !error ? (
        <p className="m-0 text-[13px] text-muted">Loading…</p>
      ) : (
        <Table
          head={["Code", "From", "Made", "Used by", "Used"]}
          rows={shown.slice(0, 300).map((i) => [
            <span key="c" className="flex items-center gap-2">
              <span className={`font-mono ${i.usedBy ? "text-dim line-through" : ""}`}>{i.code}</span>
              {i.usedBy ? null : <Copy text={i.code} />}
            </span>,
            i.owner === "admin" ? <span key="o">admin{i.note ? <span className="text-muted"> · {i.note}</span> : null}</span> : <span key="o" className="font-mono" title={i.owner}>{short(i.owner)}</span>,
            when(i.createdAt),
            i.usedBy ? <span key="u" className="font-mono" title={i.usedBy}>{short(i.usedBy)}</span> : <span key="u" className="text-win">free</span>,
            when(i.usedAt),
          ])}
          empty={filter === "all" ? "No codes yet." : "None."}
        />
      )}
    </Card>
  );
}
