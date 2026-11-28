# Proof of Reasoning

Reference for the commitment the oracle puts on chain with every verdict. Audience: anyone verifying a Mimir verdict,
and developers writing a Sentinel. Source of truth: [`lib/verdict-bundle.ts`](../lib/verdict-bundle.ts).

## In one paragraph

Every oracle decision is sealed into an **audit bundle**: a JSON document with the claim as read, the evidence text,
deadline prices, the rule or model that answered, every adjustment and the final verdict. The proposal transaction
commits a single `bytes32 evidenceHash` to that bundle. In bundle **version 2** the hash is the root of a four-leaf
Merkle tree, one leaf per reasoning step. With the bundle you can re-derive the root. With one step and two sibling
hashes you can prove that one step without the other three.

## The tree

```
                         root  = evidenceHash (on chain)
                         sha256(0x01 ‖ A ‖ B)
                    ┌──────────────┴──────────────┐
          A = sha256(0x01 ‖ L0 ‖ L1)     B = sha256(0x01 ‖ L2 ‖ L3)
            ┌────────┴────────┐             ┌────────┴────────┐
        L0 spec         L1 collector    L2 auditor        L3 judge

        Ln = sha256(0x00 ‖ canonicalJson(step n))
```

The `0x00` and `0x01` prefixes separate leaves from inner nodes, so a leaf can never be passed off as a node.

## The four steps

| Leaf | Step | Bundle fields | Answers |
|---|---|---|---|
| 0 | `spec` | `version`, `program`, `claimId`, `decidedAt`, `claim` | What was asked: question, both positions, resolution URL, category, deadline. |
| 1 | `collector` | `evidence`, `prices` | What was read: the evidence text, its content receipt, the deadline price readings. |
| 2 | `auditor` | `resolver`, `council`, `model`, `rawVerdict` | How it reasoned: the deterministic rule or model that answered, and its raw verdict. |
| 3 | `judge` | everything else: `adjustments`, `finalVerdict`, … | What was decided: every adjustment and the final verdict. |

Fields not named in steps 0–2 always fall under `judge`. A field added later (for example `lateDepositPolicy`,
which records the settlement cutoff) therefore lands inside the root automatically. No key of the bundle is ever left
out.

## Encoding rules

| Item | Rule |
|---|---|
| Canonical JSON | Object keys sorted by UTF-16 code unit order, no whitespace, `undefined` fields dropped, arrays in order, values serialized with `JSON.stringify`. |
| Leaf | `sha256(0x00 ‖ utf8(canonicalJson(step)))` |
| Node | `sha256(0x01 ‖ left ‖ right)`, 32-byte inputs |
| Root | `node(node(L0, L1), node(L2, L3))` |
| Hex | Lowercase. The library returns it without `0x`; the chain and the API use `0x`. |
| Timestamps | `decidedAt` and `evidence.fetchedAt` are milliseconds; `claim.deadline` is seconds. |

A non-JavaScript verifier must reproduce `JSON.stringify` exactly, including number formatting (`1e21`, `0.1`) and
string escaping. Port the canonicalizer carefully, or verify with Node.

## Content receipt (collector step)

`evidence.sha256` is the lowercase hex sha256 of `evidence.text` (UTF-8). `evidence.fetchedAt` records when the oracle
read it. The text is truncated to 8,000 characters before hashing, and the receipt covers exactly the stored text
(`bundleEvidence` in [`agents/oracle/decide.ts`](../agents/oracle/decide.ts)).

The receipt lets someone holding a copy of the page check it against what the oracle actually read, separately from
the root.

## Versions and special cases

| Case | `evidenceHash` |
|---|---|
| Bundle `version: 2` | The Merkle root above. |
| Bundle `version: 1` (older verdicts) | `sha256(utf8(canonicalJson(bundle)))`, flat. |
| Uncontested pool refund (one side empty) | `0x00…00`, published bundle `{}`. There was no decision to commit. |
| Linked markets (same question on several chains) | One decision per pair, so a leg's `spec` may name the leg that decided (`program`, `claimId`). When the result picks a side, each leg adds its own `lateDepositPolicy` and re-seals, so roots can differ per leg. |

The API serves the bundle as `JSON.stringify` output, not in canonical form. Always parse it and canonicalize again.
Do not hash the raw string.

## Library API

```ts
import { bundleHash, porProof, porRoot, porSteps, sealBundle, verifyPorStep, POR_STEPS } from "./lib/verdict-bundle";

porSteps(bundle)                  // { spec, collector, auditor, judge }
porRoot(bundle)                   // Uint8Array(32), the v2 root
bundleHash(bundle)                // hex (no 0x): v2 root, or flat sha256 for v1
porProof(bundle, "collector")     // [siblingLeafHex, otherPairHex]
verifyPorStep("collector", content, proof, rootHex) // boolean; rootHex with or without 0x
sealBundle(bundle)                // { canonical, hash, bytes }: what the oracle commits
```

A proof always has exactly two entries: the sibling leaf, then the hash of the other pair. `verifyPorStep` returns
false for an unknown step or a proof of any other length.

## Verify a verdict without Mimir's code

Fetch a market, recompute the root with `node:crypto` only, and check the receipt. Node 18 or later.

```ts
// verify-por.ts: npx tsx verify-por.ts <vs|pool> <id>
import { createHash } from "node:crypto";

const sha = (...parts: Buffer[]) => createHash("sha256").update(Buffer.concat(parts)).digest();
// Sorted keys, compact, undefined dropped: the exact bytes Mimir hashes.
const canon = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canon).join(",")}]`
  : v && typeof v === "object"
    ? `{${Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => `${JSON.stringify(k)}:${canon(x)}`)
        .join(",")}}`
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
  const res = await fetch(`https://mimirmarkets.xyz/api/markets/${kind}/${id}?chain=bsc`);
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
});
```

Then close the loop on chain. Open `txHash` on BscScan; the `ResolutionProposed` event's `evidenceHash` must equal
the root you computed. The API is a convenience; the event is the commitment. You can also read it from the contract:
`proposals(id)` on `MimirV3Erc20` (field `evidenceHash`) or `getProposal(id)` on `MimirPoolErc20`. If an arbiter later
rules on a dispute, it commits its own `evidenceHash` with the ruling (`ClaimResolved` / `MarketResolved`).

## Prove one step

```ts
// prove-step.ts, from the repo root: npx tsx prove-step.ts <vs|pool> <id> [spec|collector|auditor|judge]
import { porProof, porSteps, verifyPorStep, type PorStep, type VerdictBundle } from "./lib/verdict-bundle";

async function main() {
  const [kind = "pool", id = "1", step = "collector"] = process.argv.slice(2) as [string, string, PorStep];
  const res = await fetch(`https://mimirmarkets.xyz/api/markets/${kind}/${id}?chain=bsc`);
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
});
```

## What the root does and does not prove

| Proves | Does not prove |
|---|---|
| The published bundle is byte-for-byte what the oracle committed, at proposal time. | That the evidence page said what the bundle says. The receipt binds the text; a copy of the page is needed to compare. |
| No step was added, removed or edited afterwards. | That the model reasoned well. It shows what was decided and on what basis. |
| Which exact step a dispute is about (with a two-hash proof). | That the source was trustworthy. See the mainnet payout policy in [how-mimir-works.md](how-mimir-works.md#how-the-oracle-decides). |

## Related

- [SENTINELS.md](SENTINELS.md): who can dispute, and the agent that checks every proposal.
- [how-mimir-works.md](how-mimir-works.md): the full settlement pipeline.
- [`agents/oracle/decide.ts`](../agents/oracle/decide.ts): where bundles are built.
