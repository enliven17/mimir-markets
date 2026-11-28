/**
 * The runnable snippets shown in /docs "Verify it yourself". docs/PROOF-OF-REASONING.md carries the same code:
 * change both together. The standalone version re-implements lib/verdict-bundle.ts (canonicalJson, porSteps,
 * porRoot) with node:crypto only, so a verifier does not have to trust Mimir's code.
 */

/** Dependency-free: fetch a verdict, recompute its root, check the evidence receipt. Node 18+, `npx tsx verify-por.ts pool 12`. */
export const STANDALONE_VERIFY = `// verify-por.ts: npx tsx verify-por.ts <vs|pool> <id>
import { createHash } from "node:crypto";

const sha = (...parts: Buffer[]) => createHash("sha256").update(Buffer.concat(parts)).digest();
// Sorted keys, compact, undefined dropped: the exact bytes Mimir hashes.
const canon = (v: unknown): string =>
  Array.isArray(v) ? \`[\${v.map(canon).join(",")}]\`
  : v && typeof v === "object"
    ? \`{\${Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => \`\${JSON.stringify(k)}:\${canon(x)}\`)
        .join(",")}}\`
    : JSON.stringify(v) ?? "null";
const leaf = (step: unknown) => sha(Buffer.from([0x00]), Buffer.from(canon(step), "utf8"));
const node = (l: Buffer, r: Buffer) => sha(Buffer.from([0x01]), l, r);

function root(b: any): string {
  if (b.version < 2) return "0x" + sha(Buffer.from(canon(b), "utf8")).toString("hex"); // v1: flat sha256
  const { version, program, claimId, decidedAt, claim, evidence, prices, resolver, council, model, rawVerdict, ...judge } = b;
  const [spec, collector, auditor, judgeLeaf] = [
    { version, program, claimId, decidedAt, claim },
    { evidence, prices },
    { resolver, council, model, rawVerdict },
    judge,
  ].map(leaf);
  return "0x" + node(node(spec, collector), node(auditor, judgeLeaf)).toString("hex");
}

async function main() {
  const [kind = "pool", id = "1"] = process.argv.slice(2);
  const res = await fetch(\`https://mimirmarkets.xyz/api/markets/\${kind}/\${id}?chain=bsc\`);
  const v = (await res.json()).data?.market?.verdict;
  if (!v?.bundle || !v.evidenceHash || /^0x0{64}$/i.test(v.evidenceHash)) {
    throw new Error("no audit bundle: not proposed yet, or a refund that needed no decision");
  }
  const bundle = JSON.parse(v.bundle);
  const recomputed = root(bundle);
  console.log("proposal tx  ", v.txHash);
  console.log("committed    ", v.evidenceHash);
  console.log("recomputed   ", recomputed);
  console.log("root matches ", recomputed === v.evidenceHash.toLowerCase());
  if (bundle.evidence?.sha256) {
    const receipt = sha(Buffer.from(bundle.evidence.text, "utf8")).toString("hex");
    console.log("receipt ok   ", receipt === bundle.evidence.sha256);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});`;

/** With the repo's own library: prove one step against the root without the other three. */
export const PROVE_ONE_STEP = `// prove-step.ts, from the repo root: npx tsx prove-step.ts <vs|pool> <id> [spec|collector|auditor|judge]
import { porProof, porSteps, verifyPorStep, type PorStep, type VerdictBundle } from "./lib/verdict-bundle";

async function main() {
  const [kind = "pool", id = "1", step = "collector"] = process.argv.slice(2) as [string, string, PorStep];
  const res = await fetch(\`https://mimirmarkets.xyz/api/markets/\${kind}/\${id}?chain=bsc\`);
  const v = (await res.json()).data?.market?.verdict;
  const bundle = JSON.parse(v.bundle) as VerdictBundle; // must be version 2

  const proof = porProof(bundle, step);   // [sibling leaf, other pair], hex
  const content = porSteps(bundle)[step]; // e.g. { evidence, prices } for "collector"
  // A Sentinel can publish just { step, content, proof }: it shows which step it disputes, nothing else.
  console.log({ step, proof, valid: verifyPorStep(step, content, proof, v.evidenceHash) });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});`;
