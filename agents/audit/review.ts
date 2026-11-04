/** Independent evidence review and a deliberately limited bonded-dispute state machine. */
import type { Address, Hex } from "viem";
import { callLLMWithMeta, extractJson, type CallLLMOptions } from "../../lib/llm";
import { fetchEvidence } from "../../lib/server/evidence-fetcher";
import { INJECTION_GUARD, fenceUntrusted } from "../../lib/prompt-safety";
import { stripResolverFragment } from "../../lib/resolver-spec";

export interface AuditProposal {
  chainId: number; contract: Address; kind: "vs" | "pool"; marketId: string;
  proposedAt: number; disputableUntil: number; now: number; live: boolean;
  cutoff?: number;
  side: number; evidenceHash: Hex; question: string; labelA: string; labelB: string;
  resolutionUrl: string; category: string; deadline: number; createdAt: number; summary: string;
}
export interface AuditReview {
  cutoff?: number;
  side: number; confidence: number; explanation: string; model: string; reviewedAt: number;
  evidence: { url: string; text: string; fetcher: string };
}
export interface AuditJob {
  proposal: AuditProposal;
  status: "pending" | "observed" | "agreed" | "submitted" | "challenged" | "closed" | "expired" | "stale";
  review?: AuditReview; reviewKey?: string; txHash?: Hex; approvalTxHash?: Hex;
  error?: string; nextTry?: number;
}
export interface AuditRoles { auditAgent: string; owner: string; arbiter: string; oracle: string; feeRecipient: string }
export interface AuditIO {
  account?: Address; mode: "observe" | "challenge";
  load(): Promise<AuditProposal>; roles(): Promise<AuditRoles>;
  review(p: AuditProposal): Promise<AuditReview | null>; prepareBond(): Promise<void>;
  submit(): Promise<Hex>; receipt(hash: Hex): Promise<"success" | "reverted" | null>;
  save(job: AuditJob): Promise<void>;
}

export function proposalKey(p: AuditProposal): string {
  return JSON.stringify([p.chainId, p.contract.toLowerCase(), p.kind, p.marketId, p.proposedAt, p.side, p.evidenceHash.toLowerCase(), p.question, p.labelA, p.labelB, p.resolutionUrl, p.deadline, p.createdAt, p.summary, p.cutoff]);
}
export const isAuditReceiptJob = (job: AuditJob) => Boolean(job.txHash || job.approvalTxHash);
export function auditQueue(jobs: AuditJob[], mode: AuditIO["mode"], now: number): AuditJob[] {
  return jobs.filter(j => (["pending", "submitted", "challenged", ...(mode === "challenge" ? ["observed"] : [])].includes(j.status) || j.approvalTxHash) && (j.nextTry ?? 0) <= now)
    .sort((a, b) => (a.nextTry ?? 0) - (b.nextTry ?? 0) || a.proposal.disputableUntil - b.proposal.disputableUntil);
}
export function auditAction(p: AuditProposal, review: AuditReview): "challenge" | "agree" | "retry" {
  if (!Number.isFinite(review.confidence) || review.confidence < 90 || review.confidence > 100 || ![1, 2, 3].includes(review.side) || !review.evidence.text.trim()) return "retry";
  const cutoffMatters = review.side === 1 || review.side === 2;
  if (cutoffMatters && p.cutoff !== undefined && (!Number.isSafeInteger(review.cutoff) || review.cutoff! < 0 || review.cutoff! > p.now)) return "retry";
  return review.side === p.side && (!cutoffMatters || p.cutoff === undefined || review.cutoff === p.cutoff) ? "agree" : "challenge";
}
export function assertAuditRoles(account: Address | undefined, roles: AuditRoles) {
  const who = account?.toLowerCase();
  if (!who || who !== roles.auditAgent.toLowerCase() || [roles.owner, roles.arbiter, roles.oracle, roles.feeRecipient].some(a => a.toLowerCase() === who)) {
    throw new Error("Audit signing account must match the registered audit role and be separate from privileged roles");
  }
}

