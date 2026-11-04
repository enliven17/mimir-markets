use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Two-step admin transfer: set by propose_admin, cleared by accept_admin.
    pub pending_admin: Pubkey,
    pub oracle: Pubkey,
    /// Timelocked oracle rotation (queue_oracle → execute_oracle).
    pub pending_oracle: Pubkey,
    /// 0 = nothing queued.
    pub pending_oracle_eta: i64,
    pub usdc_mint: Pubkey,
    pub claim_count: u64,
    pub total_resolved: u64,
    pub vault_bump: u8,
    /// Stops create/challenge/propose. Never stops withdraw, payouts, refunds, disputes.
    pub paused: bool,
    /// Seconds a proposed verdict stays disputable (snapshotted per claim). 0 = settle instantly.
    pub dispute_window: i64,
    /// Seconds after the deadline an unresolved claim becomes refundable (snapshotted per claim).
    pub resolution_grace: i64,
    // Live fee policy (snapshotted onto each claim at creation).
    pub fee_recipient: Pubkey,
    pub platform_fee_bps: u16,
    pub agent_fee_bps: u16,
    // Queued fee policy (timelocked).
    pub pending_fee_recipient: Pubkey,
    pub pending_platform_fee_bps: u16,
    pub pending_agent_fee_bps: u16,
    /// 0 = nothing queued.
    pub pending_fee_eta: i64,
    /// Outstanding platform fees + forfeited bonds held in the vault, withdrawable via withdraw_fees.
    pub fees_accrued: u64,
    pub lifetime_fees_accrued: u64,
    pub lifetime_fees_claimed: u64,
    /// Room for future fields without a migration.
    pub _reserved: [u8; 64],
}

#[account]
#[derive(InitSpace)]
pub struct UserBalance {
    pub owner: Pubkey,
    pub amount: u64,
}

/// Agent-owner fee accrual for one recipient. Never pushed: the owner pulls
/// it with claim_agent_fees, so a recipient can never block a payout.
#[account]
#[derive(InitSpace)]
pub struct FeeBalance {
    pub owner: Pubkey,
    pub amount: u64,
    pub lifetime: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct Challenger {
    pub addr: Pubkey,
    pub stake: u64,
    pub paid: bool,
    /// Agent owner credited for this position (Pubkey::default() = none).
    pub agent: Pubkey,
}

#[account]
#[derive(InitSpace)]
pub struct Claim {
    pub id: u64,
    pub bump: u8,
    pub creator: Pubkey,
    #[max_len(200)]
    pub question: String,
    #[max_len(100)]
    pub creator_position: String,
    #[max_len(100)]
    pub counter_position: String,
    #[max_len(200)]
    pub resolution_url: String,
    #[max_len(32)]
    pub category: String,
    pub creator_stake: u64,
    pub total_challenger_stake: u64,
    pub deadline: i64,
    pub state: u8,
    pub winner_side: u8,
    /// Proposal summary while PROPOSED/DISPUTED, final summary once RESOLVED.
    #[max_len(300)]
    pub resolution_summary: String,
    pub confidence: u8,
    pub evidence_hash: [u8; 32],
    pub created_at: i64,
    pub max_challengers: u8,
    pub creator_paid: bool,
    #[max_len(16)]
    pub challengers: Vec<Challenger>,
    // ── Fee terms frozen at creation ─────────────────────────────────────
    pub creator_agent: Pubkey,
    pub fee_recipient: Pubkey,
    pub platform_fee_bps: u16,
    pub agent_fee_bps: u16,
    pub total_fees: u64,
    // ── Optimistic resolution (terms frozen at creation) ─────────────────
    pub dispute_window: i64,
    pub resolution_grace: i64,
    pub proposed_side: u8,
    pub proposed_at: i64,
    pub disputable_until: i64,
    pub disputer: Pubkey,
    pub disputed_at: i64,
    pub bond: u64,
    pub bond_state: u8,
    pub resolved_at: i64,
}

impl Claim {
    pub fn is_participant(&self, who: &Pubkey) -> bool {
        self.creator == *who || self.challengers.iter().any(|c| c.addr == *who)
    }
}
