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
  | { kind: "buy"; mint: string; usdc: number }
  | { kind: "sell"; mint: string; pct: number }
  | { kind: "limit"; amount: number | null; revoke: boolean }
  | { kind: "error"; message: string };

export interface CommandSpec {
  name: string;
  usage: string;
  summary: string;
}

/** The help text, the palette and Tab completion all read this list. */
export const COMMANDS: readonly CommandSpec[] = [
  { name: "markets", usage: "markets [live|closing|crypto|sports|settled]", summary: "list markets" },
  { name: "market", usage: "market <id>", summary: "one market in full" },
  { name: "agents", usage: "agents", summary: "who you can talk to, and what they charge" },
  { name: "use", usage: "use <agent>", summary: "talk to an agent: plain text goes to it" },
  { name: "ask", usage: "ask <agent> <question>", summary: "one question to an agent" },
  { name: "leave", usage: "leave", summary: "stop talking to the agent" },
  { name: "token", usage: "token <contract address>", summary: "a Solana token's price, liquidity and safety" },
  { name: "price", usage: "price", summary: "$MIMIR price" },
  { name: "buy", usage: "buy <contract address> <usdc>", summary: "buy a token with USDC (mainnet, you sign)" },
  { name: "sell", usage: "sell <contract address> <percent>", summary: "sell a share of a token for USDC" },
  { name: "limit", usage: "limit [<usdc>|revoke]", summary: "the spending limit for paid agents" },
  { name: "clear", usage: "clear", summary: "clear the screen" },
  { name: "help", usage: "help", summary: "this list" },
];

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const AGENT = /^[a-z0-9][a-z0-9_-]{1,39}$/i;
const FILTERS: readonly MarketFilter[] = ["all", "live", "closing", "crypto", "sports", "settled"];

export const isMint = (s: string) => MINT.test(s);

/** A positive amount: "2", "2.5", "$2", "2usdc". */
function amount(raw: string | undefined): number | null {
  if (!raw) return null;
  const v = Number(raw.replace(/^\$/, "").replace(/usdc$/i, ""));
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
      const usdc = amount(rest[1]);
      if (!arg || !isMint(arg) || usdc === null) return { kind: "error", message: "usage: buy <contract address> <usdc>" };
      return { kind: "buy", mint: arg, usdc };
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
