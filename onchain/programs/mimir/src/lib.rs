//! Mimir: AI-settled claim market on Solana with MagicBlock Ephemeral Rollups.
//!
//! V3 parity (MimirV3.sol, adapted to Solana's account model):
//!   - optimistic resolution: oracle proposes → dispute window → finalize, or a
//!     bonded dispute decided by the admin (arbiter)
//!   - refund_expired escape hatch after deadline + grace
//!   - pause switch that stops new positions/proposals but never withdrawals,
//!     payouts, refunds or disputes
//!   - two-step admin transfer, timelocked oracle rotation
//!   - profit-only fees (platform + agent owner, ≤10% total), frozen per claim,
//!     timelocked policy changes, pull-based fee accrual
//!
//! Vault invariant (USDC held by the vault PDA):
//!   vault.amount ≥ Σ UserBalance.amount
//!               + Σ unpaid stakes of claims not yet paid out (OPEN..DISPUTED, and
//!                 RESOLVED legs whose payout crank has not run)
//!               + Σ dispute bonds HELD or REFUND_DUE
//!               + Config.fees_accrued
//!               + Σ FeeBalance.amount
//! Every instruction moves value between these buckets or in/out of the vault
//! by exactly the same amount; pool-share rounding can only leave dust behind.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

pub use constants::*;
pub use errors::MimirError;
pub use instructions::*;
pub use state::*;

declare_id!("EnLyMg9fBhgvKcWVAyD1YKv3i2BbLejfRFb5hEXur1WE");

#[ephemeral]
#[program]
pub mod mimir {
    use super::*;

    // ── Setup + governance (base layer) ───────────────────────────────────

    pub fn initialize(ctx: Context<Initialize>, args: InitArgs) -> Result<()> {
        admin::initialize(ctx, args)
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        admin::set_paused(ctx, paused)
    }

    pub fn propose_admin(ctx: Context<AdminOnly>, next: Pubkey) -> Result<()> {
        admin::propose_admin(ctx, next)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        admin::accept_admin(ctx)
    }

    pub fn queue_oracle(ctx: Context<AdminOnly>, next: Pubkey) -> Result<()> {
        admin::queue_oracle(ctx, next)
    }

    pub fn cancel_oracle(ctx: Context<AdminOnly>) -> Result<()> {
        admin::cancel_oracle(ctx)
    }

    pub fn execute_oracle(ctx: Context<Permissionless>) -> Result<()> {
        admin::execute_oracle(ctx)
    }

    pub fn set_windows(ctx: Context<AdminOnly>, dispute_window: i64, resolution_grace: i64) -> Result<()> {
        admin::set_windows(ctx, dispute_window, resolution_grace)
    }

    pub fn queue_fee_policy(
        ctx: Context<AdminOnly>,
        platform_fee_bps: u16,
        agent_fee_bps: u16,
        fee_recipient: Pubkey,
    ) -> Result<()> {
        admin::queue_fee_policy(ctx, platform_fee_bps, agent_fee_bps, fee_recipient)
    }

    pub fn cancel_fee_policy(ctx: Context<AdminOnly>) -> Result<()> {
        admin::cancel_fee_policy(ctx)
    }

    pub fn execute_fee_policy(ctx: Context<Permissionless>) -> Result<()> {
        admin::execute_fee_policy(ctx)
    }

    pub fn withdraw_fees(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
        admin::withdraw_fees(ctx, amount)
    }

    // ── Escrow (base layer, never paused) ─────────────────────────────────

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        escrow::deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        escrow::withdraw(ctx, amount)
    }

    pub fn open_fee_account(ctx: Context<OpenFeeAccount>, owner: Pubkey) -> Result<()> {
        escrow::open_fee_account(ctx, owner)
    }

    pub fn claim_agent_fees(ctx: Context<ClaimAgentFees>) -> Result<()> {
        escrow::claim_agent_fees(ctx)
    }

    // ── Claim lifecycle ───────────────────────────────────────────────────

    pub fn create_claim(ctx: Context<CreateClaim>, args: CreateClaimArgs) -> Result<()> {
        claim::create_claim(ctx, args)
    }

    pub fn cancel_claim(ctx: Context<CancelClaim>) -> Result<()> {
        claim::cancel_claim(ctx)
    }

    /// Works on BOTH layers (zero-fee inside the ER).
    pub fn challenge_claim(ctx: Context<ChallengeClaim>, stake_amount: u64, agent: Option<Pubkey>) -> Result<()> {
        claim::challenge_claim(ctx, stake_amount, agent)
    }

    // ── Optimistic resolution (base layer, post-undelegation) ─────────────

    pub fn propose_resolution(
        ctx: Context<ProposeResolution>,
        winner_side: u8,
        summary: String,
        confidence: u8,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        resolution::propose_resolution(ctx, winner_side, summary, confidence, evidence_hash)
    }

    pub fn dispute_resolution(ctx: Context<DisputeResolution>) -> Result<()> {
        resolution::dispute_resolution(ctx)
    }

    pub fn finalize_resolution(ctx: Context<FinalizeResolution>) -> Result<()> {
        resolution::finalize_resolution(ctx)
    }

    pub fn settle_dispute(
        ctx: Context<SettleDispute>,
        winner_side: u8,
        summary: String,
        confidence: u8,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        resolution::settle_dispute(ctx, winner_side, summary, confidence, evidence_hash)
    }

    pub fn refund_expired(ctx: Context<RefundExpired>) -> Result<()> {
        resolution::refund_expired(ctx)
    }

    pub fn refund_bond(ctx: Context<RefundBond>) -> Result<()> {
        resolution::refund_bond(ctx)
    }

    // ── Payouts (base layer, permissionless cranks) ───────────────────────

    pub fn payout_creator(ctx: Context<PayoutCreator>) -> Result<()> {
        payout::payout_creator(ctx)
    }

    pub fn payout_challenger(ctx: Context<PayoutChallenger>, index: u8) -> Result<()> {
        payout::payout_challenger(ctx, index)
    }

    // ── MagicBlock ER: delegation hooks ───────────────────────────────────

    pub fn delegate_claim(ctx: Context<DelegateClaim>, claim_id: u64) -> Result<()> {
        delegation::delegate_claim(ctx, claim_id)
    }

    pub fn delegate_balance(ctx: Context<DelegateBalance>) -> Result<()> {
        delegation::delegate_balance(ctx)
    }

    pub fn undelegate_claim(ctx: Context<UndelegateClaim>) -> Result<()> {
        delegation::undelegate_claim(ctx)
    }

    pub fn undelegate_balance(ctx: Context<UndelegateBalance>) -> Result<()> {
        delegation::undelegate_balance(ctx)
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

pub(crate) fn transfer_from_vault<'info>(
    token_program: &Program<'info, Token>,
    vault: &Account<'info, TokenAccount>,
    to: &Account<'info, TokenAccount>,
    vault_bump: u8,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let seeds: &[&[u8]] = &[VAULT_SEED, &[vault_bump]];
    token::transfer(
        CpiContext::new_with_signer(
            token_program.key(),
            Transfer {
                from: vault.to_account_info(),
                to: to.to_account_info(),
                authority: vault.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )
}
