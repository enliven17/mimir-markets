//! Setup and governance: initialize, pause, two-step admin, timelocked oracle
//! rotation, dispute/grace windows, timelocked fee policy, fee withdrawal.

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::MimirError;
use crate::events::*;
use crate::math::{validate_fee_policy, validate_windows};
use crate::state::*;
use crate::transfer_from_vault;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitArgs {
    pub oracle: Pubkey,
    pub fee_recipient: Pubkey,
    pub platform_fee_bps: u16,
    pub agent_fee_bps: u16,
    pub dispute_window: i64,
    pub resolution_grace: i64,
}

pub fn initialize(ctx: Context<Initialize>, args: InitArgs) -> Result<()> {
    require_keys_neq!(args.oracle, Pubkey::default(), MimirError::ZeroKey);
    validate_fee_policy(args.platform_fee_bps, args.agent_fee_bps, &args.fee_recipient)?;
    validate_windows(args.dispute_window, args.resolution_grace)?;

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.pending_admin = Pubkey::default();
    config.oracle = args.oracle;
    config.pending_oracle = Pubkey::default();
    config.pending_oracle_eta = 0;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.claim_count = 0;
    config.total_resolved = 0;
    config.vault_bump = ctx.bumps.vault;
    config.paused = false;
    config.dispute_window = args.dispute_window;
    config.resolution_grace = args.resolution_grace;
    config.fee_recipient = args.fee_recipient;
    config.platform_fee_bps = args.platform_fee_bps;
    config.agent_fee_bps = args.agent_fee_bps;
    config.pending_fee_eta = 0;
    config.fees_accrued = 0;
    config.lifetime_fees_accrued = 0;
    config.lifetime_fees_claimed = 0;

    emit!(Initialized {
        admin: config.admin,
        oracle: config.oracle,
        usdc_mint: config.usdc_mint,
        fee_recipient: config.fee_recipient,
        platform_fee_bps: config.platform_fee_bps,
        agent_fee_bps: config.agent_fee_bps,
        dispute_window: config.dispute_window,
        resolution_grace: config.resolution_grace,
    });
    Ok(())
}

pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    emit!(PausedSet { paused });
    Ok(())
}

/// Step one of two: the new admin must accept, so a typo cannot brick admin.
pub fn propose_admin(ctx: Context<AdminOnly>, next: Pubkey) -> Result<()> {
    require_keys_neq!(next, Pubkey::default(), MimirError::ZeroKey);
    let config = &mut ctx.accounts.config;
    config.pending_admin = next;
    emit!(AdminTransferStarted { previous: config.admin, next });
    Ok(())
}

pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let signer = ctx.accounts.new_admin.key();
    require_keys_neq!(config.pending_admin, Pubkey::default(), MimirError::NotPendingAdmin);
    require_keys_eq!(config.pending_admin, signer, MimirError::NotPendingAdmin);
    emit!(AdminTransferred { previous: config.admin, next: signer });
    config.admin = signer;
    config.pending_admin = Pubkey::default();
    Ok(())
}

/// Queue a new oracle, installable after ORACLE_TIMELOCK_SECONDS, so a
/// compromised admin key cannot make itself the settler by surprise.
pub fn queue_oracle(ctx: Context<AdminOnly>, next: Pubkey) -> Result<()> {
    require_keys_neq!(next, Pubkey::default(), MimirError::ZeroKey);
    let eta = Clock::get()?.unix_timestamp + ORACLE_TIMELOCK_SECONDS;
    let config = &mut ctx.accounts.config;
    config.pending_oracle = next;
    config.pending_oracle_eta = eta;
    emit!(OracleChangeQueued { next, eta });
    Ok(())
}

pub fn cancel_oracle(ctx: Context<AdminOnly>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(config.pending_oracle_eta != 0, MimirError::NothingQueued);
    emit!(OracleChangeCancelled { next: config.pending_oracle });
    config.pending_oracle = Pubkey::default();
    config.pending_oracle_eta = 0;
    Ok(())
}

