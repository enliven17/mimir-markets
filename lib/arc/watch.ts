// The watchdog's rules (convex/arcWatch.ts), pure so tests/node/arc-watch.test.ts can check them.
// Each problem is { key, ttlMs, text }: `key` names it so the admin hears once per `ttlMs`, not every 5 minutes.

export type Problem = { key: string; ttlMs: number; text: string };
export type RoleState = {
  name: string;
  address: string;
  owner: string;
  paused?: boolean;
  oracle?: string;
  arbiter?: string;
  feeRecipient?: string;
  pending: Record<string, string>;
};

const HOUR = 3_600_000;
const ZERO = "0x0000000000000000000000000000000000000000";
const same = (a?: string, b?: string) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

/** Deployed shape: owner = arbiter = fee recipient (the Safe), oracle = our key, nothing queued, not paused. */
export function roleProblems(s: RoleState, expectedOracle: string): Problem[] {
  const out: Problem[] = [];
  const at = `${s.name} ${s.address}`;
  if (s.paused) out.push({ key: `paused:${s.address}`, ttlMs: 6 * HOUR, text: `⏸ ${at} is PAUSED. If that was not you, check the Safe now.` });
  if (s.oracle !== undefined && !same(s.oracle, expectedOracle))
    out.push({ key: `oracle:${s.address}:${s.oracle}`, ttlMs: 24 * HOUR, text: `🚨 ${at}: oracle is ${s.oracle}, not our key ${expectedOracle}.` });
  if (s.arbiter !== undefined && !same(s.arbiter, s.owner))
    out.push({ key: `arbiter:${s.address}:${s.arbiter}`, ttlMs: 24 * HOUR, text: `🚨 ${at}: arbiter ${s.arbiter} is not the owner ${s.owner}.` });
  if (s.feeRecipient !== undefined && !same(s.feeRecipient, s.owner))
    out.push({ key: `fee:${s.address}:${s.feeRecipient}`, ttlMs: 24 * HOUR, text: `🚨 ${at}: fee recipient ${s.feeRecipient} is not the owner ${s.owner}.` });
  for (const [role, who] of Object.entries(s.pending))
    if (who && !same(who, ZERO))
      out.push({ key: `pending:${s.address}:${role}:${who}`, ttlMs: 24 * HOUR, text: `🚨 ${at}: a ${role} change to ${who} is queued (timelocked). If the Safe did not queue it, cancel it.` });
  return out;
}

/** A live proposal whose on-chain side is not the verdict our oracle recorded: someone else holds the oracle key. */
export function proposalProblem(p: { kind: string; marketId: number; question: string; disputableUntil: number; verdictSide: number | null }, onchainSide: number): Problem | null {
  if (p.verdictSide === onchainSide) return null;
  const until = new Date(p.disputableUntil * 1000).toISOString().slice(0, 16).replace("T", " ");
  return {
    key: `proposal:${p.kind}:${p.marketId}:${onchainSide}`,
    ttlMs: 30 * 24 * HOUR,
    text:
      `🚨 ORACLE ANOMALY on ${p.kind} #${p.marketId} "${p.question.slice(0, 120)}": the chain says side ${onchainSide}, our oracle recorded ${p.verdictSide ?? "nothing"}. ` +
      `Possible stolen oracle key: revokeOracle from the Safe, then veto open proposals before ${until} UTC. Do NOT pause first.`,
  };
}
