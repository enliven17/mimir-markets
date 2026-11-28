/**
 * /docs: who can do what on the market contracts, and what nobody can do. Source of truth:
 * contracts/MimirV3Erc20.sol, contracts/MimirPoolErc20.sol, contracts/MimirBscFees.sol (+ MimirFees.sol).
 * Keep every row traceable to a function name.
 */
import { C, Table } from "./primitives";

export function RolesTable() {
  return (
    <Table
      caption="Roles and their powers on the market and fee contracts"
      head={["Role", "Can", "Delay", "Limits"]}
      rows={[
        [
          "Owner (a Safe multisig on mainnet)",
          <>
            <C>setPaused</C>, <C>revokeOracle</C>, <C>setAuditAgent</C>, <C>setCaps</C>, <C>vetoProposal</C>,{" "}
            <C>setLockAt</C>
          </>,
          "Immediate",
          "Pause stops new positions, proposals, finalization, rulings and pool winners' claims; refunds, cancels and withdrawals stay open. Caps only gate new positions. A veto works only inside the dispute window and sends the proposal to the arbiter. A lock can only move earlier.",
        ],
        [
          "Owner",
          <>
            <C>queueOracle</C>, <C>setArbiter</C> (queues; anyone runs <C>executeArbiter</C>), <C>queueFeeRecipient</C>, <C>transferOwnership</C> (and their cancels); on the fee contract{" "}
            <C>queueSigner</C>, <C>transferOwnership</C>
          </>,
          "2 days",
          <>After the delay anyone can execute the oracle, fee-recipient and signer changes; a new owner must accept. The oracle can never be the owner, arbiter or fee recipient (<C>RoleCollision</C>).</>,
        ],
        [
          "Owner (fee contract)",
          <C key="r">revokeSigner</C>,
          "Immediate",
          "Revoking the fee-ticket signer can only raise discounted accounts back to the 0.5% base rate.",
        ],
        [
          "Arbiter (a Safe on mainnet)",
          <C key="a">resolveDispute / resolveDisputeWithCutoff</C>,
          "Only while disputed",
          "Rules disputed or vetoed proposals only, and only before the 7-day grace ends. May also dispute, posting the bond.",
        ],
        [
          "Oracle (a hot key)",
          <>
            <C>resolveClaimWithCutoff</C> (VS), <C>resolve</C> / <C>resolveWithCutoff</C> (pool)
          </>,
          "After the deadline",
          "Only proposes: with a dispute window (at least 24 h off testnet) the verdict waits out the window. Refused after the grace (GraceOver) or while paused.",
        ],
        [
          "Audit agent (optional)",
          <>
            <C>disputeResolution</C> (VS), <C>dispute</C> (pool)
          </>,
          "Dispute window",
          "May dispute without a position, posting the bond. No settlement or admin power. Set to zero to disable.",
        ],
        [
          "Sentinel (any Agent ID holder, BSC)",
          <>
            <C>disputeResolution</C> (VS), <C>dispute</C> (pool)
          </>,
          "Dispute window",
          "May dispute without a position, posting the 2 USDC bond. Nothing else.",
        ],
        [
          "Fee recipient",
          <C key="f">claimFees / claimFeesTo</C>,
          "Any time",
          "Pulls only what accrued to it: entry fees, the platform's copy-trade share, forfeited bonds.",
        ],
        [
          "Market creator",
          <>
            <C>cancelClaim</C> (VS, before any challenger), <C>setInvited</C> (private VS), <C>setLockAt</C>
          </>,
          "Before settlement",
          "Cancelling returns only the creator's own stake.",
        ],
        [
          "Anyone",
          <>
            <C>finalizeResolution</C> / <C>finalize</C>, <C>refundExpired</C>, <C>claimFor</C>, <C>executeOracle</C>, <C>executeFeeRecipient</C>
          </>,
          "When due",
          "claimFor pays only the named user. refundExpired opens 7 days after the latest of deadline, proposal and dispute.",
        ],
      ]}
    />
  );
}

/** What no role, Mimir included, can do. Each line is enforced by contract code, not policy. */
export const NOBODY_CAN: Array<[string, string]> = [
  ["Move escrowed USDC to an arbitrary address.", "Every outbound transfer goes to a participant (payout, refund), a disputer (bond back), or an accrued-fee balance that only its owner can pull."],
  ["Upgrade or swap the contract code.", "No proxy, no delegatecall, no selfdestruct."],
  ["Change the token, the fee contract, the minimum stake, the bond or the dispute window.", "All are immutable, set in the constructor."],
  ["Charge more than 1% entry fee.", "MAX_ENTRY_BPS reverts above 100 bps. On BSC the fee contract's highest rate is 0.5% (BASE_BPS, a constant) and Agent ID holders pay 0%; the Agent ID registry address is immutable."],
  ["Take a fee on winnings.","Only copy trades pay, 1% + 1% of profit, never on a loss, a draw or a refund."],
  ["Swap the oracle, owner or fee recipient in under 2 days.", "Timelocked; the queued change is public as an event."],
  ["Settle before the deadline, after the 7-day grace, or while paused.", "NotYetExpired, GraceOver and IsPaused reverts."],
  ["Block the escape hatch.", "refundExpired works for anyone, paused or not."],
];

/** The trust assumption, stated plainly. */
export function TrustNote() {
  return (
    <p className="m-0 text-[14px] text-muted">
      What you trust: an undisputed proposal finalizes on the oracle&apos;s word. The owner can veto any proposal inside its window and
      the arbiter rules it, so the owner multisig and its arbiter have the last word on any proposal they challenge in time. The
      arbiter itself can only be replaced after a public 2-day delay (<C>setArbiter</C> queues, <C>executeArbiter</C> installs), so a
      judge cannot be swapped in for one dispute. Holding a pause for 7 days past a market&apos;s latest deadline, proposal or dispute turns it
      into a full refund (bond returned), never into a payout to anyone else.
    </p>
  );
}
