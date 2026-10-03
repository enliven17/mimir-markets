/**
 * Mimir Terminal: the command language. Pure, so it runs in the browser and
 * in tests alike. One line in, one Command out; plain text with an agent
 * selected (`use <agent>`) is a question for that agent.
 */

export type MarketFilter = "all" | "live" | "closing" | "crypto" | "sports" | "settled";

export type Command =
  | { kind: "help" }
  | { kind: "clear" }
  | { kind: "markets"; filter: MarketFilter }
  | { kind: "market"; id: number }
  | { kind: "agents" }
  | { kind: "use"; agent: string }
  | { kind: "leave" }
  | { kind: "ask"; agent: string; text: string }
  | { kind: "token"; mint: string }
  | { kind: "price" }
  | { kind: "buy"; mint: string; sol: number }
  | { kind: "sell"; mint: string; pct: number }
  | { kind: "limit"; amount: number | null; revoke: boolean }
  | { kind: "error"; message: string };

export interface CommandSpec {
  name: string;
  usage: string;
  summary: string;
  /** A line that runs as is, shown under the summary. */
  example?: string;
}

/** The help text, the palette, the typing preview and Tab completion all read this list. */
export const COMMANDS: readonly CommandSpec[] = [
  { name: "markets", usage: "markets [live|closing|crypto|sports|settled]", summary: "list prediction markets with their odds; filter by state or topic, click a row to open it", example: "markets crypto" },
  { name: "market", usage: "market <id>", summary: "open one market: the question, both sides, the pools, time left and how it settles. Agents then answer about it", example: "market 42" },
  { name: "agents", usage: "agents", summary: "every agent you can talk to: the free house council and community agents with their price per message" },
  { name: "use", usage: "use <agent>", summary: "start a conversation: everything you type next goes to that agent until you leave", example: "use contrarian" },
  { name: "ask", usage: "ask <agent> <question>", summary: "one question to an agent without switching to it; about the market or token you have open", example: "ask optimist will this market hit?" },
  { name: "leave", usage: "leave", summary: "end the conversation with the current agent (esc does the same)" },
  { name: "token", usage: "token <contract address>", summary: "look up a Solana token by contract address: price, market cap, liquidity, holders and red flags", example: "token So11111111111111111111111111111111111111112" },
  { name: "price", usage: "price", summary: "the $MIMIR token: price, market cap, liquidity and 24h move" },
  { name: "buy", usage: "buy <contract address> <sol>", summary: "buy a token with SOL through Jupiter on mainnet. You see the quote and warnings, then sign in your wallet", example: "buy <contract address> 0.1" },
  { name: "sell", usage: "sell <contract address> <percent>", summary: "sell a share of a token you hold back to SOL through Jupiter, after a quote you sign", example: "sell <contract address> 50%" },
  { name: "limit", usage: "limit [<usdc>|revoke]", summary: "the USDC spending limit paid agents draw from: one signature, the money stays in your wallet; revoke any time", example: "limit 5" },
  { name: "clear", usage: "clear", summary: "clear the screen (ctrl+l)" },
  { name: "help", usage: "help", summary: "every command with an example" },
];

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const AGENT = /^[a-z0-9][a-z0-9_-]{1,39}$/i;
const FILTERS: readonly MarketFilter[] = ["all", "live", "closing", "crypto", "sports", "settled"];

export const isMint = (s: string) => MINT.test(s);

