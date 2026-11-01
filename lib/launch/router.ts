/**
 * Mimir Launch: the agent's brain as a JSON-only LLM router (Mimir AI, lib/launch/llm.ts, or the owner's own key,
 * lib/launch/byok.ts), and the one cleaner for untrusted text handed to it (market questions, drafts).
 */
export type CompleteOptions = { system: string; user: string; json?: boolean; maxTokens?: number; temperature?: number };
export type JsonCompletion<T> = { data: T; provider: string; model: string };
export type JsonRouter = { completeJson<T>(o: CompleteOptions, parse: (v: unknown) => T): Promise<JsonCompletion<T>> };

/** Control, zero-width, bidi-override and line/paragraph separator code points. */
const invisible = (cp: number): boolean =>
  cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x206f) || cp === 0xfeff;

/** Untrusted text → one line of plain characters, no markup, bounded length. */
export function sanitize(text: unknown, max: number): string {
  if (typeof text !== "string") return "";
  const clean = Array.from(text.normalize("NFKC"), (ch) => (invisible(ch.codePointAt(0) ?? 0) ? " " : ch))
    .join("")
    .replace(/[<>`{}\[\]\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
