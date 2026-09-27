use anchor_lang::prelude::*;

// ── Admin / governance ────────────────────────────────────────────────────

#[event]
pub struct Initialized {
    pub admin: Pubkey,
    pub oracle: Pubkey,
    pub usdc_mint: Pubkey,
    pub fee_recipient: Pubkey,
    pub platform_fee_bps: u16,
    pub agent_fee_bps: u16,
    pub dispute_window: i64,
    pub resolution_grace: i64,
}

#[event]
pub struct PausedSet {
    pub paused: bool,
}

#[event]
pub struct AdminTransferStarted {
    pub previous: Pubkey,
    pub next: Pubkey,
}

#[event]
pub struct AdminTransferred {
    pub previous: Pubkey,
    pub next: Pubkey,
}

#[event]
pub struct OracleChangeQueued {
    pub next: Pubkey,
    pub eta: i64,
}

#[event]
pub struct OracleChangeCancelled {
    pub next: Pubkey,
}

#[event]
pub struct OracleChanged {
    pub previous: Pubkey,
    pub next: Pubkey,
}

#[event]
pub struct WindowsUpdated {
    pub dispute_window: i64,
    pub resolution_grace: i64,
}

#[event]
pub struct FeePolicyQueued {
    pub platform_fee_bps: u16,
    pub agent_fee_bps: u16,
    pub fee_recipient: Pubkey,
    pub eta: i64,
}

#[event]
pub struct FeePolicyCancelled {}

#[event]
pub struct FeePolicyUpdated {
    pub platform_fee_bps: u16,
    pub agent_fee_bps: u16,
    pub fee_recipient: Pubkey,
}

#[event]
pub struct FeesWithdrawn {
    pub to: Pubkey,
    pub amount: u64,
}

#[event]
pub struct AgentFeesClaimed {
    pub owner: Pubkey,
    pub to: Pubkey,
    pub amount: u64,
}

// ── Escrow ────────────────────────────────────────────────────────────────

#[event]
pub struct Deposited {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Withdrawn {
    pub user: Pubkey,
    pub amount: u64,
}

// ── Claim lifecycle ───────────────────────────────────────────────────────

#[event]
pub struct ClaimCreated {
    pub id: u64,
    pub creator: Pubkey,
    pub stake: u64,
    pub deadline: i64,
    pub agent: Pubkey,
}

#[event]
pub struct ClaimChallenged {
    pub id: u64,
    pub challenger: Pubkey,
    pub stake: u64,
    pub agent: Pubkey,
}

#[event]
pub struct ClaimCancelled {
    pub id: u64,
}

#[event]
pub struct ResolutionProposed {
    pub id: u64,
    pub winner_side: u8,
    pub confidence: u8,
    pub evidence_hash: [u8; 32],
    pub disputable_until: i64,
}

#[event]
pub struct ResolutionDisputed {
    pub id: u64,
    pub disputer: Pubkey,
    pub bond: u64,
}

#[event]
pub struct DisputeSettled {
    pub id: u64,
    pub winner_side: u8,
    pub disputer_right: bool,
}

#[event]
pub struct ClaimResolved {
    pub id: u64,
    pub winner_side: u8,
    pub confidence: u8,
    pub evidence_hash: [u8; 32],
}

#[event]
pub struct ClaimExpiredRefund {
    pub id: u64,
    pub caller: Pubkey,
}

#[event]
pub struct PayoutSent {
    pub id: u64,
    pub to: Pubkey,
    pub amount: u64,
    pub platform_fee: u64,
    pub agent_fee: u64,
}

#[event]
pub struct BondRefunded {
    pub id: u64,
    pub to: Pubkey,
    pub amount: u64,
}
