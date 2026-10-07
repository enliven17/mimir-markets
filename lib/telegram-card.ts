/**
 * Telegram notification cards: which card a message gets, the query a card URL carries, and what the card says.
 * Pure (no rendering, no I/O) so it is testable; app/api/telegram/card/[type]/route.tsx draws it with next/og and
 * lib/server/telegram.ts sends it with sendPhoto, the text as the caption.
 */
import { SITE_URL } from "./site";

export const CARD_TYPES = ["new", "proposed", "won", "lost", "refunded", "cancelled"] as const;
export type CardType = (typeof CARD_TYPES)[number];
export type CardKind = "vs" | "pool";

/** Bump when the card design changes, so Telegram does not serve a cached older picture. */
export const CARD_VERSION = 1;

/** Telegram's limit for a photo caption. */
export const CAPTION_MAX = 1024;

export interface CardQuery {
  type: CardType;
  kind: CardKind;
  id: number;
  /** The side the recipient holds (won / lost cards mark it); 0 when not given. */
  side: 0 | 1 | 2;
}

/** Validates a card request; null for anything malformed (the route answers 400). */
export function parseCardQuery(type: string, params: URLSearchParams): CardQuery | null {
  if (!(CARD_TYPES as readonly string[]).includes(type)) return null;
  const kind = params.get("kind");
  if (kind !== "vs" && kind !== "pool") return null;
  const rawId = params.get("id") ?? "";
  if (!/^\d{1,9}$/.test(rawId)) return null;
  const id = Number(rawId);
  if (id < 1) return null;
  const rawSide = params.get("side");
  if (rawSide !== null && rawSide !== "1" && rawSide !== "2") return null;
  return { type: type as CardType, kind, id, side: rawSide ? (Number(rawSide) as 1 | 2) : 0 };
}

/** The card's public URL (the site origin, so Telegram fetches it from us), with a cache-busting version. */
export function cardUrl(type: CardType, kind: CardKind, id: number, side?: number, origin = SITE_URL): string {
  const q = new URLSearchParams({ kind, id: String(id) });
  if (side === 1 || side === 2) q.set("side", String(side));
  q.set("v", String(CARD_VERSION));
  return `${origin}/api/telegram/card/${type}?${q}`;
}

/** The card a personal Arc event gets: the market's new state, from this holder's point of view. */
export function cardTypeFor(e: { type: "new" | "proposed" | "resolved" | "cancelled"; winner: number }, side: number): CardType {
  if (e.type === "new") return "new";
  if (e.type === "proposed") return "proposed";
  if (e.type === "cancelled") return "cancelled";
  if (e.winner !== 1 && e.winner !== 2) return "refunded";
  return e.winner === side ? "won" : "lost";
}

/** The fields of an indexed market (convex/arc.ts `market`) a card reads. */
export interface CardMarket {
  kind: CardKind;
  marketId: number;
  question: string;
  labelA: string;
  labelB: string;
  category: string;
  stakeA: string;
  stakeB: string;
  participants: number;
  deadline: number;
  winner: number;
  disputableUntil: number;
  verdict?: { confidence: number } | null;
}

export type Tone = "accent" | "win" | "muted" | "cream";

export interface CardSide {
  label: string;
  usdc: string;
  pct: number;
  /** The proposed or winning side. */
  lead: boolean;
  /** A small tag above the side: "Your side", "Proposed", "Won". */
  tag: string | null;
}

/** A side's name inside a sentence, quoted and short. */
const named = (label: string) => `“${clampText(label, 32)}”`;

export interface CardModel {
  eyebrow: string;
  headline: string;
  tone: Tone;
  question: string;
  detail: string;
  sides: [CardSide, CardSide];
  /** Bottom right, one entry per line. */
  footer: string[];
}

const WEI_PER_CENT = 10n ** 16n;

