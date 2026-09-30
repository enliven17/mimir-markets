//! Optimistic resolution (MimirV3 parity):
//!   ACTIVE ──propose──▶ PROPOSED ──finalize (after window)──▶ RESOLVED
//!                          │
//!                          └─dispute (bond)──▶ DISPUTED ──settle_dispute (admin)──▶ RESOLVED
//!   OPEN/ACTIVE/DISPUTED ──refund_expired (after grace)──▶ RESOLVED (UNRESOLVABLE)
//! All of these run on the base layer against an undelegated claim.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::MimirError;
use crate::events::*;
use crate::math::refundable_at;
use crate::state::*;
use crate::transfer_from_vault;

fn is_verdict(side: u8) -> bool {
    (SIDE_CREATOR..=SIDE_UNRESOLVABLE).contains(&side)
}

fn settle(
    config: &mut Config,
    claim: &mut Claim,
    winner_side: u8,
    summary: String,
    confidence: u8,
    evidence_hash: [u8; 32],
    now: i64,
) {
    claim.state = ST_RESOLVED;
    claim.winner_side = winner_side;
    claim.resolution_summary = summary;
    claim.confidence = confidence;
    claim.evidence_hash = evidence_hash;
    claim.resolved_at = now;
    config.total_resolved += 1;
    emit!(ClaimResolved { id: claim.id, winner_side, confidence, evidence_hash });
}

/// Oracle proposes a verdict. With a zero dispute window (snapshotted on the
/// claim) it settles immediately (V3's `disputeWindow == 0` fast path).
pub fn propose_resolution(
    ctx: Context<ProposeResolution>,
    winner_side: u8,
    summary: String,
    confidence: u8,
    evidence_hash: [u8; 32],
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(!config.paused, MimirError::Paused);
    let claim = &mut ctx.accounts.claim;
    require!(claim.state == ST_ACTIVE, MimirError::NotActive);
    let now = Clock::get()?.unix_timestamp;
    require!(now >= claim.deadline, MimirError::NotYetExpired);
    require!(is_verdict(winner_side), MimirError::InvalidVerdict);
    require!(summary.len() <= MAX_SUMMARY, MimirError::SummaryTooLong);

    if claim.dispute_window == 0 {
        settle(config, claim, winner_side, summary, confidence, evidence_hash, now);
        return Ok(());
    }
    claim.state = ST_PROPOSED;
    claim.proposed_side = winner_side;
    claim.proposed_at = now;
    claim.disputable_until = now + claim.dispute_window;
    claim.resolution_summary = summary;
    claim.confidence = confidence;
    claim.evidence_hash = evidence_hash;
    emit!(ResolutionProposed {
        id: claim.id,
        winner_side,
        confidence,
        evidence_hash,
        disputable_until: claim.disputable_until,
    });
    Ok(())
}

/// A participant (creator or challenger) escalates a proposed verdict to the
/// arbiter by posting DISPUTE_BOND from their USDC token account. The bond is
/// taken from the token account, not the virtual balance, because balances
/// usually live delegated in the ER while disputes run on the base layer.
/// Never paused: a pause must not be able to force a wrong verdict through.
pub fn dispute_resolution(ctx: Context<DisputeResolution>) -> Result<()> {
    let claim = &mut ctx.accounts.claim;
    let disputer = ctx.accounts.disputer.key();
    require!(claim.state == ST_PROPOSED, MimirError::NotProposed);
    let now = Clock::get()?.unix_timestamp;
    require!(now < claim.disputable_until, MimirError::DisputeWindowClosed);
    require!(claim.is_participant(&disputer), MimirError::NotParticipant);

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.disputer_token.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.disputer.to_account_info(),
            },
        ),
        DISPUTE_BOND,
    )?;
    claim.state = ST_DISPUTED;
    claim.disputer = disputer;
    claim.disputed_at = now;
    claim.bond = DISPUTE_BOND;
    claim.bond_state = BOND_HELD;
    emit!(ResolutionDisputed { id: claim.id, disputer, bond: DISPUTE_BOND });
    Ok(())
}

/// Anyone can settle an undisputed proposal once its window has closed.
pub fn finalize_resolution(ctx: Context<FinalizeResolution>) -> Result<()> {
    let claim = &mut ctx.accounts.claim;
    require!(claim.state == ST_PROPOSED, MimirError::NotProposed);
    let now = Clock::get()?.unix_timestamp;
    require!(now >= claim.disputable_until, MimirError::DisputeWindowOpen);
    let side = claim.proposed_side;
    let summary = claim.resolution_summary.clone();
    let (confidence, evidence) = (claim.confidence, claim.evidence_hash);
    settle(&mut ctx.accounts.config, claim, side, summary, confidence, evidence, now);
    Ok(())
}

