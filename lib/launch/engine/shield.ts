/**
 * ShieldBot's pure safety assessment. Network adapters provide token metadata
 * and recent trades; this module decides what blocks an entry and what merely
 * lowers the score. Unknown input never earns a clean score.
 */
export type ShieldInfo = {
  holders?: { count?: number; distribution_percentage?: { top_10?: string | number } };
  developer_address?: string | null;
  developer_holding_percentage?: string | number | null;
  is_honeypot?: boolean | string | null;
  gt_score?: number | null;
  twitter_handle?: string | null;
  telegram_handle?: string | null;
  websites?: string[] | null;
};

export type ShieldTrade = { kind: "buy" | "sell"; from: string; native: number; tokens: number; at: number };

export type Shield = {
  score: number;
  blocks: string[];
  warns: string[];
  facts: {
    holders: number | null;
    top10Pct: number | null;
    devPct: number | null;
    devSells: number;
    buyers: number;
    biggestBuyerPct: number | null;
    sameSizeWallets: number;
    socials: boolean;
  };
};

export const SHIELD_LIMITS = { maxDevPct: 15, sameSizeWallets: 4, warnTop10Pct: 85, warnBiggestBuyerPct: 40, fewBuyers: 5, fewHolders: 40, fewBuys: 10 } as const;

const numberOf = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const pct = (x: number) => `${x.toFixed(x < 10 ? 1 : 0)}%`;

/** Pure: hard blocks return score 0; warnings deduct 15 points each. */
export function assessShield(info: ShieldInfo, trades: ShieldTrade[]): Shield {
  const blocks: string[] = [];
  const warns: string[] = [];
  const holders = numberOf(info.holders?.count);
  const top10Pct = numberOf(info.holders?.distribution_percentage?.top_10);
  const devPct = numberOf(info.developer_holding_percentage);
  const dev = info.developer_address?.toLowerCase() ?? null;
  const socials = !!(info.twitter_handle || info.telegram_handle || info.websites?.length);
  const buys = trades.filter((t) => t.kind === "buy" && t.native > 0);
  const byWallet = new Map<string, number>();
  for (const b of buys) byWallet.set(b.from.toLowerCase(), (byWallet.get(b.from.toLowerCase()) ?? 0) + b.native);
  const total = [...byWallet.values()].reduce((a, b) => a + b, 0);
  const biggestBuyerPct = total > 0 && buys.length >= 10 ? (Math.max(...byWallet.values()) / total) * 100 : null;
  const sizes = new Map<string, Set<string>>();
  for (const b of buys) {
    const key = b.native.toPrecision(6);
    if (Number(b.native.toPrecision(2)) === Number(key)) continue;
    sizes.set(key, (sizes.get(key) ?? new Set()).add(b.from.toLowerCase()));
  }
  const sameSizeWallets = Math.max(0, ...[...sizes.values()].map((s) => s.size));
  const devSells = dev ? trades.filter((t) => t.kind === "sell" && t.from.toLowerCase() === dev).length : 0;

  if (info.is_honeypot === true || info.is_honeypot === "yes") blocks.push("It is flagged as a honeypot: buys go in, sells do not come out.");
  if (devPct !== null && devPct >= SHIELD_LIMITS.maxDevPct) blocks.push(`The creator still holds ${pct(devPct)} of the supply.`);
  if (sameSizeWallets >= SHIELD_LIMITS.sameSizeWallets) blocks.push(`${sameSizeWallets} different wallets bought the exact same amount: likely one buyer split across wallets.`);
  if (devSells > 0) warns.push(`The creator sold ${devSells} time${devSells > 1 ? "s" : ""} in the recent trades.`);
  if (top10Pct !== null && top10Pct >= SHIELD_LIMITS.warnTop10Pct) warns.push(`The top 10 holders have ${pct(top10Pct)}, curve and pool included.`);
  if (biggestBuyerPct !== null && biggestBuyerPct >= SHIELD_LIMITS.warnBiggestBuyerPct) warns.push(`One wallet made ${pct(biggestBuyerPct)} of the recent buying.`);
  if (buys.length < SHIELD_LIMITS.fewBuys) warns.push(`Only ${buys.length} buy${buys.length === 1 ? "" : "s"} so far: too early to read who is buying.`);
  else if (byWallet.size < SHIELD_LIMITS.fewBuyers) warns.push(`Only ${byWallet.size} wallet${byWallet.size === 1 ? "" : "s"} bought recently.`);
  if (holders !== null && holders < SHIELD_LIMITS.fewHolders) warns.push(`Only ${holders} holders.`);
  if (!socials) warns.push("No X, Telegram or website listed.");
  const gt = numberOf(info.gt_score);
  const score = blocks.length ? 0 : Math.max(0, Math.min(100, Math.round(100 - warns.length * 15 - (gt !== null && gt < 30 ? 10 : 0))));
  return { score, blocks, warns, facts: { holders, top10Pct, devPct, devSells, buyers: byWallet.size, biggestBuyerPct, sameSizeWallets, socials } };
}

export const shieldLine = (s: Shield) => (s.blocks.length ? `Blocked: ${s.blocks[0]}` : `Safety ${s.score}/100${s.warns.length ? `. ${s.warns.join(" ")}` : ", nothing flagged."}`);

export type SafetyFeed = { check(candidate: { mint: string; pool?: string }): Promise<Shield | null> };