/** USDC from 18-decimal wei, two decimals ("12.50"). */
export function usdcText(wei: string): string {
  const cents = BigInt(wei || "0") / WEI_PER_CENT;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

/** The question for the card, clamped on a word boundary so three lines always fit. */
export function clampText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

const utc = (sec: number) =>
  new Date(sec * 1000).toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " UTC";

export function cardModel(q: CardQuery, m: CardMarket): CardModel {
  const a = BigInt(m.stakeA || "0");
  const b = BigInt(m.stakeB || "0");
  const total = a + b;
  const pctA = total === 0n ? 100 : Number((a * 100n) / total);
  const sideOf = (label: string, wei: string, pct: number, n: 1 | 2): CardSide => ({
    label: clampText(label, 27),
    usdc: usdcText(wei),
    pct,
    lead: (q.type === "proposed" || q.type === "won" || q.type === "lost") && m.winner === n,
    tag: q.side === n && (q.type === "won" || q.type === "lost") ? "Your side" : null,
  });
  const sides: [CardSide, CardSide] = [sideOf(m.labelA, m.stakeA, pctA, 1), sideOf(m.labelB, m.stakeB, 100 - pctA, 2)];
  const winnerLabel = m.winner === 1 ? m.labelA : m.winner === 2 ? m.labelB : "";
  const confidence = m.verdict?.confidence;
  for (const s of sides) if (s.lead && !s.tag) s.tag = q.type === "proposed" ? "Proposed" : "Won";

  const headline: Record<CardType, [string, Tone]> = {
    new: ["New market", "accent"],
    proposed: ["Result proposed", "accent"],
    won: ["You won", "win"],
    lost: ["You lost", "muted"],
    refunded: ["Refunded", "cream"],
    cancelled: ["Cancelled", "cream"],
  };
  const detail: Record<CardType, string> = {
    new: `Opening stake ${usdcText(m.stakeA)} USDC · closes ${utc(m.deadline)}`,
    proposed: winnerLabel
      ? `${named(winnerLabel)}${confidence ? ` · ${confidence}% sure` : ""}${m.disputableUntil ? ` · disputable until ${utc(m.disputableUntil)}` : ""}`
      : `No winner: a refund${m.disputableUntil ? ` · disputable until ${utc(m.disputableUntil)}` : ""}`,
    won: winnerLabel ? `${named(winnerLabel)} won · paid straight to your account` : "Settled in your favour",
    lost: winnerLabel ? `${named(winnerLabel)} won` : "Settled against you",
    refunded: "No winner: every stake is returned",
    cancelled: "The creator cancelled; stakes are returned",
  };
  const [text, tone] = headline[q.type];
  return {
    eyebrow: `${m.kind === "vs" ? "VS" : "Pool"} #${m.marketId} · ${(m.category || "market").toUpperCase()}`,
    headline: text,
    tone,
    question: clampText(m.question, 150),
    detail: detail[q.type],
    sides,
    footer: [`${m.participants} ${m.participants === 1 ? "participant" : "participants"}`, `${usdcText(total.toString())} USDC staked`],
  };
}

/**
 * A caption for sendPhoto: Telegram allows 1024 characters and the HTML must stay balanced, so a long text is cut
 * outside any tag or entity, open <b>/<i> tags are closed, and an ellipsis marks the cut.
 */
export function trimCaption(html: string, max = CAPTION_MAX): string {
  if (html.length <= max) return html;
  // Room for the ellipsis and the closing tags.
  let cut = html.slice(0, max - 24);
  cut = cut.replace(/<[^>]*$/, "").replace(/&[a-z0-9#]*$/i, "");
  const open: string[] = [];
  for (const m of cut.matchAll(/<(\/?)(b|i|u|s|code|a)\b[^>]*>/gi)) {
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const at = open.lastIndexOf(tag);
      if (at >= 0) open.splice(at, 1);
    } else open.push(tag);
  }
  return `${cut.trimEnd()}…${open.reverse().map((t) => `</${t}>`).join("")}`;
}
