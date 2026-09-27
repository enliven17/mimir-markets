//! MagicBlock Ephemeral Rollup hooks. Claims and balances are delegated to the
//! ER for zero-fee challenges; the vault and every token account stay on the
//! base layer, so no USDC ever moves inside the ER.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};

use crate::constants::*;
use crate::errors::MimirError;
use crate::state::*;

/// Delegate a claim PDA into the Ephemeral Rollup. Only OPEN/ACTIVE claims:
/// a PROPOSED/DISPUTED/RESOLVED claim must stay on the base layer where
/// disputes, bonds and payouts happen.
pub fn delegate_claim(ctx: Context<DelegateClaim>, claim_id: u64) -> Result<()> {
    {
        let data = ctx.accounts.claim.try_borrow_data()?;
        let claim = Claim::try_deserialize(&mut &data[..])?;
        require!(claim.state == ST_OPEN || claim.state == ST_ACTIVE, MimirError::CannotDelegate);
    }
    ctx.accounts.delegate_claim(
        &ctx.accounts.payer,
        &[CLAIM_SEED, &claim_id.to_le_bytes()],
        DelegateConfig {
            validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
            ..Default::default()
        },
    )?;
    Ok(())
}

/// Delegate the caller's balance PDA into the Ephemeral Rollup so they can
/// challenge claims inside the ER.
pub fn delegate_balance(ctx: Context<DelegateBalance>) -> Result<()> {
    let payer_key = ctx.accounts.payer.key();
    ctx.accounts.delegate_balance(
        &ctx.accounts.payer,
        &[BALANCE_SEED, payer_key.as_ref()],
        DelegateConfig {
            validator: ctx.remaining_accounts.first().map(|acc| acc.key()),
            ..Default::default()
        },
    )?;
    Ok(())
}

/// Commit + undelegate a claim from the ER back to the base layer.
/// Permissionless: the oracle runs it at the deadline, and anyone can run it
/// so refund_expired is always reachable even if the oracle disappears.
pub fn undelegate_claim(ctx: Context<UndelegateClaim>) -> Result<()> {
    ctx.accounts.claim.exit(&crate::ID)?;
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.claim.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}

/// Commit + undelegate the caller's balance PDA (needed before withdraw).
pub fn undelegate_balance(ctx: Context<UndelegateBalance>) -> Result<()> {
    ctx.accounts.balance.exit(&crate::ID)?;
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.balance.to_account_info()])
    .build_and_invoke()?;
    Ok(())
}

// ── Contexts (the #[delegate] macro injects delegate_<field>()) ───────────

#[delegate]
#[derive(Accounts)]
#[instruction(claim_id: u64)]
pub struct DelegateClaim<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the claim PDA to delegate, validated by seeds; state checked in the handler
    #[account(mut, del, seeds = [CLAIM_SEED, &claim_id.to_le_bytes()], bump)]
    pub claim: AccountInfo<'info>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateBalance<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the caller's balance PDA, validated by seeds in delegate_balance()
    #[account(mut, del, seeds = [BALANCE_SEED, payer.key().as_ref()], bump)]
    pub balance: AccountInfo<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateClaim<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CLAIM_SEED, &claim.id.to_le_bytes()], bump = claim.bump)]
    pub claim: Account<'info, Claim>,
}

#[commit]
#[derive(Accounts)]
pub struct UndelegateBalance<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [BALANCE_SEED, payer.key().as_ref()], bump)]
    pub balance: Account<'info, UserBalance>,
}
