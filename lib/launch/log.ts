// Structured JSON logs to stdout (private ops log; the public live view is the `events` table).
export type Fields = Record<string, unknown>;
export type Log = {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
};

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const serialize = (v: unknown): unknown => {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack?.split("\n").slice(0, 6).join("\n") };
  return v;
};

export function createLogger(opts: { level?: string; write?: (line: string) => void; base?: Fields } = {}): Log {
  const min = LEVELS[(opts.level as Level) in LEVELS ? (opts.level as Level) : "info"];
  const write = opts.write ?? ((line: string) => void process.stdout.write(line));
  const emit = (level: Level) => (msg: string, fields: Fields = {}) => {
    if (LEVELS[level] < min) return;
    const entry = { t: new Date().toISOString(), level, msg, ...opts.base, ...fields };
    write(`${JSON.stringify(entry, (_k, v) => serialize(v))}\n`);
  };
  return { debug: emit("debug"), info: emit("info"), warn: emit("warn"), error: emit("error") };
}

export const silentLog: Log = { debug() {}, info() {}, warn() {}, error() {} };

/** Short, public-safe error text for the live view: no URLs (they can carry API keys), bounded. */
export function publicError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/(api[-_]?key|token|secret)=\S+/gi, "$1=***")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

/** Masks credentials that ride in URLs or key=value pairs (Helius/RPC URLs carry api keys). */
export const redact = (line: string): string => line.replace(/(api[-_]?key|token|secret|auth)=[^&"\s\\]+/gi, "$1=***");

/** Logger for Convex functions: stdout is not captured there, console is. Lines are redacted. */
export function createConsoleLogger(opts: { level?: string; base?: Fields } = {}): Log {
  return createLogger({ ...opts, write: (line) => console.info(redact(line.trimEnd())) });
}
