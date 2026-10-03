"use client";

/**
 * Mimir Terminal: one prompt for markets, agents and tokens. Plain DOM, no
 * terminal library. Each command prints a block that loads its own data
 * (components/terminal/blocks.tsx), so typing never waits on the network.
 *
 * Keys: Enter runs · ↑/↓ history · Tab completes · ⌘K / Ctrl+K command palette
 * · Ctrl+L clears · Esc closes the palette or leaves the agent.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import TerminalMark from "@/components/terminal/TerminalMark";
import { Limit, useTerminalSession } from "@/components/terminal/pay";
import { AgentReply, Agents, Cmd, Err, Help, Market, Markets, Note, Token, type Focus, type Run } from "@/components/terminal/blocks";
import { COMMANDS, complete, parseCommand, type Command } from "@/lib/terminal/commands";
import { short } from "@/lib/terminal/format";
import { SOLANA_CLUSTER } from "@/lib/solana/config";
import { mimirMint } from "@/lib/token-config";

interface Entry {
  id: number;
  input: string | null;
  agent: string | null;
  node: ReactNode;
}

const HISTORY_KEY = "mimir.terminal.history";
const QUICK = ["markets live", "markets closing", "agents", "price", "help"];

function loadHistory(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string").slice(-100) : [];
  } catch {
    return [];
  }
}

function saveHistory(h: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-100)));
  } catch {
    // private mode: history lives for the session only
  }
}

export default function TerminalClient() {
  const { publicKey } = useWallet();
  const session = useTerminalSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  /** Price per message of the agent in use (USDC), when it charges. */
  const [price, setPrice] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [agent, setAgent] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [palette, setPalette] = useState(false);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const history = useRef<string[]>([]);
  const cursor = useRef(-1);
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const agentRef = useRef<string | null>(null);
  agentRef.current = agent;
  const focusRef = useRef<Focus | null>(null);
  focusRef.current = focus;
  /** Each agent's conversation, so a follow-up keeps its thread (last turns only). */
  const threads = useRef(new Map<string, { role: "user" | "agent"; text: string }[]>());

  useEffect(() => {
    history.current = loadHistory();
  }, []);

  const print = useCallback((input: string | null, node: ReactNode) => {
    setEntries((list) => [...list.slice(-199), { id: nextId.current++, input, agent: agentRef.current, node }]);
  }, []);

  // ponytail: "run" is defined below and needs itself (blocks call it back): keep a ref.
  const runRef = useRef<Run>(() => undefined);
  const run: Run = useCallback((line, mode = "run") => runRef.current(line, mode), []);

  const exec = useCallback(
    (cmd: Command, line: string) => {
      switch (cmd.kind) {
        case "help":
          return print(line, <Help run={run} />);
        case "clear":
          return setEntries([]);
        case "markets":
          return print(line, <Markets filter={cmd.filter} run={run} />);
        case "market":
          setFocus({ claimId: cmd.id, label: `#${cmd.id}` });
          return print(line, <Market id={cmd.id} run={run} />);
        case "agents":
          return print(line, <Agents run={run} />);
        case "token":
          setFocus({ mint: cmd.mint, label: short(cmd.mint) });
          return print(line, <Token mint={cmd.mint} run={run} />);
        case "price": {
          const mint = mimirMint();
          if (mint) setFocus({ mint, label: "$MIMIR" });
          return print(line, mint ? <Token mint={mint} run={run} label="$MIMIR" /> : <Note>$MIMIR is not launched yet.</Note>);
        }
        case "use":
          setAgent(cmd.agent);
          setPrice(null);
          // Community agents may charge: look the price up so the prompt can show it before sending.
          fetch("/api/agents/registry")
            .then((r) => r.json())
            .then((b: { agents?: { agentId: string; chat?: { priceUsdc: number } }[] }) => {
              const found = b.agents?.find((a) => a.agentId === cmd.agent);
              if (agentRef.current === cmd.agent) setPrice(found?.chat?.priceUsdc ? found.chat.priceUsdc : null);
            })
            .catch(() => undefined);
          return print(
            line,
            <Note>
              talking to <span className="text-cream">{cmd.agent}</span>
              {focusRef.current ? <> about <span className="text-cream">{focusRef.current.label}</span></> : null}. Plain text goes to it;{" "}
              <span className="text-cream">leave</span> to stop. Open a market or a token first and it answers about that.
            </Note>,
          );
        case "leave":
          setAgent(null);
          setPrice(null);
          return print(line, <Note>left the agent.</Note>);
        case "ask": {
          const thread = threads.current.get(cmd.agent) ?? [];
          const history = thread.slice(-6);
          return print(
            line,
            <AgentReply
              agent={cmd.agent}
              message={cmd.text}
              history={history}
              focus={focusRef.current}
              auth={{ headers: () => sessionRef.current.headers(), ensure: () => sessionRef.current.ensure() }}
              run={run}
              onReply={(reply) =>
                threads.current.set(cmd.agent, [...thread, { role: "user" as const, text: cmd.text }, { role: "agent" as const, text: reply }].slice(-12))
              }
            />,
          );
        }
        case "buy":
        case "sell":
          return print(line, <Note>buy and sell open in a later update. token {short(cmd.mint)} shows its market now.</Note>);
        case "limit":
          return print(line, <Limit amount={cmd.revoke ? 0 : cmd.amount} revoke={cmd.revoke} run={run} />);
        case "error":
          return print(line, <Err>{cmd.message}</Err>);
      }
    },
    [print, run],
  );

  runRef.current = (line, mode = "run") => {
    if (mode === "fill") {
      setInput(line);
      inputRef.current?.focus();
      return;
    }
    const cmd = parseCommand(line, agentRef.current);
    if (!cmd) return;
    history.current = [...history.current.filter((h) => h !== line), line];
    saveHistory(history.current);
    cursor.current = -1;
    exec(cmd, line);
  };

  // Keep the newest output in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [entries]);

  // ⌘K / Ctrl+K anywhere on the page.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        setPaletteIdx(0);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteItems = useMemo(() => {
    const q = input.trim().toLowerCase();
    return COMMANDS.filter((c) => !q || c.name.startsWith(q) || c.summary.toLowerCase().includes(q));
  }, [input]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (palette) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = paletteItems.length || 1;
        setPaletteIdx((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const c = paletteItems[paletteIdx];
        setPalette(false);
        if (c) run(c.usage.includes("<") ? `${c.name} ` : c.name, c.usage.includes("<") ? "fill" : "run");
        if (c && !c.usage.includes("<")) setInput("");
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPalette(false);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const line = input.trim();
      setInput("");
      if (line) run(line);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const h = history.current;
      if (h.length === 0) return;
      e.preventDefault();
      const next = e.key === "ArrowUp" ? (cursor.current < 0 ? h.length - 1 : Math.max(0, cursor.current - 1)) : cursor.current < 0 ? -1 : cursor.current + 1;
      cursor.current = next >= h.length ? -1 : next;
      setInput(cursor.current < 0 ? "" : h[cursor.current]);
    } else if (e.key === "Tab") {
      e.preventDefault();
      const [first] = complete(input);
      if (first) setInput(input.replace(/\S*$/, first) + " ");
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setEntries([]);
    } else if (e.key === "Escape" && agent) {
      run("leave");
    }
  };

  const hint = complete(input)[0];

  return (
    <section
      aria-label="Mimir Terminal"
      className="relative mx-auto flex h-[calc(100svh-180px)] min-h-[520px] max-w-[1100px] flex-col overflow-hidden rounded-[22px] border border-line bg-ink-deep/95 font-mono text-[14px] leading-relaxed text-muted shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
      onClick={(e) => {
        // A click on empty space focuses the prompt; selecting text or clicking a command does not.
        if ((e.target as HTMLElement).closest("button,a,input") || window.getSelection()?.toString()) return;
        inputRef.current?.focus();
      }}
    >
      {/* title bar */}
      <header className="flex items-center gap-3 border-b border-line bg-panel/80 px-4 py-2.5">
        <TerminalMark className="h-5 w-auto" />
        <span className="font-pixel text-[13px] uppercase tracking-[0.18em] text-cream">Mimir Terminal</span>
        <span className="ml-auto rounded-full bg-red/15 px-2.5 py-0.5 font-pixel text-[11px] uppercase tracking-wider text-coral">{SOLANA_CLUSTER}</span>
        <span className="text-[12px] text-dim max-sm:hidden">{publicKey ? short(publicKey.toBase58()) : "no wallet"}</span>
      </header>

      {/* output */}
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6" aria-live="polite">
        <Welcome run={run} />
        {entries.map((e) => (
          <div key={e.id} className="mt-4 animate-[fadeIn_160ms_ease-out]">
            {e.input !== null ? (
              <div className="mb-1.5 text-cream">
                <span className="text-red">{e.agent ? `${e.agent}›` : "mimir›"}</span> {e.input}
              </div>
            ) : null}
            <div>{e.node}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* palette */}
      {palette ? (
        <div role="listbox" aria-label="Commands" className="absolute inset-x-4 bottom-[104px] z-10 max-h-[50%] overflow-y-auto rounded-2xl border border-line-strong bg-panel/95 p-2 shadow-2xl sm:inset-x-auto sm:left-6 sm:w-[680px]">
          {paletteItems.map((c, i) => (
            <button
              key={c.name}
              type="button"
              role="option"
              aria-selected={i === paletteIdx}
              onMouseEnter={() => setPaletteIdx(i)}
              onClick={() => {
                setPalette(false);
                run(c.usage.includes("<") ? `${c.name} ` : c.name, c.usage.includes("<") ? "fill" : "run");
              }}
              className={`flex w-full items-baseline gap-3 rounded-xl px-3 py-2 text-left ${i === paletteIdx ? "bg-red/15 text-cream" : "text-muted"}`}
            >
              <span className="min-w-[34ch] shrink-0 whitespace-nowrap text-cream">{c.usage}</span>
              <span className="truncate text-dim">{c.summary}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* quick commands (touch) */}
      <div className="flex gap-2 overflow-x-auto border-t border-line px-4 py-2 sm:hidden">
        {QUICK.map((q) => (
          <button key={q} type="button" onClick={() => run(q)} className="shrink-0 rounded-full border border-line-strong px-3 py-1 text-[12px] text-cream">
            {q}
          </button>
        ))}
      </div>

      {/* prompt */}
      <div className="flex items-center gap-2 border-t border-line bg-panel/60 px-4 py-3 sm:px-6">
        <label htmlFor="terminal-input" className="shrink-0 text-red">
          {agent ? `${agent}›` : "mimir›"}
        </label>
        <div className="relative flex-1">
          <input
            id="terminal-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={agent ? `ask ${agent} anything` : "type help, or ⌘K"}
            className="w-full bg-transparent text-cream caret-red outline-none placeholder:text-dim/70"
          />
          {hint && input && !palette ? (
            <span aria-hidden className="pointer-events-none absolute left-0 top-0 whitespace-pre text-dim/50">
              <span className="invisible">{input.replace(/\S*$/, "")}</span>
              {hint}
            </span>
          ) : null}
        </div>
        {agent && price ? (
          <span className="shrink-0 rounded-full bg-pending/15 px-2.5 py-0.5 text-[12px] text-pending" title="charged only when the agent answers">
            {price} USDC · ⏎
          </span>
        ) : (
          <span className="hidden text-[12px] text-dim sm:inline">⏎ run · tab · ⌘K</span>
        )}
      </div>

      {/* status bar */}
      <footer className="flex items-center gap-4 border-t border-line px-4 py-1.5 font-pixel text-[11px] uppercase tracking-wider text-dim sm:px-6">
        <span>{agent ? <span className="text-coral">● {agent}</span> : "● no agent"}</span>
        <span className="max-sm:hidden">{focus ? <>focus <span className="text-cream">{focus.label}</span></> : "markets · agents · tokens"}</span>
        <span className="ml-auto">esc leaves · ctrl+l clears</span>
      </footer>
    </section>
  );
}

function Welcome({ run }: { run: Run }) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-4">
        <TerminalMark className="h-12 w-auto" />
        <div>
          <h1 className="m-0 font-display text-[2rem] font-normal leading-none text-cream">Mimir Terminal</h1>
          <div className="text-dim">markets, agents and tokens from one prompt</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {QUICK.map((q) => (
          <Cmd key={q} line={q} run={run} className="text-cream">
            › {q}
          </Cmd>
        ))}
      </div>
    </div>
  );
}
