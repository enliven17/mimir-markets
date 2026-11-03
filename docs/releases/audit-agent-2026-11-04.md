# Designated audit agent and arbiter challenges

Existing bettors retain their right to dispute. Each native/ERC20 VS/pool contract now has one owner-managed `auditAgent` address. That designated agent and the current arbiter may use the existing bonded dispute functions without holding a position. Other nonparticipants remain rejected. The audit agent does not need an invitation to review or challenge a private VS claim.

`setAuditAgent(address)` appoints/rotates the role; zero revokes its extra right immediately. `AuditAgentChanged` records updates. Only the owner can configure it. The audit account must differ from owner, arbiter, oracle and fee recipient. Role activation checks also prevent a previously queued owner/oracle/treasury change from merging those roles with the audit account. No constructors, proposal tuples or existing dispute selectors/events changed.

Both additional challengers post the same **2 USDC bond**, within the same dispute window. Only the arbiter can issue a ruling. The arbiter can also initiate a dispute and then rule on it; this permission does not create an independent second reviewer. The audit agent can only initiate the dispute. A correct challenge returns the bond; an incorrect one forfeits it. **Existing timeout behavior remains:** an ordinary bonded dispute the arbiter never rules on can eventually settle to the original proposal and forfeit the bond. Owner veto and paused-refund behavior are unchanged. Arbiter response before grace expiry remains required. This is not a new refund-on-audit-timeout design.

## Owner setup

Fresh deployments are required; these contracts are not upgradeable. The role starts disabled. Install the new market addresses/network/from-block configuration, set the public `AUDIT_AGENT_ADDRESS`, then produce reviewable owner transactions without broadcasting:

```sh
npm run audit-agent -- --print-setup
```

The output contains chain IDs, destinations and zero-value `setAuditAgent` calldata for each enabled VS/pool. Execute from the actual owner (for example its Safe). Do not give the worker an owner, oracle or arbiter key. Base mainnet preflight verifies the registered audit address, role separation, ETH and at least two bonds of USDC. That balance is a minimum check, not a sufficient live-market operating budget.

Arbiters may submit the existing `disputeResolution(id)` (VS) or `dispute(id)` (pool) transaction from their own account. Native deployments require exactly 2e18 value; ERC20 deployments require approval/pull of exactly 2e6 USDC. The owner’s existing bondless `vetoProposal` is a separate authority and is not granted to the auditor.

## Independent worker

Run on a separate host/process/deployment with an audit-only environment file. Supply the backend market configuration from `.env.example` (including a nonzero deployment FROM_BLOCK), RPCs, `AUDIT_AGENT_ADDRESS`, dedicated `AUDIT_GEMINI_API_KEY` and/or `AUDIT_ANTHROPIC_API_KEY`, and a private `AUDIT_STATE_FILE` path. Select a different provider/model from the proposer where practical; separate keys alone do not make model errors independent.

```sh
node --env-file=.env.audit --import tsx agents/audit/run.ts --once
node --env-file=.env.audit --import tsx agents/audit/run.ts
```

The default `AUDIT_MODE=observe` performs reviews without bond approvals or disputes. After observing/reviewing results, the operator can select `AUDIT_MODE=challenge` and provide/fund `AUDIT_AGENT_KEY`. It must derive the registered audit address, with separate model credentials. Audit scope never falls back to proposer/shared model keys, on either network. Never place its private environment in the browser, public source, or proposer deployment.

The worker reads proposal events and immutable question/side/source fields directly from each configured chain. It does not reuse the proposer’s verdict cache, generic JSON comparison, sports winner parser, or council tally as its answer. It fetches fresh source evidence and asks a separate model to evaluate the original question. The proposer’s answer is omitted from that prompt. Only evidence-backed disagreement at confidence >=90 can trigger a dispute; missing/ambiguous evidence or an unresolvable model answer stays retryable.

It rechecks role, proposal identity and chain time before funding/submitting. ERC20 approvals are exact-bond amounts. Approval/dispute hashes persist so an unknown receipt does not trigger blind resubmission. While a signing transaction is unresolved on a chain, other proposals may still be reviewed but don't create competing signing intents. State is deployment-bound, written atomically with private permissions, and locally locked against a second worker. Never run two independent hosts with the same signing key; local locking is not a distributed lease.

Proposal review records and transaction status are retained in `<AUDIT_STATE_FILE>.reports/`, keyed by a hash of the full proposal/question identity. Make these records available to the arbiter through your operational process. No external messages or reports are published automatically. JSON state alone is not a cryptographically authenticated public audit feed.

## Operation and limits

- Discovery uses 2,000-block steps and a 64-block overlap. A mined dispute is provisional: its receipt's block hash is checked against the canonical block and it stays scheduled through the dispute window. If a previously mined receipt disappears and the exact proposal is live again, the worker reopens the job and rechecks before submitting another dispute. A transaction with an initially unknown outcome is never blindly resubmitted. Receipt checks rotate among due jobs. There is no assumption of finality after one block. A deep reorg or incompatible checkpoint requires operator inspection; don't delete checkpoint/lock files while the worker may be active.
- Queues are capped at 1,000 jobs/10,000 event markers; overflow stops cursor advancement and logs an error. Each loop handles at most one receipt and two other reviews. Monitor backlog, model quota, heartbeat and proposal deadlines; tune capacity only after measuring workload.
- The worker logs errors/heartbeats to stdout/stderr; it does not automatically send notifications. Connect operational monitoring separately. An RPC/model outage, insufficient bond/gas, stuck/dropped transaction or missed deadline can prevent intervention. Reconcile an unknown signing transaction before replacing it or restarting with a fresh state file.
- A zero dispute window cannot be protected after proposal, and challenge mode refuses such a deployment. Real windows must leave time for discovery, evidence/model calls, approval and chain inclusion. Mainnet contracts already enforce at least one day; verify deployed values.
- A model can falsely flag a valid result or miss a bad one. The independent arbiter remains authoritative. Existing financial policies (such as late-stake handling or deliberate refunds) can require evidence beyond the final score; assess shadow reviews against those cases before enabling spending. The worker does not claim complete policy-equivalence proof.
- Keep the disabled generic JSON shortcut and other tactical fixes. The deferred sports question-matching issue is not repaired by this worker. Auditing adds a second opportunity to catch it; it cannot guarantee a catch or claw back finalized payouts.

No actual deployment, role assignment, key creation, funding or live worker launch was performed by this source update. Production build validation remains subject to the existing Coinbase/@x402 dependency blocker recorded in prior reports.
