//! Claim lifecycle before settlement: create, cancel, challenge.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::MimirError;
use crate::events::*;
use crate::state::*;
use crate::transfer_from_vault;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct CreateClaimArgs {
    pub question: String,         // max 200
    pub creator_position: String, // max 100
    pub counter_position: String, // max 100
    pub resolution_url: String,   // max 200
    pub category: String,         // max 32
    pub stake_amount: u64,
    pub deadline: i64,
    pub max_challengers: u8,
    /// Owner of the agent that opened this position; earns agent_fee_bps of the creator's profit.
    pub agent: Option<Pubkey>,
}

/// Create a claim. Creator stake moves straight from the creator's token
/// account into the vault. The live fee policy and dispute/grace windows are
/// frozen onto the claim, so later governance changes never touch it.
pub fn create_claim(ctx: Context<CreateClaim>, args: CreateClaimArgs) -> Result<()> {
    require!(!ctx.accounts.config.paused, MimirError::Paused);
    require!(args.stake_amount >= MIN_STAKE, MimirError::StakeTooSmall);
    let now = Clock::get()?.unix_timestamp;
    require!(args.deadline > now, MimirError::DeadlineInPast);
    require!(!args.question.is_empty(), MimirError::EmptyQuestion);
    require!(
        args.question.len() <= MAX_QUESTION
            && args.creator_position.len() <= MAX_POSITION
            && args.counter_position.len() <= MAX_POSITION
            && args.resolution_url.len() <= MAX_URL
            && args.category.len() <= MAX_CATEGORY,
        MimirError::StringTooLong
    );

    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.creator_token.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
            },
        ),
        args.stake_amount,
    )?;

    let config = &mut ctx.accounts.config;
    config.claim_count += 1;

    let claim = &mut ctx.accounts.claim;
    claim.id = config.claim_count;
    claim.bump = ctx.bumps.claim;
    claim.creator = ctx.accounts.creator.key();
    claim.question = args.question;
    claim.creator_position = args.creator_position;
    claim.counter_position = args.counter_position;
    claim.resolution_url = args.resolution_url;
    claim.category = args.category;
    claim.creator_stake = args.stake_amount;
    claim.total_challenger_stake = 0;
    claim.deadline = args.deadline;
    claim.state = ST_OPEN;
    claim.winner_side = SIDE_NONE;
    claim.resolution_summary = String::new();
    claim.confidence = 0;
    claim.evidence_hash = [0u8; 32];
    claim.created_at = now;
    claim.max_challengers = if args.max_challengers == 0 || args.max_challengers > MAX_CHALLENGERS {
        MAX_CHALLENGERS
    } else {
        args.max_challengers
    };
    claim.creator_paid = false;
    claim.challengers = Vec::new();
    // Frozen terms
    claim.creator_agent = args.agent.unwrap_or_default();
    claim.fee_recipient = config.fee_recipient;
    claim.platform_fee_bps = config.platform_fee_bps;
    claim.agent_fee_bps = config.agent_fee_bps;
    claim.total_fees = 0;
    claim.dispute_window = config.dispute_window;
    claim.resolution_grace = config.resolution_grace;
    claim.proposed_side = SIDE_NONE;
    claim.proposed_at = 0;
    claim.disputable_until = 0;
    claim.disputer = Pubkey::default();
    claim.disputed_at = 0;
    claim.bond = 0;
    claim.bond_state = BOND_NONE;
    claim.resolved_at = 0;

    emit!(ClaimCreated {
        id: claim.id,
        creator: claim.creator,
        stake: claim.creator_stake,
        deadline: claim.deadline,
        agent: claim.creator_agent,
    });
    Ok(())
}

/// Cancel an OPEN claim (no challengers yet). Base layer only. Never paused.
pub fn cancel_claim(ctx: Context<CancelClaim>) -> Result<()> {
    let claim = &mut ctx.accounts.claim;
    require!(claim.state == ST_OPEN, MimirError::NotOpen);
    require!(claim.challengers.is_empty(), MimirError::HasChallengers);
    claim.state = ST_CANCELLED;
    let amount = claim.creator_stake;
    let id = claim.id;
    transfer_from_vault(
        &ctx.accounts.token_program,
        &ctx.accounts.vault,
        &ctx.accounts.creator_token,
        ctx.accounts.config.vault_bump,
        amount,
    )?;
    emit!(ClaimCancelled { id });
    Ok(())
}

/// Challenge a claim by staking from the virtual balance.
/// Designed to run inside the Ephemeral Rollup: the claim PDA and the
/// challenger's balance PDA are delegated (writable there); the config PDA
/// stays on the base layer and is read as a clone for the pause check.
/// Zero fee, ~30ms. Also works on the base layer pre-delegation.
pub fn challenge_claim(ctx: Context<ChallengeClaim>, stake_amount: u64, agent: Option<Pubkey>) -> Result<()> {
    require!(!ctx.accounts.config.paused, MimirError::Paused);
    let claim = &mut ctx.accounts.claim;
    let balance = &mut ctx.accounts.balance;
    let challenger = ctx.accounts.challenger.key();
    let now = Clock::get()?.unix_timestamp;

    require!(claim.state == ST_OPEN || claim.state == ST_ACTIVE, MimirError::NotOpen);
    require!(challenger != claim.creator, MimirError::SelfChallenge);
    require!(!claim.challengers.iter().any(|c| c.addr == challenger), MimirError::AlreadyChallenged);
    require!((claim.challengers.len() as u8) < claim.max_challengers, MimirError::ClaimFull);
    require!(stake_amount >= MIN_STAKE, MimirError::StakeTooSmall);
    require!(now + CHALLENGE_LOCK_SECONDS <= claim.deadline, MimirError::ChallengeWindowClosed);
    require!(balance.amount >= stake_amount, MimirError::InsufficientBalance);

    balance.amount -= stake_amount;
    claim.total_challenger_stake = claim
        .total_challenger_stake
        .checked_add(stake_amount)
        .ok_or(MimirError::MathOverflow)?;
    let agent = agent.unwrap_or_default();
    claim.challengers.push(Challenger { addr: challenger, stake: stake_amount, paid: false, agent });
    claim.state = ST_ACTIVE;
    emit!(ClaimChallenged { id: claim.id, challenger, stake: stake_amount, agent });
    Ok(())
}

// ── Contexts ──────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct CreateClaim<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = creator,
        space = 8 + Claim::INIT_SPACE,
        seeds = [CLAIM_SEED, &(config.claim_count + 1).to_le_bytes()],
        bump
    )]
    pub claim: Account<'info, Claim>,
    #[account(mut, token::mint = config.usdc_mint, token::authority = creator)]
    pub creator_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelClaim<'info> {
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [CLAIM_SEED, &claim.id.to_le_bytes()],
        bump = claim.bump,
        has_one = creator @ MimirError::NotCreator
    )]
    pub claim: Account<'info, Claim>,
    #[account(mut, token::mint = config.usdc_mint, token::authority = creator)]
    pub creator_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ChallengeClaim<'info> {
    pub challenger: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [CLAIM_SEED, &claim.id.to_le_bytes()], bump = claim.bump)]
    pub claim: Account<'info, Claim>,
    #[account(mut, seeds = [BALANCE_SEED, challenger.key().as_ref()], bump)]
    pub balance: Account<'info, UserBalance>,
}
