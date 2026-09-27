//! Pure settlement arithmetic, kept free of account types so it can be unit
//! tested on the host (`cargo test -p mimir`). Mirrors MimirV3 `_payWinner`
//! and lib/solana/fees.ts — any divergence between the three is a bug.

use anchor_lang::prelude::Pubkey;

use crate::constants::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct FeeSplit {
    pub platform_fee: u64,
    pub agent_fee: u64,
    pub net: u64,
}

pub struct FeeTerms<'a> {
    pub platform_fee_bps: u16,
    pub agent_fee_bps: u16,
    pub fee_recipient: &'a Pubkey,
    pub agent: &'a Pubkey,
}

/// Fees are charged on profit only (`gross - principal`, floored at zero), so
/// a refund and a break-even win are free and a winner never receives less
/// than their stake. Division rounds down, leaving the remainder with the
/// participant. A recipient who is also the winner waives that leg.
pub fn split_fees(gross: u64, principal: u64, winner: &Pubkey, terms: &FeeTerms) -> FeeSplit {
    let profit = gross.saturating_sub(principal) as u128;
    let mut platform_fee: u64 = 0;
    let mut agent_fee: u64 = 0;
    if profit > 0 {
        let none = Pubkey::default();
        if terms.platform_fee_bps > 0 && *terms.fee_recipient != none && terms.fee_recipient != winner {
            platform_fee = (profit * terms.platform_fee_bps as u128 / BPS_DENOMINATOR) as u64;
        }
        if terms.agent_fee_bps > 0 && *terms.agent != none && terms.agent != winner {
            agent_fee = (profit * terms.agent_fee_bps as u128 / BPS_DENOMINATOR) as u64;
        }
    }
    // Both legs are ≤ 10% of profit ≤ gross, so this cannot underflow.
    FeeSplit { platform_fee, agent_fee, net: gross - platform_fee - agent_fee }
}

/// Gross payout (before fees) and principal for the creator, or None if the
/// creator is owed nothing for this verdict.
pub fn creator_gross(winner_side: u8, creator_stake: u64, total_challenger_stake: u64) -> Option<(u64, u64)> {
    match winner_side {
        SIDE_CREATOR => Some((creator_stake.checked_add(total_challenger_stake)?, creator_stake)),
        SIDE_DRAW | SIDE_UNRESOLVABLE => Some((creator_stake, creator_stake)),
        _ => None,
    }
}

/// Pool odds: stake + proportional share of the creator stake (rounded down).
pub fn challenger_gross(
    winner_side: u8,
    stake: u64,
    creator_stake: u64,
    total_challenger_stake: u64,
) -> Option<(u64, u64)> {
    match winner_side {
        SIDE_CHALLENGERS => {
            if total_challenger_stake == 0 {
                return None;
            }
            let share = (stake as u128).checked_mul(creator_stake as u128)? / total_challenger_stake as u128;
            Some((stake.checked_add(share as u64)?, stake))
        }
        SIDE_DRAW | SIDE_UNRESOLVABLE => Some((stake, stake)),
        _ => None,
    }
}

pub fn validate_fee_policy(platform_fee_bps: u16, agent_fee_bps: u16, fee_recipient: &Pubkey) -> Result<(), crate::errors::MimirError> {
    if platform_fee_bps as u32 + agent_fee_bps as u32 > MAX_TOTAL_FEE_BPS as u32 {
        return Err(crate::errors::MimirError::FeeTooHigh);
    }
    if platform_fee_bps > 0 && *fee_recipient == Pubkey::default() {
        return Err(crate::errors::MimirError::NoFeeRecipient);
    }
    Ok(())
}

pub fn validate_windows(dispute_window: i64, resolution_grace: i64) -> Result<(), crate::errors::MimirError> {
    if !(0..=MAX_DISPUTE_WINDOW).contains(&dispute_window) {
        return Err(crate::errors::MimirError::DisputeWindowTooLong);
    }
    if !(MIN_RESOLUTION_GRACE..=MAX_RESOLUTION_GRACE).contains(&resolution_grace) {
        return Err(crate::errors::MimirError::GraceOutOfRange);
    }
    Ok(())
}