/// Permissionless once the timelock has elapsed.
pub fn execute_oracle(ctx: Context<Permissionless>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(config.pending_oracle_eta != 0, MimirError::NothingQueued);
    require!(Clock::get()?.unix_timestamp >= config.pending_oracle_eta, MimirError::Timelocked);
    emit!(OracleChanged { previous: config.oracle, next: config.pending_oracle });
    config.oracle = config.pending_oracle;
    config.pending_oracle = Pubkey::default();
    config.pending_oracle_eta = 0;
    Ok(())
}

/// Windows are snapshotted onto each claim at creation, so a change here only
/// applies to claims created afterwards, never to a market people are in.
pub fn set_windows(ctx: Context<AdminOnly>, dispute_window: i64, resolution_grace: i64) -> Result<()> {
    validate_windows(dispute_window, resolution_grace)?;
    let config = &mut ctx.accounts.config;
    config.dispute_window = dispute_window;
    config.resolution_grace = resolution_grace;
    emit!(WindowsUpdated { dispute_window, resolution_grace });
    Ok(())
}

pub fn queue_fee_policy(
    ctx: Context<AdminOnly>,
    platform_fee_bps: u16,
    agent_fee_bps: u16,
    fee_recipient: Pubkey,
) -> Result<()> {
    validate_fee_policy(platform_fee_bps, agent_fee_bps, &fee_recipient)?;
    let eta = Clock::get()?.unix_timestamp + FEE_TIMELOCK_SECONDS;
    let config = &mut ctx.accounts.config;
    config.pending_platform_fee_bps = platform_fee_bps;
    config.pending_agent_fee_bps = agent_fee_bps;
    config.pending_fee_recipient = fee_recipient;
    config.pending_fee_eta = eta;
    emit!(FeePolicyQueued { platform_fee_bps, agent_fee_bps, fee_recipient, eta });
    Ok(())
}

pub fn cancel_fee_policy(ctx: Context<AdminOnly>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(config.pending_fee_eta != 0, MimirError::NothingQueued);
    config.pending_fee_eta = 0;
    emit!(FeePolicyCancelled {});
    Ok(())
}

/// Permissionless once the timelock has elapsed: the admin cannot queue a
/// change, let people see it, and then quietly decline to apply it.
pub fn execute_fee_policy(ctx: Context<Permissionless>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    require!(config.pending_fee_eta != 0, MimirError::NothingQueued);
    require!(Clock::get()?.unix_timestamp >= config.pending_fee_eta, MimirError::Timelocked);
    config.platform_fee_bps = config.pending_platform_fee_bps;
    config.agent_fee_bps = config.pending_agent_fee_bps;
    config.fee_recipient = config.pending_fee_recipient;
    config.pending_fee_eta = 0;
    emit!(FeePolicyUpdated {
        platform_fee_bps: config.platform_fee_bps,
        agent_fee_bps: config.agent_fee_bps,
        fee_recipient: config.fee_recipient,
    });
    Ok(())
}

/// Move accrued platform fees (and forfeited dispute bonds) out of the vault
/// to a token account owned by the current fee recipient. Signed by the admin
/// or the fee recipient itself.
pub fn withdraw_fees(ctx: Context<WithdrawFees>, amount: u64) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let who = ctx.accounts.authority.key();
    require!(who == config.admin || who == config.fee_recipient, MimirError::NotFeeAuthority);
    require!(amount > 0 && amount <= config.fees_accrued, MimirError::NoFees);
    config.fees_accrued -= amount;
    config.lifetime_fees_claimed = config
        .lifetime_fees_claimed
        .checked_add(amount)
        .ok_or(MimirError::MathOverflow)?;
    let bump = config.vault_bump;
    transfer_from_vault(&ctx.accounts.token_program, &ctx.accounts.vault, &ctx.accounts.recipient_token, bump, amount)?;
    emit!(FeesWithdrawn { to: ctx.accounts.recipient_token.key(), amount });
    Ok(())
}

// ── Contexts ──────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = admin,
        seeds = [VAULT_SEED],
        bump,
        token::mint = usdc_mint,
        token::authority = vault
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump, has_one = admin @ MimirError::NotAdmin)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct Permissionless<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        token::mint = config.usdc_mint,
        constraint = recipient_token.owner == config.fee_recipient @ MimirError::WrongRecipient
    )]
    pub recipient_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
