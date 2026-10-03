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

import { Link, useRouter } from "@/i18n/navigation";
import Boot, { shouldBoot } from "@/components/terminal/Boot";

import TerminalMark from "@/components/terminal/TerminalMark";
import { Limit, useTerminalSession } from "@/components/terminal/pay";
import { Swap } from "@/components/terminal/swap";
import { AgentReply, Agents, Cmd, Err, Help, Market, Markets, Note, Token, type Focus, type Run } from "@/components/terminal/blocks";
import { COMMANDS, complete, parseCommand, suggest, type Command, type CommandSpec } from "@/lib/terminal/commands";
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
  const router = useRouter();
  // "pending" until the browser knows whether to play the boot: the first paint is black, never the terminal flashing first.
  const [booting, setBooting] = useState<"pending" | "boot" | "off">("pending");

  // Full screen: the page under it must not scroll (the output scrolls itself).
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    setBooting(shouldBoot() ? "boot" : "off");
    return () => {
      html.style.overflow = prev;
    };
  }, []);
  const session = useTerminalSession();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  /** Price per message of the agent in use (USDC), when it charges. */
  const [price, setPrice] = useState<number | null>(null);
  const priceRef = useRef<number | null>(null);
  priceRef.current = price;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [agent, setAgent] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [palette, setPalette] = useState(false);
  const [paletteIdx, setPaletteIdx] = useState(0);
  /** The typing preview: which row of the drop-up is picked, and whether esc closed it for this line. */
  const [sugIdx, setSugIdx] = useState(0);
  const [sugClosed, setSugClosed] = useState(false);
  const history = useRef<string[]>([]);
  const cursor = useRef(-1);
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Follow the output down unless the user scrolled up to read. */
  const stick = useRef(true);
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
          // No agent to leave: exit means back to the site.
          if (!agentRef.current && /^(exit|quit)$/i.test(line)) {
            router.push("/arena");
            return;
          }
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
              auth={{ headers: () => sessionRef.current.headers(), ensure: (fresh) => sessionRef.current.ensure(fresh) }}
              maxPriceUsdc={cmd.agent === agentRef.current ? (priceRef.current ?? 0) : 0}
              run={run}
              onReply={(reply) =>
                threads.current.set(cmd.agent, [...thread, { role: "user" as const, text: cmd.text }, { role: "agent" as const, text: reply }].slice(-12))
              }
            />,
          );
        }
        case "buy":
          setFocus({ mint: cmd.mint, label: short(cmd.mint) });
          return print(line, <Swap side="buy" mint={cmd.mint} sol={cmd.sol} run={run} />);
        case "sell":
          setFocus({ mint: cmd.mint, label: short(cmd.mint) });
          return print(line, <Swap side="sell" mint={cmd.mint} pct={cmd.pct} run={run} />);
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

  // Keep the newest output in view: blocks keep growing after they print (data lands,
  // replies type out), so follow the content's size, not just new entries.
  useEffect(() => {
    stick.current = true;
  }, [entries]);
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const follow = () => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    };
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };
    const ro = new ResizeObserver(follow);
    ro.observe(content);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

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
    if (sug.items.length > 0) {
      const picking = !input.includes(" ");
      const pick = sug.items[Math.min(sugIdx, sug.items.length - 1)];
      if (picking && sug.items.length > 1 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const n = sug.items.length;
        setSugIdx((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
        return;
      }
      // Tab, or Enter on a half-typed name, takes the picked command.
      if (picking && pick && (e.key === "Tab" || (e.key === "Enter" && pick.name !== input.trim().toLowerCase()))) {
        e.preventDefault();
        accept(pick);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSugClosed(true);
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

  const typed = suggest(input);
  const sug = sugClosed || palette ? { items: [] as CommandSpec[], ghost: "" } : typed;
  // A name with arguments goes into the prompt to finish; one without runs.
  const accept = (c: CommandSpec) => {
    if (c.usage.includes(" ")) setInput(`${c.name} `);
    else {
      setInput("");
      run(c.name);
    }
    setSugIdx(0);
  };

  return (
    <section
      aria-label="Mimir Terminal"
      data-lenis-prevent
      className="terminal-root fixed inset-0 z-[80] flex h-[100dvh] flex-col overflow-hidden bg-ink-deep pb-[env(safe-area-inset-bottom)] font-mono text-[14px] leading-relaxed text-muted"
      onClick={(e) => {
        // A click on empty space focuses the prompt; selecting text or clicking a command does not.
        if ((e.target as HTMLElement).closest("button,a,input") || window.getSelection()?.toString()) return;
        inputRef.current?.focus();
      }}
    >
      {booting === "pending" ? <div aria-hidden className="absolute inset-0 z-30 bg-black" /> : null}
      {booting === "boot" ? (
        <Boot
          onDone={() => {
            setBooting("off");
            inputRef.current?.focus();
          }}
        />
      ) : null}

      {/* title bar */}
      <header className="flex items-center gap-3 border-b border-line bg-panel/80 px-4 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
        <Link href="/arena" className="whitespace-nowrap text-[12px] text-dim underline-offset-4 hover:text-cream hover:underline" aria-label="Back to Mimir">
          ← mimir
        </Link>
        <TerminalMark className="h-5 w-auto" />
        <span className="font-pixel text-[13px] uppercase tracking-[0.18em] text-cream max-sm:hidden">Mimir Terminal</span>
        <span className="rounded-full border border-coral/40 px-2 py-px font-pixel text-[10px] uppercase tracking-wider text-coral">beta</span>
        <span className="ml-auto rounded-full bg-red/15 px-2.5 py-0.5 font-pixel text-[11px] uppercase tracking-wider text-coral">{SOLANA_CLUSTER}</span>
        <span className="text-[12px] text-dim max-sm:hidden">{publicKey ? short(publicKey.toBase58()) : "no wallet"}</span>
      </header>

      {/* output */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-8" aria-live="polite">
        <div ref={contentRef}>
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
        </div>
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

      {/* typing preview: the matching commands, one quiet line each */}
      {sug.items.length > 0 ? (
        <div role="listbox" aria-label="Matching commands" className="absolute left-4 right-4 bottom-[100px] z-10 overflow-hidden rounded-lg border border-line bg-panel/95 py-1 text-[13px] shadow-xl backdrop-blur sm:left-[5.5rem] sm:right-auto sm:w-[min(560px,calc(100%-7rem))]">
          {sug.items.slice(0, 6).map((c, i) => {
            const on = i === Math.min(sugIdx, sug.items.length - 1);
            return (
              <button
                key={c.name}
                type="button"
                role="option"
                aria-selected={on}
                onMouseEnter={() => setSugIdx(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  accept(c);
                  inputRef.current?.focus();
                }}
                className={"flex w-full items-baseline gap-3 px-3 py-1 text-left " + (on ? "bg-red/10" : "")}
              >
                <span className={"shrink-0 " + (on ? "text-cream" : "text-muted")}>{c.name}</span>
                <span className="truncate text-dim">{c.summary}</span>
              </button>
            );
          })}
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
            onChange={(e) => {
              setInput(e.target.value);
              setSugIdx(0);
              setSugClosed(false);
            }}
            onKeyDown={onKeyDown}
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={agent ? `ask ${agent} anything` : "type help, or ⌘K"}
            enterKeyHint="send"
            className="w-full bg-transparent text-[16px] text-cream caret-red outline-none placeholder:text-dim/70 sm:text-[14px]"
          />
          {sug.ghost ? (
            <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre text-[16px] text-dim/60 sm:text-[14px]">
              <span className="invisible">{input}</span>
              {sug.ghost}
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