type ReviewDependencies = {
  fetch(url: string): Promise<{ text: string; fetcher: string; url?: string }>;
  llm(prompt: string, opts: CallLLMOptions): Promise<{ text: string; provider: string; model: string }>;
};
/** The proposed answer is intentionally not part of this prompt. No shared resolver/decision cache. */
export async function reviewProposal(p: AuditProposal, deps: Partial<ReviewDependencies> = {}): Promise<AuditReview | null> {
  const url = stripResolverFragment(p.resolutionUrl);
  try {
    const evidence = await (deps.fetch ?? (u => fetchEvidence(u, { maxChars: 12_000 })))(url);
    if (!evidence.text.trim()) return null;
    const prompt = `You independently audit a prediction-market question against newly fetched evidence.
${INJECTION_GUARD}
Determine the correct side from the ORIGINAL QUESTION and side labels. Do not simplify the question to a different event, period, score, margin or threshold. A betting deadline can close entry before a sporting event finishes; distinguish that from an explicit time condition in the written question. Check event identity, dates and finality. If you cannot establish them, return UNRESOLVABLE. Do not infer truth from a source being popular or from a creator-supplied rule.
${fenceUntrusted("claim", `Question: ${p.question}\nSide A (creator): ${p.labelA}\nSide B (challengers): ${p.labelB}\nCategory: ${p.category}\nResolution source: ${url}\nCreated: ${new Date(p.createdAt * 1000).toISOString()}\nBetting deadline: ${new Date(p.deadline * 1000).toISOString()}`)}
${fenceUntrusted("fresh-evidence", evidence.text.slice(0, 12_000))}
Independently determine the deposit eligibility cutoff as well. For a scheduled game, match, race, election or show, use its START time (not the final whistle). For "X by date", use when X happened. For a price/number at a set time, use that time. Return an empty knownAt only when the evidence cannot establish a time. Confidence must cover both the answer and the cutoff. Never invent a timestamp.
Return only JSON: {"knownAt":"ISO-8601 UTC time or empty string","verdict":"CREATOR_WINS"|"CHALLENGERS_WIN"|"DRAW"|"UNRESOLVABLE","confidence":0-100,"explanation":"specific evidence and reasoning"}. Use confidence >=90 only for a clear evidence-backed result. Missing or ambiguous evidence is UNRESOLVABLE, not a guess.`;
    const answer = await (deps.llm ?? callLLMWithMeta)(prompt, { role: "audit", settlement: true, noFreeRouter: true, maxTokens: 1024, temperature: 0, jsonOnly: true, model: process.env.AUDIT_LLM_MODEL?.trim() || undefined });
    const raw = JSON.parse(extractJson(answer.text) ?? "null");
    const side = ({ CREATOR_WINS: 1, CHALLENGERS_WIN: 2, DRAW: 3, UNRESOLVABLE: 4 } as Record<string, number>)[raw?.verdict];
    if (!side || typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 100 || typeof raw.explanation !== "string") return null;
    let cutoff: number | undefined = side >= 3 ? 0 : undefined;
    if (side < 3 && typeof raw.knownAt === "string") {
      cutoff = raw.knownAt === "" ? 0 : Math.floor(Date.parse(raw.knownAt) / 1000);
      if (!Number.isSafeInteger(cutoff) || cutoff < 0 || cutoff > p.now) return null;
    } else if (side < 3 && p.cutoff !== undefined) return null;
    return { cutoff, side, confidence: raw.confidence, explanation: raw.explanation.slice(0, 1000), model: `${answer.provider}/${answer.model}`, reviewedAt: p.now, evidence: { url, text: evidence.text.slice(0, 12_000), fetcher: evidence.fetcher } };
  } catch { return null; }
}

/** An audit can only submit the existing bonded dispute, never a ruling/veto/payout. */
export async function processAuditProposal(job: AuditJob, io: AuditIO): Promise<void> {
  if (job.approvalTxHash) {
    const receipt = await io.receipt(job.approvalTxHash);
    if (!receipt) return;
    delete job.approvalTxHash;await io.save(job);
    if (receipt === "reverted") throw Error("Audit bond approval reverted");
  }
  if (job.txHash) {
    const receipt = await io.receipt(job.txHash);
    if (!receipt) {
      if (job.status !== "challenged") return; // An unknown initial outcome is not permission to resend.
      // A previously mined dispute remains provisional through the challenge window.
      const p = await io.load();
      if (proposalKey(p) !== proposalKey(job.proposal)) job.status = "stale";
      else if (p.now >= p.disputableUntil) job.status = "expired";
      else if (p.live) { job.status = "pending";delete job.txHash; }
      if (job.status === "stale" || job.status === "expired") delete job.txHash;
      await io.save(job);return;
    }
    job.status = receipt === "success" ? "challenged" : "pending";
    if (receipt === "reverted") delete job.txHash;
    await io.save(job);return;
  }
  if (["agreed", "challenged", "closed", "expired", "stale"].includes(job.status)) return;
  const expected = proposalKey(job.proposal);
  const current = async (): Promise<AuditProposal | null> => {
    const p = await io.load();
    if (proposalKey(p) !== expected) job.status = "stale";
    else if (!p.live) job.status = "closed";
    else if (p.now >= p.disputableUntil) job.status = "expired";
    else {
      if (io.mode === "challenge") assertAuditRoles(io.account, await io.roles());
      return p;
    }
    await io.save(job);return null;
  };
  let p = await current();if (!p) return;
  if (!job.review || job.reviewKey !== expected || p.now - job.review.reviewedAt > 300 || job.review.reviewedAt > p.now) {
    const review = await io.review(p);
    if (!review) { job.status = "pending";await io.save(job);return; }
    job.review = review;job.reviewKey = expected;
  }
  const action = auditAction(p, job.review);
  if (action === "retry") job.status = "pending";
  else if (action === "agree") job.status = "agreed";
  else if (io.mode === "observe") job.status = "observed";
  await io.save(job);
  if (action !== "challenge" || io.mode === "observe") return;
  p = await current();if (!p) return;
  await io.prepareBond(); // ERC20 approval may take a block; never rely on the earlier state afterwards.
  p = await current();if (!p) return;
  job.txHash = await io.submit();job.status = "submitted";
  await io.save(job);
}
