# Audit fixes and signed-request replay protection

This release collects the pre-mainnet audit fixes: native private VS wallet invitations, paused-proposal refunds,
generic JSON resolver fallback, designated audit-agent dispute admission and worker, complete late-stake detection,
private Arc paid-call redemption, and the pinned x402 build dependencies. Existing bettor dispute rights remain.

## One-use Launch authorizations

Signed create, token, status, withdrawal, copy, copy-withdrawal and follow requests retain their current message and
five-minute freshness rules, including up to one minute of future clock skew. No client signing change is needed.

After verifying the signature, the server hashes the complete verified message and atomically inserts that digest
into the existing Convex appStore under the logical table `launch_authorizations`. The digest binds action, normalized
owner, agent, exact body hash and signed timestamp. Different signature encodings or valid signatures for the same
authorization cannot create additional admissions. Multiple web instances share the same one-use database record.

The record stores `expiresAt = signedAt + 300000`; its indexed `at` is that expiration. Cleanup retains it for an
additional day to avoid cross-service clock races. Inclusive expiration and permitted future skew remain supported.
Freshness is checked again after asynchronous verification and after storage responds. A consumed authorization
stays consumed even if later validation, a downstream operation or the response fails; sign a new request to retry.
This is at-most-once admission, not atomic coupling between the database record and a later chain transaction.

Duplicate admission returns 409. Unconfigured or unavailable durable storage returns 503 and performs no authorized
action. Ordinary request-rate limits remain independent and unchanged; they no longer implement replay protection.

## Deployment

- Signed Launch/follow writes require `NEXT_PUBLIC_CONVEX_URL` and the existing store credentials
  (`MIMIR_STORE_SECRET`, or the existing legacy secret fallback), matching the Convex deployment. Missing configuration
  fails closed. Deploy the backend allowlist/cleanup support before the new web consumer.
- No deployment exists for this work. If migrating a live older version later, do not mix old and new web workers:
  stop signed writes, drain in-flight requests, wait longer than the six-minute maximum acceptance horizon, then
  switch all workers. Old raw-signature rate-limit records cannot reconstruct the new authorization digests.
- Deploy the new `arcEvents.by_market_name_at` index with the late-stake query. It uses bounded indexed witnesses
  over the complete history and defers settlement if legacy stake timestamps are missing. Summary counts are
  explicitly lower bounds. Repair missing timestamps before affected markets can settle.
- Arc paid calls require a separate `MimirAgentPay` deployment using Arc's six-decimal ERC20 USDC interface and
  `ARC_AGENT_PAY_ADDRESS` set on both web and Convex. Use `scripts/arc/deploy-agent-pay.mts` and test
  `scripts/arc/pay-agent.mts` before enabling mainnet. Both chains redeem with `<chain>:<tx>:<secret>`; plain Arc
  transfers no longer buy calls. Base's private commitment flow remains supported.
- The audit worker still starts in observe mode. Register and fund the separate audit signer and configure
  `AUDIT_MODE=challenge` to submit bonded disputes. Only the arbiter rules; ordinary unanswered disputes retain the
  original proposal after timeout. There is no automated arbiter worker in this release.

The whole-market late-stake refund policy is intentionally unchanged and remains under product discussion. Price
negation and qualified sports questions still depend on the user's selected independent auditor/arbiter mitigation;
their original automatic resolver shortcuts were not changed by this release.

## Verification

Regression tests exercise real signed-request verification and the real appStore mutation/cleanup handlers with
controlled storage and clock fixtures. Coverage includes signature capitalization and recovery-byte representations,
concurrent duplicate requests, independent server modules, old window boundaries, all seven actions, message binding,
freshness/skew edges, slow verification/storage, outages and cleanup. Existing payment/market and contract tests are
retained. No mainnet deployment, live custody operation or live payment is part of this source release.
