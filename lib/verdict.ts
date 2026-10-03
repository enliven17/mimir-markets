/** The four settlement outcomes the Mimir program understands (sides 1-4). */
export const VERDICTS = [
  "CREATOR_WINS",
  "CHALLENGERS_WIN",
  "DRAW",
  "UNRESOLVABLE",
] as const;

export type Verdict = (typeof VERDICTS)[number];

export function isVerdict(value: unknown): value is Verdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}

const LINK_REMOVED = "[link removed]";

/**
 * Text bound for the chain (a proposal's summary) with every link removed.
 * The model paraphrases evidence an attacker may control, and a summary
 * shown next to a real payout is a good place for a phishing URL.
 */
const LINK_TLDS =
  "com|net|org|io|xyz|app|dev|co|me|gg|ai|so|sh|to|cc|tv|fm|ly|tk|ml|ga|cf|gq|pw|ws|vip|top|site|online|website|live|link|click|" +
  "info|biz|pro|club|fun|tech|store|shop|trade|exchange|finance|money|cash|claims?|gift|win|bet|casino|network|digital|" +
  "solutions|support|services|wallet|crypto|nft|dao|uk|de|ru|cn|fr|jp|kr|br|in|us|eu|ch|nl|es|it|pl|tr|ua|vn|id|ph|ng|za";
// Bare domains on real TLDs (evil.xyz, t.me/x, docs.example.co.uk/path), not
// "Node.js" or a resolver path like "events[0].status.type".
const BARE_DOMAIN = new RegExp(
  String.raw`\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:${LINK_TLDS})(?:[/:?#][^\s)]*)?(?=$|[\s),;.!?'"\]])`,
  "gi",
);

export function stripLinks(text: string): string {
  return text
    .replace(/\b(?:https?|hxxps?|ftp):\/\/\S+/gi, LINK_REMOVED)
    .replace(/\bwww\.\S+/gi, LINK_REMOVED)
    .replace(BARE_DOMAIN, LINK_REMOVED)
    .replace(/(?:\[link removed\]\s*){2,}/g, `${LINK_REMOVED} `)
    .trim();
}
