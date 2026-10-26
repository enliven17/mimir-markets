export function opinionSplit(decisions: readonly { slug: string; lean?: number; at: number }[]) {
  const latest = new Map<string, { lean?: number; at: number }>();
  for (const d of decisions) if (!latest.has(d.slug) || latest.get(d.slug)!.at < d.at) latest.set(d.slug, d);
  const sides = [...latest.values()];
  const a = sides.filter((d) => d.lean === 1).length, b = sides.filter((d) => d.lean === 2).length;
  return { a, b, unknown: sides.length - a - b, disagreement: a + b ? 2 * Math.min(a, b) / (a + b) : 0 };
}
export function signalMatches(target: string, signal: { marketKind: string; marketId: number; category: string; slug?: string }, series?: string | null) {
  return target === `market:${signal.marketKind}:${signal.marketId}` || target === `topic:${signal.category}` || (!!signal.slug && target === `agent:${signal.slug}`) || (!!series && target === `series:${series}`);
}