/** A positive amount: "2", "2.5", "$2", "2usdc", "0.5sol". */
function amount(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = Number(raw.replace(/^\$/, "").replace(/(usdc|sol)$/i, ""));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function parseCommand(input: string, activeAgent: string | null = null): Command | null {
  const line = input.trim();
  if (!line) return null;
  const [head, ...rest] = line.split(/\s+/);
  const name = head.toLowerCase().replace(/^\//, "");
  const arg = rest[0];

  switch (name) {
    case "help":
    case "?":
      return { kind: "help" };
    case "clear":
    case "cls":
      return { kind: "clear" };
    case "markets":
    case "ls": {
      const f = (arg ?? "all").toLowerCase() as MarketFilter;
      return FILTERS.includes(f) ? { kind: "markets", filter: f } : { kind: "error", message: `unknown filter "${arg}": ${FILTERS.join(", ")}` };
    }
    case "market":
    case "m": {
      const id = Number((arg ?? "").replace(/^#/, ""));
      return Number.isSafeInteger(id) && id > 0 ? { kind: "market", id } : { kind: "error", message: "usage: market <id>" };
    }
    case "agents":
      return { kind: "agents" };
    case "use":
      return arg && AGENT.test(arg) ? { kind: "use", agent: arg.toLowerCase() } : { kind: "error", message: "usage: use <agent>" };
    case "leave":
    case "exit":
      return { kind: "leave" };
    case "ask": {
      if (!arg || !AGENT.test(arg)) return { kind: "error", message: "usage: ask <agent> <question>" };
      const text = rest.slice(1).join(" ");
      return text ? { kind: "ask", agent: arg.toLowerCase(), text } : { kind: "error", message: "ask what? usage: ask <agent> <question>" };
    }
    case "token":
    case "t":
      return arg && isMint(arg) ? { kind: "token", mint: arg } : { kind: "error", message: "usage: token <contract address>" };
    case "price":
      return { kind: "price" };
    case "buy": {
      const sol = amount(rest[1]);
      if (!arg || !isMint(arg) || sol === null) return { kind: "error", message: "usage: buy <contract address> <sol>" };
      return { kind: "buy", mint: arg, sol };
    }
    case "sell": {
      const pct = amount((rest[1] ?? "").replace(/%$/, ""));
      if (!arg || !isMint(arg) || pct === null || pct > 100) return { kind: "error", message: "usage: sell <contract address> <percent 1-100>" };
      return { kind: "sell", mint: arg, pct };
    }
    case "limit": {
      if (!arg) return { kind: "limit", amount: null, revoke: false };
      if (arg.toLowerCase() === "revoke") return { kind: "limit", amount: 0, revoke: true };
      const v = amount(arg);
      return v === null ? { kind: "error", message: "usage: limit [<usdc>|revoke]" } : { kind: "limit", amount: v, revoke: false };
    }
    default:
      // A pasted contract address is a token lookup; anything else goes to the active agent.
      if (rest.length === 0 && isMint(head)) return { kind: "token", mint: head };
      if (activeAgent) return { kind: "ask", agent: activeAgent, text: line };
      return { kind: "error", message: `unknown command "${head}". Type help, or pick an agent with use <agent>.` };
  }
}

/** Tab completion: the command names (then the given words) that start with the last word. */
export function complete(input: string, words: readonly string[] = []): string[] {
  const parts = input.split(/\s+/);
  const last = (parts.at(-1) ?? "").toLowerCase();
  const pool = parts.length <= 1 ? COMMANDS.map((c) => c.name) : words;
  return pool.filter((w) => w.toLowerCase().startsWith(last) && w.toLowerCase() !== last);
}

export interface Suggestion {
  /** Commands matching what is typed: the drop-up list. */
  items: CommandSpec[];
  /** Grey text to draw right after the input: the rest of the name, then the arguments still to type. */
  ghost: string;
}

/** A usage's arguments: "<contract address>" is one, though it has a space. */
const argsOf = (c: CommandSpec) => (c.usage.match(/<[^>]+>|\[[^\]]+\]|\S+/g) ?? []).slice(1);

/** What to preview while the user types a command. Empty when the line is not a command (e.g. chat). */
export function suggest(input: string): Suggestion {
  const none: Suggestion = { items: [], ghost: "" };
  if (!input.trim() || /^\s/.test(input)) return none;
  const parts = input.split(/\s+/);
  const first = parts[0].toLowerCase().replace(/^\//, "");
  if (parts.length === 1) {
    const items = COMMANDS.filter((c) => c.name.startsWith(first));
    const top = items[0];
    if (!top) return none;
    const rest = argsOf(top);
    return { items, ghost: top.name.slice(first.length) + (rest.length ? ` ${rest.join(" ")}` : "") };
  }
  const exact = COMMANDS.find((c) => c.name === first);
  if (!exact) return none;
  const args = argsOf(exact);
  const typing = parts.length - 1; // arguments started, the last maybe empty
  const last = parts[parts.length - 1];
  const left = last === "" ? args.slice(typing - 1) : args.slice(typing);
  return { items: [exact], ghost: left.length ? (last === "" ? "" : " ") + left.join(" ") : "" };
}