/// When a claim becomes refundable via refund_expired. A disputed claim the
/// arbiter never rules on gets the same escape hatch, counted from the dispute.
pub fn refundable_at(deadline: i64, disputed_at: i64, grace: i64, disputed: bool) -> i64 {
    let start = if disputed && disputed_at > deadline { disputed_at } else { deadline };
    start.saturating_add(grace)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    fn terms<'a>(p: u16, a: u16, rec: &'a Pubkey, agent: &'a Pubkey) -> FeeTerms<'a> {
        FeeTerms { platform_fee_bps: p, agent_fee_bps: a, fee_recipient: rec, agent }
    }

    #[test]
    fn fees_only_on_profit() {
        let (rec, agent, winner) = (pk(1), pk(2), pk(3));
        // stake 10, win 30 → profit 20 → 0.5% + 0.5% = 0.1 each
        let s = split_fees(30_000_000, 10_000_000, &winner, &terms(50, 50, &rec, &agent));
        assert_eq!(s.platform_fee, 100_000);
        assert_eq!(s.agent_fee, 100_000);
        assert_eq!(s.net, 29_800_000);
    }

    #[test]
    fn refund_and_break_even_are_free() {
        let (rec, agent, winner) = (pk(1), pk(2), pk(3));
        let t = terms(500, 500, &rec, &agent);
        assert_eq!(split_fees(10, 10, &winner, &t), FeeSplit { platform_fee: 0, agent_fee: 0, net: 10 });
        assert_eq!(split_fees(5, 10, &winner, &t).net, 5);
    }

    #[test]
    fn winner_never_loses_principal_at_cap() {
        let (rec, agent, winner) = (pk(1), pk(2), pk(3));
        let t = terms(900, 100, &rec, &agent);
        for (gross, principal) in [(11u64, 10u64), (2_000_001, 2_000_000), (u64::MAX / 2, 1)] {
            let s = split_fees(gross, principal, &winner, &t);
            assert!(s.net >= principal);
            assert_eq!(s.net + s.platform_fee + s.agent_fee, gross);
        }
    }

    #[test]
    fn self_legs_are_waived() {
        let winner = pk(3);
        let none = Pubkey::default();
        let s = split_fees(30, 10, &winner, &terms(1000, 0, &winner, &none));
        assert_eq!(s.platform_fee, 0);
        let s = split_fees(30_000, 10_000, &winner, &terms(0, 1000, &pk(1), &winner));
        assert_eq!(s.agent_fee, 0);
        // no recipient / no agent → no fee
        let s = split_fees(30_000, 10_000, &winner, &terms(1000, 0, &none, &none));
        assert_eq!(s.net, 30_000);
    }

    #[test]
    fn pool_payouts_never_exceed_pot() {
        let stakes = [3_000_000u64, 7_000_000, 2_500_000];
        let total: u64 = stakes.iter().sum();
        let creator = 11_000_000u64;
        let paid: u64 = stakes
            .iter()
            .map(|s| challenger_gross(SIDE_CHALLENGERS, *s, creator, total).unwrap().0)
            .sum();
        assert!(paid <= total + creator);
        assert!(total + creator - paid < stakes.len() as u64); // dust < 1 unit per challenger
        assert_eq!(creator_gross(SIDE_CREATOR, creator, total), Some((creator + total, creator)));
        assert_eq!(creator_gross(SIDE_CHALLENGERS, creator, total), None);
        assert_eq!(challenger_gross(SIDE_CREATOR, 1, 1, 1), None);
        assert_eq!(challenger_gross(SIDE_DRAW, 5, 9, 9), Some((5, 5)));
    }

    #[test]
    fn policy_and_window_bounds() {
        let rec = pk(1);
        assert!(validate_fee_policy(500, 500, &rec).is_ok());
        assert!(validate_fee_policy(900, 101, &rec).is_err());
        assert!(validate_fee_policy(50, 0, &Pubkey::default()).is_err());
        assert!(validate_fee_policy(0, 50, &Pubkey::default()).is_ok());
        assert!(validate_windows(0, MIN_RESOLUTION_GRACE).is_ok());
        assert!(validate_windows(MAX_DISPUTE_WINDOW + 1, DEFAULT_RESOLUTION_GRACE).is_err());
        assert!(validate_windows(86_400, 10).is_err());
    }

    #[test]
    fn refund_clock_counts_from_dispute() {
        assert_eq!(refundable_at(100, 0, 50, false), 150);
        assert_eq!(refundable_at(100, 400, 50, true), 450);
        assert_eq!(refundable_at(100, 400, 50, false), 150);
    }
}
