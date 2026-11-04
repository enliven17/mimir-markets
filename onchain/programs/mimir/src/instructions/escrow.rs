//! USDC escrow: virtual balances (deposit / withdraw) and agent-owner fee
//! accounts. None of these are ever blocked by the pause switch.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::*;
use crate::errors::MimirError;
use crate::events::*;
use crate::state::*;
use crate::transfer_from_vault;

/// Deposit USDC into the vault; credits the caller's virtual balance.
/// The balance PDA is what gets delegated into the Ephemeral Rollup.
pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, MimirError::InvalidAmount);
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.user_token.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;
    let balance = &mut ctx.accounts.balance;
    balance.owner = ctx.accounts.user.key();
    balance.amount = balance.amount.checked_add(amount).ok_or(MimirError::MathOverflow)?;
    emit!(Deposited { user: balance.owner, amount });
    Ok(())
}

/// Withdraw free (unstaked) balance back to a token account.
/// Only possible while the balance PDA is NOT delegated. Never paused.
pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, MimirError::InvalidAmount);
    let balance = &mut ctx.accounts.balance;
    require!(balance.amount >= amount, MimirError::InsufficientBalance);
    balance.amount -= amount;
    transfer_from_vault(
        &ctx.accounts.token_program,
        &ctx.accounts.vault,
        &ctx.accounts.user_token,
        ctx.accounts.config.vault_bump,
        amount,
    )?;
    emit!(Withdrawn { user: ctx.accounts.user.key(), amount });
    Ok(())
}

/// Open the fee accrual PDA for an agent owner. Permissionless (the payer
/// covers rent), so a payout crank can always open it before paying out.
pub fn open_fee_account(ctx: Context<OpenFeeAccount>, owner: Pubkey) -> Result<()> {
    require_keys_neq!(owner, Pubkey::default(), MimirError::ZeroKey);
    let fees = &mut ctx.accounts.fee_balance;
    fees.owner = owner;
    fees.amount = 0;
    fees.lifetime = 0;
    fees.bump = ctx.bumps.fee_balance;
    Ok(())
}

/// Agent owner pulls its accrued fees to any USDC token account.
pub fn claim_agent_fees(ctx: Context<ClaimAgentFees>) -> Result<()> {
    let fees = &mut ctx.accounts.fee_balance;
    let amount = fees.amount;
    require!(amount > 0, MimirError::NoFees);
    fees.amount = 0;
    transfer_from_vault(
        &ctx.accounts.token_program,
        &ctx.accounts.vault,
        &ctx.accounts.to_token,
        ctx.accounts.config.vault_bump,
        amount,
    )?;
    emit!(AgentFeesClaimed { owner: fees.owner, to: ctx.accounts.to_token.key(), amount });
    Ok(())
}

// ── Contexts ──────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserBalance::INIT_SPACE,
        seeds = [BALANCE_SEED, user.key().as_ref()],
        bump
    )]
    pub balance: Account<'info, UserBalance>,
    #[account(mut, token::mint = config.usdc_mint, token::authority = user)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub user: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [BALANCE_SEED, user.key().as_ref()], bump, has_one = owner @ MimirError::WrongRecipient)]
    pub balance: Account<'info, UserBalance>,
    /// CHECK: constrained via has_one on balance (always == user, kept for client compatibility)
    pub owner: UncheckedAccount<'info>,
    #[account(mut, token::mint = config.usdc_mint)]
    pub user_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(owner: Pubkey)]
pub struct OpenFeeAccount<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + FeeBalance::INIT_SPACE,
        seeds = [FEE_SEED, owner.as_ref()],
        bump
    )]
    pub fee_balance: Account<'info, FeeBalance>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimAgentFees<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [FEE_SEED, owner.key().as_ref()], bump = fee_balance.bump, has_one = owner @ MimirError::WrongFeeAccount)]
    pub fee_balance: Account<'info, FeeBalance>,
    #[account(mut, token::mint = config.usdc_mint)]
    pub to_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [VAULT_SEED], bump = config.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