/// The arbiter's (admin's) final word on a disputed claim. The bond comes back
/// (pull via refund_bond) if the verdict changed, or when there is no platform
/// recipient; otherwise it is forfeited to the platform fee pool.
pub fn settle_dispute(
    ctx: Context<SettleDispute>,
    winner_side: u8,
    summary: String,
    confidence: u8,
    evidence_hash: [u8; 32],
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let claim = &mut ctx.accounts.claim;
    require!(claim.state == ST_DISPUTED, MimirError::NotDisputed);
    require!(is_verdict(winner_side), MimirError::InvalidVerdict);
    require!(summary.len() <= MAX_SUMMARY, MimirError::SummaryTooLong);

    let disputer_right = winner_side != claim.proposed_side;
    if disputer_right || claim.fee_recipient == Pubkey::default() {
        claim.bond_state = BOND_REFUND_DUE;
    } else {
        claim.bond_state = BOND_FORFEITED;
        config.fees_accrued = config.fees_accrued.checked_add(claim.bond).ok_or(MimirError::MathOverflow)?;
        config.lifetime_fees_accrued =
            config.lifetime_fees_accrued.checked_add(claim.bond).ok_or(MimirError::MathOverflow)?;
    }
    emit!(DisputeSettled { id: claim.id, winner_side, disputer_right });
    let now = Clock::get()?.unix_timestamp;
    settle(config, claim, winner_side, summary, confidence, evidence_hash, now);
    Ok(())
}

/// Escape hatch. If an OPEN/ACTIVE claim is still unresolved `resolution_grace`
/// seconds after its deadline (or a DISPUTED one that long after the dispute),
/// anyone can refund it: it settles as UNRESOLVABLE, every stake comes back via
/// the normal payout cranks, no fee is taken, and any dispute bond is returned.
/// A PROPOSED claim needs no hatch: finalize_resolution is permissionless.
pub fn refund_expired(ctx: Context<RefundExpired>) -> Result<()> {
    let claim = &mut ctx.accounts.claim;
    let disputed = claim.state == ST_DISPUTED;
    require!(
        disputed || claim.state == ST_ACTIVE || claim.state == ST_OPEN,
        MimirError::NotActive
    );
    let now = Clock::get()?.unix_timestamp;
    let at = refundable_at(claim.deadline, claim.disputed_at, claim.resolution_grace, disputed);
    require!(now >= at, MimirError::GraceNotOver);
    if disputed {
        claim.bond_state = BOND_REFUND_DUE;
    }
    emit!(ClaimExpiredRefund { id: claim.id, caller: ctx.accounts.caller.key() });
    settle(
        &mut ctx.accounts.config,
        claim,
        SIDE_UNRESOLVABLE,
        REFUND_SUMMARY.to_string(),
        0,
        [0u8; 32],
        now,
    );
    Ok(())
}

/// Pull a returned dispute bond to the disputer's token account. Permissionless crank.
pub fn refund_bond(ctx: Context<RefundBond>) -> Result<()> {
    let claim = &mut ctx.accounts.claim;
    require!(claim.bond_state == BOND_REFUND_DUE, MimirError::NoBondDue);
    let amount = claim.bond;
    claim.bond_state = BOND_REFUNDED;
    transfer_from_vault(
        &ctx.accounts.token_program,
        &ctx.accounts.vault,
        &ctx.accounts.disputer_token,
        ctx.accounts.config.vault_bump,
        amount,
    )?;
    emit!(BondRefunded { id: claim.id, to: claim.disputer, amount });
    Ok(())
}

// ── Contexts ──────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct ProposeResolution<'info> {
    pub oracle: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump, has_one = oracle @ MimirError::NotOracle)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CLAIM_SEED, &claim.id.to_le_bytes()], bump = claim.bump)]
    pub claim: Account<'info, Claim>,
}

#[derive(Accounts)]
pub struct DisputeResolution<'info> {
    pub disputer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CLAIM_SEED, &claim.id.to_le_bytes()], bump = claim.bump)]
    pub claim: Account<'info, Claim>,
    #[account(mut, token::mint = config.usdc_mint, token::authority = disputer)]
    pub disputer_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct FinalizeResolution<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CLAIM_SEED, &claim.id.to_le_bytes()], bump = claim.bump)]
    pub claim: Account<'info, Claim>,
}

#[derive(Accounts)]
pub struct SettleDispute<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump, has_one = admin @ MimirError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CLAIM_SEED, &claim.id.to_le_bytes()], bump = claim.bump)]
    pub claim: Account<'info, Claim>,
}

#[derive(Accounts)]
pub struct RefundExpired<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CLAIM_SEED, &claim.id.to_le_bytes()], bump = claim.bump)]
    pub claim: Account<'info, Claim>,
}

#[derive(Accounts)]
pub struct RefundBond<'info> {
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CLAIM_SEED, &claim.id.to_le_bytes()], bump = claim.bump)]
    pub claim: Account<'info, Claim>,
    #[account(
        mut,
        token::mint = config.usdc_mint,
        constraint = disputer_token.owner == claim.disputer @ MimirError::WrongRecipient
    )]
    pub disputer_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
