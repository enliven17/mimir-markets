pub const CONFIG_SEED: &[u8] = b"config";
pub const VAULT_SEED: &[u8] = b"vault";
pub const BALANCE_SEED: &[u8] = b"balance";
pub const CLAIM_SEED: &[u8] = b"claim";
/// Per-recipient agent-owner fee accrual PDA: [FEE_SEED, owner]
pub const FEE_SEED: &[u8] = b"fees";

/// 2 USDC minimum stake (6 decimals on Solana)
pub const MIN_STAKE: u64 = 2_000_000;
/// Bond a participant posts to dispute a proposed verdict (V3: MIN_STAKE)
pub const DISPUTE_BOND: u64 = MIN_STAKE;
/// Anti-sniping: no challenges in the final 60s before the deadline
pub const CHALLENGE_LOCK_SECONDS: i64 = 60;
pub const MAX_CHALLENGERS: u8 = 16;

// String limits (mirror the #[max_len] on Claim)
pub const MAX_QUESTION: usize = 200;
pub const MAX_POSITION: usize = 100;
pub const MAX_URL: usize = 200;
pub const MAX_CATEGORY: usize = 32;
pub const MAX_SUMMARY: usize = 300;

// ── Fee + governance limits (MimirV3 parity) ──────────────────────────────
pub const BPS_DENOMINATOR: u128 = 10_000;
/// No policy may ever take more than 10% of a winner's profit, in total.
pub const MAX_TOTAL_FEE_BPS: u16 = 1_000;
/// A queued fee policy cannot take effect for this long.
pub const FEE_TIMELOCK_SECONDS: i64 = 2 * 86_400;
/// An oracle change waits this long, so participants can react to a new settler.
pub const ORACLE_TIMELOCK_SECONDS: i64 = 2 * 86_400;
/// Upper bound on the dispute window, so payouts cannot be parked for weeks.
pub const MAX_DISPUTE_WINDOW: i64 = 7 * 86_400;
/// V3 default: an unresolved claim is refundable 7 days after its deadline.
pub const DEFAULT_RESOLUTION_GRACE: i64 = 7 * 86_400;
/// Bounds for the (per-claim snapshotted) resolution grace.
pub const MIN_RESOLUTION_GRACE: i64 = 60;
pub const MAX_RESOLUTION_GRACE: i64 = 30 * 86_400;

// ── Claim states (V3 numbering) ───────────────────────────────────────────
pub const ST_OPEN: u8 = 0;
pub const ST_ACTIVE: u8 = 1;
pub const ST_RESOLVED: u8 = 2;
pub const ST_CANCELLED: u8 = 3;
/// The oracle proposed a verdict; disputable until `disputable_until`.
pub const ST_PROPOSED: u8 = 4;
/// A participant disputed the proposal; the admin (arbiter) decides.
pub const ST_DISPUTED: u8 = 5;

// ── Winner sides ──────────────────────────────────────────────────────────
pub const SIDE_NONE: u8 = 0;
pub const SIDE_CREATOR: u8 = 1;
pub const SIDE_CHALLENGERS: u8 = 2;
pub const SIDE_DRAW: u8 = 3;
pub const SIDE_UNRESOLVABLE: u8 = 4;

// ── Dispute bond lifecycle ────────────────────────────────────────────────
pub const BOND_NONE: u8 = 0;
/// Bond sits in the vault while the dispute is open.
pub const BOND_HELD: u8 = 1;
/// Disputer was right (or the claim was refunded): bond owed back, pull via refund_bond.
pub const BOND_REFUND_DUE: u8 = 2;
pub const BOND_REFUNDED: u8 = 3;
/// Disputer was wrong: bond moved to the platform fee pool.
pub const BOND_FORFEITED: u8 = 4;

pub const REFUND_SUMMARY: &str = "Refunded: not resolved within the grace period";
