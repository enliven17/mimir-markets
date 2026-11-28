/**
 * /docs: Proof of Reasoning. The four-leaf Merkle tree a v2 audit bundle commits on chain (lib/verdict-bundle.ts
 * porSteps / porRoot / porProof / verifyPorStep), what each step holds, and how one step is proven alone.
 */
import { Figure } from "./ArcDiagrams";
import { C, Table } from "./primitives";

function Box({ tag, title, sub, hot }: { tag: string; title: string; sub: string; hot?: boolean }) {
  return (
    <div className="df-node" data-hot={hot || undefined}>
      <span className="df-tag">{tag}</span>
      <span className="df-title font-mono text-[13px]">{title}</span>
      <span className="df-sub">{sub}</span>
    </div>
  );
}

/** The tree: root, two inner nodes, four leaves in fixed order. */
export function PorTree() {
  return (
    <Figure
      label="Proof-of-Reasoning Merkle tree. Four leaves in fixed order: spec, collector, auditor, judge. Each leaf is sha256 of byte 0x00 followed by the step's canonical JSON. Node A hashes spec and collector, node B hashes auditor and judge, each as sha256 of byte 0x01, left, right. The root, sha256 of 0x01, A, B, is the evidenceHash committed on chain."
      caption="The root is the bytes32 evidenceHash in the oracle's proposal. The 0x00 / 0x01 prefixes keep a leaf from ever being passed off as an inner node."
    >
      <div className="grid gap-3">
        <div className="mx-auto w-full max-w-[360px]">
          <Box tag="Root · on chain" title="evidenceHash" sub="sha256(0x01 ‖ A ‖ B)" hot />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Box tag="Node A" title="sha256(0x01 ‖ L0 ‖ L1)" sub="spec + collector" />
          <Box tag="Node B" title="sha256(0x01 ‖ L2 ‖ L3)" sub="auditor + judge" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Box tag="L0 · spec" title="what was asked" sub="version, program, claimId, decidedAt, claim" />
          <Box tag="L1 · collector" title="what was read" sub="evidence (+ sha256 receipt, fetchedAt), prices" />
          <Box tag="L2 · auditor" title="how it reasoned" sub="resolver, council, model, rawVerdict" />
          <Box tag="L3 · judge" title="what was decided" sub="adjustments, finalVerdict, every other field" />
        </div>
      </div>
    </Figure>
  );
}

export function PorStepTable() {
  return (
    <Table
      caption="The four Proof-of-Reasoning steps"
      head={["Leaf", "Step", "Bundle fields", "What a Sentinel checks"]}
      rows={[
        ["0", "spec", <C key="s">version, program, claimId, decidedAt, claim</C>, "The question, source URL and deadline match the market on chain."],
        ["1", "collector", <C key="c">evidence, prices</C>, <>The evidence text re-hashes to <C>evidence.sha256</C>; deadline prices agree with independent readings.</>],
        ["2", "auditor", <C key="a">resolver, council, model, rawVerdict</C>, "Which rule or model answered, and what it said before any adjustment."],
        ["3", "judge", <C key="j">adjustments, finalVerdict, …rest</C>, <>The final verdict is the side proposed on chain. Fields added later (e.g. <C>lateDepositPolicy</C>) land here.</>],
      ]}
    />
  );
}
