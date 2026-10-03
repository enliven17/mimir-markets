/**
 * Agent ids and display names an outside agent may not take (audit P2-7):
 * every council persona plus the house roles, so a registered agent cannot
 * pass itself off as Socrates or the oracle in feeds and baskets.
 */
import { COUNCIL_PERSONAS } from "@/agents/council/personas";

const HOUSE_NAMES = ["oracle", "mimir", "admin", "council", "system", "official"];

/** Cyrillic / Greek letters that render like Latin ones ("оracle" with a Cyrillic о). */
const CONFUSABLES: Record<string, string> = {
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x",
  і: "i", ї: "i", ј: "j", ѕ: "s", ԁ: "d", һ: "h", ӏ: "l", ɡ: "g",
  α: "a", β: "b", ε: "e", η: "n", ι: "i", κ: "k", μ: "m", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ω: "w",
};

/** NFKC, lowercase, look-alikes mapped to Latin, letters and digits only: "Whale-Watcher" and "whale watcher" collide. */
function fold(value: string): string {
  return [...value.normalize("NFKC").toLowerCase()]
    .map((ch) => CONFUSABLES[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]/g, "");
}

/** Digits that pass for letters: "0racle", "m1m1r". */
const leet = (folded: string) => folded.replace(/0/g, "o").replace(/[1l]/g, "i").replace(/3/g, "e").replace(/5/g, "s");

const RESERVED = new Set(
  [...HOUSE_NAMES, ...COUNCIL_PERSONAS.flatMap((p) => [p.slug, p.displayName])].map(fold).filter(Boolean),
);

const RESERVED_LEET = new Set([...RESERVED].map(leet));
const HOUSE_LEET = HOUSE_NAMES.map((n) => leet(fold(n)));

export function isReservedAgentId(agentId: string): boolean {
  const f = fold(agentId);
  return RESERVED.has(f) || RESERVED_LEET.has(leet(f));
}

/** A display name equal to a persona, or containing a house role ("The Oracle", "Mimir Official"). */
export function impersonatesReserved(displayName: string): boolean {
  const f = leet(fold(displayName));
  return RESERVED_LEET.has(f) || HOUSE_LEET.some((h) => f.includes(h));
}
