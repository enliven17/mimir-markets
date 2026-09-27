//! Pull-based payouts after RESOLVED. Permissionless cranks: USDC always goes
//! to the participant's own token account. Fees are charged on profit only,
//! using the fee terms frozen on the claim at creation.

use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::constants::*;
use crate::errors::MimirError;
use crate::events::*;
use crate::math::{challenger_gross, creator_gross, split_fees, FeeSplit, FeeTerms};
use crate::state::*;
use crate::transfer_from_vault;

/// Book fees: the platform leg into the config pool, the agent leg into the
/// agent owner's FeeBalance (which must be passed when an agent fee is due).
fn accrue_fees(
    config: &mut Config,
    claim: &mut Claim,
    agent_fees: &mut Option<Account<FeeBalance>>,
    agent: &Pubkey,
    split: &FeeSplit,
) -> Result<()> {
    if split.platform_fee > 0 {
        config.fees_accrued = config.fees_accrued.checked_add(split.platform_fee).ok_or(MimirError::MathOverflow)?;
    }
    if split.agent_fee > 0 {
        let fa = agent_fees.as_mut().ok_or(MimirError::FeeAccountMissing)?;
        require_keys_eq!(fa.owner, *agent, MimirError::WrongFeeAccount);
        fa.amount = fa.amount.checked_add(split.agent_fee).ok_or(MimirError::MathOverflow)?;
        fa.lifetime = fa.lifetime.checked_add(split.agent_fee).ok_or(MimirError::MathOverflow)?;
    }
    let total = split.platform_fee + split.agent_fee;
    config.lifetime_fees_accrued = config.lifetime_fees_accrued.checked_add(total).ok_or(MimirError::MathOverflow)?;
    claim.total_fees = claim.total_fees.checked_add(total).ok_or(MimirError::MathOverflow)?;
    Ok(())
}

pub fn payout_creator(ctx: Context<PayoutCreator>) -> Result<()> {
    let claim = &mut ctx.accounts.claim;
    require!(claim.state == ST_RESOLVED, MimirError::NotResolved);
    require!(!claim.creator_paid, MimirError::AlreadyPaid);
    let (gross, principal) = creator_gross(claim.winner_side, claim.creator_stake, claim.total_challenger_stake)
        .ok_or(MimirError::NothingToPay)?;
    let agent = claim.creator_agent;
    let split = split_fees(
        gross,
        principal,
        &claim.creator,
        &FeeTerms {
            platform_fee_bps: claim.platform_fee_bps,
            agent_fee_bps: claim.agent_fee_bps,
            fee_recipient: &claim.fee_recipient,
            agent: &agent,
        },
    );
    claim.creator_paid = true;
    accrue_fees(&mut ctx.accounts.config, claim, &mut ctx.accounts.agent_fees, &agent, &split)?;
    transfer_from_vault(
        &ctx.accounts.token_program,
        &ctx.accounts.vault,
        &ctx.accounts.creator_token,
        ctx.accounts.config.vault_bump,
        split.net,
    )?;
    emit!(PayoutSent {
        id: claim.id,
        to: claim.creator,
        amount: split.net,
        platform_fee: split.platform_fee,
        agent_fee: split.agent_fee,
    });
    Ok(())
}

/// Pay out one challenger by index. Pool odds: stake + proportional share of
/// the creator stake, minus fees on the profit part.
pub fn payout_challenger(ctx: Context<PayoutChallenger>, index: u8) -> Result<()> {
    let claim = &mut ctx.accounts.claim;
    require!(claim.state == ST_RESOLVED, MimirError::NotResolved);
    let i = index as usize;
    require!(i < claim.challengers.len(), MimirError::BadIndex);
    require!(!claim.challengers[i].paid, MimirError::AlreadyPaid);
    let ch = claim.challengers[i].clone();
    require_keys_eq!(ch.addr, ctx.accounts.challenger_token.owner, MimirError::WrongRecipient);

    let (gross, principal) = challenger_gross(
        claim.winner_side,
        ch.stake,
        claim.creator_stake,
        claim.total_challenger_stake,
    )
    .ok_or(MimirError::NothingToPay)?;
    let split = split_fees(
        gross,
        principal,
        &ch.addr,
        &FeeTerms {
            platform_fee_bps: claim.platform_fee_bps,
            agent_fee_bps: claim.agent_fee_bps,
            fee_recipient: &claim.fee_recipient,
            agent: &ch.agent,
        },
    );
    claim.challengers[i].paid = true;
    accrue_fees(&mut ctx.accounts.config, claim, &mut ctx.accounts.agent_fees, &ch.agent, &split)?;
    transfer_from_vault(
        &ctx.accounts.token_program,
        &ctx.accounts.vault,
        &ctx.accounts.challenger_token,
        ctx.accounts.config.vault_bump,
        split.net,
    )?;
    emit!(PayoutSent {
        id: claim.id,
        to: ch.addr,
        amount: split.net,
        platform_fee: split.platform_fee,
        agent_fee: split.agent_fee,
    });
    Ok(())
}

// ── Contexts ──────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct PayoutCreator<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CLAIM_SEED, &claim.id.to_le_bytes()], bump = claim.bump)]
    pub claim: Account<'info, Claim>,
    #[account(
        mut,
        token::mint = config.usdc_mint,
        constraint = creator_token.owner == claim.creator @ MimirError::WrongRecipient
    )]
    pub creator_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    /// FeeBalance of claim.creator_agent. Required only when an agent fee is due.
    #[account(mut)]
    pub agent_fees: Option<Account<'info, FeeBalance>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct PayoutChallenger<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CLAIM_SEED, &claim.id.to_le_bytes()], bump = claim.bump)]
    pub claim: Account<'info, Claim>,
    #[account(mut, token::mint = config.usdc_mint)]
    pub challenger_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    /// FeeBalance of the challenger's agent. Required only when an agent fee is due.
    #[account(mut)]
    pub agent_fees: Option<Account<'info, FeeBalance>>,
    pub token_program: Program<'info, Token>,
}
