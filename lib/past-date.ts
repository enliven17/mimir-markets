/**
 * Does a claim name a calendar day that has already started?
 *
 * A drafted claim can carry a deadline in the future and still ask about a
 * match played yesterday ("Did City win on October 4?" with a deadline on the
 * 5th): its outcome is public, so whoever reads the result first wins for free.
 * The drafting model does not know today's date, so this deterministic check
 * runs on every draft and on every stored suggestion before it is shown.
 *
 * Only full dates count (day, month and year): "October 4, 2026", "4 October
 * 2026", "Oct. 4th, 2026", "2026-10-04". Today counts too: a match played
 * this afternoon is decided long before a deadline tonight, and the UTC date
 * lags the user's own (02:00 in Istanbul is still yesterday in UTC). A claim
 * about today's fixture can leave the date out or name a later day.
 */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const DAY = "(\\d{1,2})(?:st|nd|rd|th)?";
const YEAR = "(\\d{4})";

const MONTH_FIRST = new RegExp(`\\b${MONTH}\\s+${DAY},?\\s+${YEAR}\\b`, "gi");
const DAY_FIRST = new RegExp(`\\b${DAY}\\s+${MONTH},?\\s+${YEAR}\\b`, "gi");
const ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

const monthIndex = (name: string) => MONTHS.indexOf(name.toLowerCase().slice(0, 3));

/** Every full date in `text`, as UTC midnight (ms). */
export function datesIn(text: string): number[] {
  const out: number[] = [];
  const push = (y: number, m: number, d: number) => {
    if (m >= 0 && m < 12 && d >= 1 && d <= 31) out.push(Date.UTC(y, m, d));
  };
  for (const [, mon, d, y] of text.matchAll(MONTH_FIRST)) push(Number(y), monthIndex(mon), Number(d));
  for (const [, d, mon, y] of text.matchAll(DAY_FIRST)) push(Number(y), monthIndex(mon), Number(d));
  for (const [, y, m, d] of text.matchAll(ISO)) push(Number(y), Number(m) - 1, Number(d));
  return out;
}

/**
 * True when `text` names today (UTC) or an earlier day. `includeToday: false` only flags earlier days: for drafts
 * built by code from forward-looking schedules (a stock's close tonight, a fixture later today), where naming today
 * is the point and the outcome is not known yet. LLM drafts and user claims keep the strict default.
 */
export function mentionsPastDay(text: string, now = Date.now(), { includeToday = true } = {}): boolean {
  const today = new Date(now);
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return datesIn(text).some((day) => (includeToday ? day <= startOfToday : day < startOfToday));
}
