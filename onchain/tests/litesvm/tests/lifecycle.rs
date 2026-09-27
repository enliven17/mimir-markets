//! End-to-end program behaviour in LiteSVM: optimistic resolution, disputes,
//! refund_expired, pause, governance timelocks, profit-only fees, and the
//! vault invariant after every settlement path.

mod common;
use common::*;
use solana_address::Address;
use solana_keypair::Keypair;
use solana_signer::Signer;

const ST_OPEN: u8 = 0;
const ST_ACTIVE: u8 = 1;
const ST_RESOLVED: u8 = 2;
const ST_PROPOSED: u8 = 4;
const ST_DISPUTED: u8 = 5;
const SIDE_CREATOR: u8 = 1;
const SIDE_CHALLENGERS: u8 = 2;
const SIDE_UNRESOLVABLE: u8 = 4;
const BOND_REFUND_DUE: u8 = 2;
const BOND_REFUNDED: u8 = 3;
const BOND_FORFEITED: u8 = 4;

fn setup() -> Env {
    let mut env = Env::new();
    env.initialize(50, 50, DAY, 7 * DAY);
    env
}

fn assert_invariant(env: &Env, users: &[&Keypair], claims: &[u64], agents: &[&Address]) {
    let keys: Vec<Address> = users.iter().map(|k| k.pubkey()).collect();
    let refs: Vec<&Address> = keys.iter().collect();
    let owed = env.liabilities(&refs, claims, agents);
    assert!(env.vault() >= owed, "vault {} < liabilities {}", env.vault(), owed);
    assert!(env.vault() - owed < 10, "unexplained vault surplus {}", env.vault() - owed);
}

#[test]
fn initialize_snapshots_policy() {
    let env = setup();
    let c = env.config();
    assert_eq!(c.platform_fee_bps, 50);
    assert_eq!(c.agent_fee_bps, 50);
    assert_eq!(c.dispute_window, DAY);
    assert_eq!(c.resolution_grace, 7 * DAY);
    assert!(!c.paused);
}

#[test]
fn initialize_rejects_bad_policy() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let bad = InitArgs {
        oracle: env.oracle.pubkey().to_bytes(),
        fee_recipient: env.treasury.pubkey().to_bytes(),
        platform_fee_bps: 900,
        agent_fee_bps: 101,
        dispute_window: DAY,
        resolution_grace: 7 * DAY,
    };
    let i = ix(
        "initialize",
        bad,
        vec![ws(admin.pubkey()), w(config_pda()), r(env.mint), w(vault_pda()), r(TOKEN_PROGRAM), r(SYSTEM_PROGRAM)],
    );
    env.fails(&[i], &[&admin], "FeeTooHigh");
    let zero_oracle = InitArgs {
        oracle: [0; 32],
        fee_recipient: env.treasury.pubkey().to_bytes(),
        platform_fee_bps: 0,
        agent_fee_bps: 0,
        dispute_window: 8 * DAY,
        resolution_grace: 7 * DAY,
    };
    let i = ix(
        "initialize",
        zero_oracle,
        vec![ws(admin.pubkey()), w(config_pda()), r(env.mint), w(vault_pda()), r(TOKEN_PROGRAM), r(SYSTEM_PROGRAM)],
    );
    env.fails(&[i], &[&admin], "ZeroKey");
}

#[test]
fn propose_then_finalize_charges_profit_only_fees() {
    let mut env = setup();
    let creator = env.user(100 * USDC);
    let ch1 = env.bettor(50 * USDC);
    let ch2 = env.bettor(50 * USDC);
    let agent = Address::new_unique();
    env.token_account(&agent, 0);
    // creator 10 via an agent; challengers 30 + 10 (pool odds)
    let id = env.claim_with(&creator, 10 * USDC, &[(&ch1, 30 * USDC), (&ch2, 10 * USDC)], None);
    assert_eq!(env.claim(id).state, ST_ACTIVE);

    let oracle = env.oracle.insecure_clone();
    let p = env.propose_ix(id, SIDE_CHALLENGERS, &oracle.pubkey());
    env.fails(&[p.clone()], &[&oracle], "NotYetExpired");
    env.warp(3_600);
    let stranger = env.user(0);
    let bad = env.propose_ix(id, SIDE_CHALLENGERS, &stranger.pubkey());
    env.fails(&[bad], &[&stranger], "NotOracle");
    env.ok(&[p], &[&oracle]);
    let c = env.claim(id);
    assert_eq!(c.state, ST_PROPOSED);
    assert_eq!(c.winner_side, 0, "winner is not final while proposed");
    assert_eq!(c.disputable_until, env.now() + DAY);

    // Payouts wait for finality; finalize waits for the window.
    let pay = env.payout_challenger_ix(id, 0, None);
    env.fails(&[pay], &[&stranger], "NotResolved");
    let f = env.finalize_ix(id);
    env.fails(&[f.clone()], &[&stranger], "DisputeWindowOpen");
    env.warp(DAY);
    env.ok(&[f], &[&stranger]); // permissionless
    let c = env.claim(id);
    assert_eq!((c.state, c.winner_side), (ST_RESOLVED, SIDE_CHALLENGERS));

    // ch1: gross 30 + 7.5 = 37.5, profit 7.5 → platform fee 0.5% = 0.0375
    let i = env.payout_challenger_ix(id, 0, None);
    env.ok(&[i], &[&stranger]);
    assert_eq!(env.usdc_of(&ch1.pubkey()), 37_500_000 - 37_500);
    let i = env.payout_challenger_ix(id, 1, None);
    env.ok(&[i], &[&stranger]);
    assert_eq!(env.usdc_of(&ch2.pubkey()), 12_500_000 - 12_500);
    let i = env.payout_challenger_ix(id, 1, None);
    env.fails(&[i], &[&stranger], "AlreadyPaid");
    let i = env.payout_creator_ix(id, None);
    env.fails(&[i], &[&stranger], "NothingToPay");
    assert_eq!(env.config().fees_accrued, 50_000);
    assert_invariant(&env, &[&creator, &ch1, &ch2], &[id], &[]);

    // Treasury withdrawal: only admin/fee recipient, only what accrued.
    let i = env.withdraw_fees_ix(&stranger.pubkey(), 1);
    env.fails(&[i], &[&stranger], "NotFeeAuthority");
    let admin = env.admin.insecure_clone();
    let i = env.withdraw_fees_ix(&admin.pubkey(), 50_001);
    env.fails(&[i], &[&admin], "NoFees");
    let i = env.withdraw_fees_ix(&admin.pubkey(), 50_000);
    env.ok(&[i], &[&admin]);
    assert_eq!(env.usdc_of(&env.treasury.pubkey()), 50_000);
    assert_eq!(env.config().fees_accrued, 0);
    assert_invariant(&env, &[&creator, &ch1, &ch2], &[id], &[]);
}

#[test]
fn agent_owner_fee_accrues_and_is_pulled() {
    let mut env = setup();
    let creator = env.user(100 * USDC);
    let ch = env.bettor(20 * USDC);
    let agent = Keypair::new();
    env.svm.airdrop(&agent.pubkey(), 1_000_000_000).unwrap();
    env.token_account(&agent.pubkey(), 0);
    let id = env.claim_with(&creator, 10 * USDC, &[(&ch, 20 * USDC)], Some(agent.pubkey()));
    let oracle = env.oracle.insecure_clone();
    env.warp(3_600);
    let p = env.propose_ix(id, SIDE_CREATOR, &oracle.pubkey());
    env.ok(&[p], &[&oracle]);
    env.warp(DAY);
    let f = env.finalize_ix(id);
    env.ok(&[f], &[&oracle]);

    // The agent fee is due, so the crank must pass the agent's FeeBalance.
    let i = env.payout_creator_ix(id, None);
    env.fails(&[i], &[&oracle], "FeeAccountMissing");
    let i = env.open_fee_ix(&oracle.pubkey(), &agent.pubkey());
    env.ok(&[i], &[&oracle]);
    let i = env.payout_creator_ix(id, Some(agent.pubkey()));
    env.ok(&[i], &[&oracle]);
    // gross 30, profit 20 → 0.1 platform + 0.1 agent
    assert_eq!(env.usdc_of(&creator.pubkey()), 90 * USDC + 30 * USDC - 200_000);
    assert_eq!(env.fee_balance(&agent.pubkey()).amount, 100_000);
    assert_eq!(env.claim(id).total_fees, 200_000);
    assert_invariant(&env, &[&creator, &ch], &[id], &[&agent.pubkey()]);

    let i = env.claim_agent_fees_ix(&agent.pubkey());
    env.ok(&[i.clone()], &[&agent]);
    assert_eq!(env.usdc_of(&agent.pubkey()), 100_000);
    env.fails(&[i], &[&agent], "NoFees");
    assert_invariant(&env, &[&creator, &ch], &[id], &[&agent.pubkey()]);
}

#[test]
fn dispute_upheld_forfeits_bond_to_treasury() {
    let mut env = setup();
    let creator = env.user(100 * USDC);
    let ch = env.user(10 * USDC); // holds USDC in its token account for the bond
    let i = env.deposit_ix(&ch.pubkey(), 5 * USDC);
    env.ok(&[i], &[&ch]);
    let id = env.claim_with(&creator, 5 * USDC, &[(&ch, 5 * USDC)], None);
    let (oracle, admin) = (env.oracle.insecure_clone(), env.admin.insecure_clone());
    env.warp(3_600);
    let p = env.propose_ix(id, SIDE_CREATOR, &oracle.pubkey());
    env.ok(&[p], &[&oracle]);

    let outsider = env.user(10 * USDC);
    let d = env.dispute_ix(id, &outsider.pubkey());
    env.fails(&[d], &[&outsider], "NotParticipant");
    let d = env.dispute_ix(id, &ch.pubkey());
    env.ok(&[d], &[&ch]);
    let c = env.claim(id);
    assert_eq!((c.state, c.bond), (ST_DISPUTED, 2 * USDC));
    assert_eq!(env.usdc_of(&ch.pubkey()), 3 * USDC);
    assert_invariant(&env, &[&creator, &ch], &[id], &[]);

    // A disputed claim cannot be finalized, and only the admin arbitrates.
    env.warp(2 * DAY);
    let f = env.finalize_ix(id);
    env.fails(&[f], &[&oracle], "NotProposed");
    let s = env.settle_ix(id, SIDE_CREATOR, &oracle.pubkey());
    env.fails(&[s], &[&oracle], "NotAdmin");
    let s = env.settle_ix(id, SIDE_CREATOR, &admin.pubkey());
    env.ok(&[s], &[&admin]);
    let c = env.claim(id);
    assert_eq!((c.state, c.winner_side, c.bond_state), (ST_RESOLVED, SIDE_CREATOR, BOND_FORFEITED));
    assert_eq!(env.config().fees_accrued, 2 * USDC);
    let rb = env.refund_bond_ix(id, &ch.pubkey());
    env.fails(&[rb], &[&admin], "NoBondDue");
    let i = env.payout_creator_ix(id, None);
    env.ok(&[i], &[&admin]);
    assert_invariant(&env, &[&creator, &ch], &[id], &[]);
}

#[test]
fn dispute_overturned_returns_bond() {
    let mut env = setup();
    let creator = env.user(100 * USDC);
    let ch = env.user(10 * USDC);
    let i = env.deposit_ix(&ch.pubkey(), 5 * USDC);
    env.ok(&[i], &[&ch]);
    let id = env.claim_with(&creator, 5 * USDC, &[(&ch, 5 * USDC)], None);
    let (oracle, admin) = (env.oracle.insecure_clone(), env.admin.insecure_clone());
    env.warp(3_600);
    let p = env.propose_ix(id, SIDE_CREATOR, &oracle.pubkey());
    env.ok(&[p], &[&oracle]);
    let d = env.dispute_ix(id, &ch.pubkey());
    env.ok(&[d], &[&ch]);
    let s = env.settle_ix(id, SIDE_CHALLENGERS, &admin.pubkey());
    env.ok(&[s], &[&admin]);
    let c = env.claim(id);
    assert_eq!((c.winner_side, c.bond_state), (SIDE_CHALLENGERS, BOND_REFUND_DUE));
    assert_eq!(c.resolution_summary, "Arbiter ruling");
    let rb = env.refund_bond_ix(id, &ch.pubkey());
    env.ok(&[rb.clone()], &[&admin]);
    assert_eq!(env.claim(id).bond_state, BOND_REFUNDED);
    env.fails(&[rb], &[&admin], "NoBondDue");
    let i = env.payout_challenger_ix(id, 0, None);
    env.ok(&[i], &[&admin]);
    // 5 bond-left + 2 bond back + 10 gross - 0.5% of 5 profit
    assert_eq!(env.usdc_of(&ch.pubkey()), 3 * USDC + 2 * USDC + 10 * USDC - 25_000);
    assert_invariant(&env, &[&creator, &ch], &[id], &[]);
}

#[test]
fn dispute_after_window_is_rejected() {
    let mut env = setup();
    let creator = env.user(100 * USDC);
    let id = env.claim_with(&creator, 5 * USDC, &[], None);
    let ch = env.bettor(5 * USDC);
    let i = env.challenge_ix(id, &ch.pubkey(), 5 * USDC, None);
    env.ok(&[i], &[&ch]);
    env.token_account(&ch.pubkey(), 10 * USDC);
    let oracle = env.oracle.insecure_clone();
    env.warp(3_600);
    let p = env.propose_ix(id, SIDE_CREATOR, &oracle.pubkey());
    env.ok(&[p], &[&oracle]);
    env.warp(DAY);
    let d = env.dispute_ix(id, &ch.pubkey());
    env.fails(&[d], &[&ch], "DisputeWindowClosed");
}

#[test]
fn refund_expired_after_grace() {
    let mut env = setup();
    let creator = env.user(100 * USDC);
    let ch = env.bettor(5 * USDC);
    let id = env.claim_with(&creator, 5 * USDC, &[(&ch, 5 * USDC)], None);
    let stranger = env.user(0);
    env.warp(3_600 + 7 * DAY - 10);
    let rf = env.refund_expired_ix(id, &stranger.pubkey());
    env.fails(&[rf.clone()], &[&stranger], "GraceNotOver");
    env.warp(10);
    env.ok(&[rf.clone()], &[&stranger]);
    let c = env.claim(id);
    assert_eq!((c.state, c.winner_side), (ST_RESOLVED, SIDE_UNRESOLVABLE));
    env.fails(&[rf], &[&stranger], "NotActive");
    // Refunds are free and exact.
    let i = env.payout_creator_ix(id, None);
    env.ok(&[i], &[&stranger]);
    let i = env.payout_challenger_ix(id, 0, None);
    env.ok(&[i], &[&stranger]);
    assert_eq!(env.usdc_of(&creator.pubkey()), 100 * USDC);
    assert_eq!(env.usdc_of(&ch.pubkey()), 5 * USDC);
    assert_eq!(env.config().fees_accrued, 0);
    assert_invariant(&env, &[&creator, &ch], &[id], &[]);
}

#[test]
fn refund_expired_open_claim_and_disputed_claim() {
    let mut env = setup();
    let creator = env.user(100 * USDC);
    let open_id = env.claim_with(&creator, 5 * USDC, &[], None);
    assert_eq!(env.claim(open_id).state, ST_OPEN);

    let ch = env.user(10 * USDC);
    let i = env.deposit_ix(&ch.pubkey(), 5 * USDC);
    env.ok(&[i], &[&ch]);
    let id = env.claim_with(&creator, 5 * USDC, &[(&ch, 5 * USDC)], None);
    let oracle = env.oracle.insecure_clone();
    env.warp(3_600);
    let p = env.propose_ix(id, SIDE_CREATOR, &oracle.pubkey());
    env.ok(&[p], &[&oracle]);
    env.warp(3_600);
    let d = env.dispute_ix(id, &ch.pubkey());
    env.ok(&[d], &[&ch]);

    // The arbiter goes silent: grace counts from the dispute, not the deadline.
    env.warp(7 * DAY - 3_600);
    let rf_open = env.refund_expired_ix(open_id, &oracle.pubkey());
    env.ok(&[rf_open], &[&oracle]);
    let rf = env.refund_expired_ix(id, &oracle.pubkey());
    env.fails(&[rf.clone()], &[&oracle], "GraceNotOver");
    env.warp(3_600);
    env.ok(&[rf], &[&oracle]);
    let c = env.claim(id);
    assert_eq!((c.winner_side, c.bond_state), (SIDE_UNRESOLVABLE, BOND_REFUND_DUE));
    let rb = env.refund_bond_ix(id, &ch.pubkey());
    env.ok(&[rb], &[&oracle]);
    for i in [env.payout_creator_ix(open_id, None), env.payout_creator_ix(id, None), env.payout_challenger_ix(id, 0, None)] {
        env.ok(&[i], &[&oracle]);
    }
    assert_eq!(env.usdc_of(&creator.pubkey()), 100 * USDC);
    assert_eq!(env.usdc_of(&ch.pubkey()), 10 * USDC);
    assert_invariant(&env, &[&creator, &ch], &[open_id, id], &[]);
}

#[test]
fn pause_blocks_new_positions_but_never_exits() {
    let mut env = setup();
    let creator = env.user(100 * USDC);
    let ch = env.bettor(10 * USDC);
    let id = env.claim_with(&creator, 5 * USDC, &[(&ch, 5 * USDC)], None);
    let (oracle, admin) = (env.oracle.insecure_clone(), env.admin.insecure_clone());
    let i = env.admin_ix("set_paused", true, &oracle.pubkey());
    env.fails(&[i], &[&oracle], "NotAdmin");
    let i = env.admin_ix("set_paused", true, &admin.pubkey());
    env.ok(&[i], &[&admin]);

    let deadline = env.now() + 3_600;
    let c = env.create_ix(&creator.pubkey(), 5 * USDC, deadline, None);
    env.fails(&[c], &[&creator], "Paused");
    let other = env.bettor(5 * USDC);
    let i = env.challenge_ix(id, &other.pubkey(), 2 * USDC, None);
    env.fails(&[i], &[&other], "Paused");
    env.warp(3_600);
    let p = env.propose_ix(id, SIDE_CREATOR, &oracle.pubkey());
    env.fails(&[p.clone()], &[&oracle], "Paused");
    // Exits keep working.
    let wd = env.withdraw_ix(&ch.pubkey(), 5 * USDC);
    env.ok(&[wd], &[&ch]);
    env.warp(7 * DAY);
    let rf = env.refund_expired_ix(id, &oracle.pubkey());
    env.ok(&[rf], &[&oracle]);
    let i = env.payout_challenger_ix(id, 0, None);
    env.ok(&[i], &[&oracle]);
    assert_eq!(env.usdc_of(&ch.pubkey()), 10 * USDC);

    let i = env.admin_ix("set_paused", false, &admin.pubkey());
    env.ok(&[i], &[&admin]);
    let deadline = env.now() + 3_600;
    let c = env.create_ix(&creator.pubkey(), 5 * USDC, deadline, None);
    env.ok(&[c], &[&creator]);
}

#[test]
fn zero_dispute_window_settles_on_propose() {
    let mut env = Env::new();
    env.initialize(0, 0, 0, 7 * DAY);
    let creator = env.user(100 * USDC);
    let ch = env.bettor(5 * USDC);
    let id = env.claim_with(&creator, 5 * USDC, &[(&ch, 5 * USDC)], None);
    let oracle = env.oracle.insecure_clone();
    env.warp(3_600);
    let p = env.propose_ix(id, SIDE_CHALLENGERS, &oracle.pubkey());
    env.ok(&[p], &[&oracle]);
    assert_eq!(env.claim(id).state, ST_RESOLVED);
    let i = env.payout_challenger_ix(id, 0, None);
    env.ok(&[i], &[&oracle]);
    assert_eq!(env.usdc_of(&ch.pubkey()), 10 * USDC); // no fees configured
}

#[test]
fn windows_are_frozen_per_claim() {
    let mut env = setup();
    let creator = env.user(100 * USDC);
    let ch = env.bettor(5 * USDC);
    let id = env.claim_with(&creator, 5 * USDC, &[(&ch, 5 * USDC)], None);
    let admin = env.admin.insecure_clone();
    let i = env.admin_ix("set_windows", (0i64, 10i64), &admin.pubkey());
    env.fails(&[i], &[&admin], "GraceOutOfRange");
    let i = env.admin_ix("set_windows", (8 * DAY, 7 * DAY), &admin.pubkey());
    env.fails(&[i], &[&admin], "DisputeWindowTooLong");
    let i = env.admin_ix("set_windows", (60i64, 120i64), &admin.pubkey());
    env.ok(&[i], &[&admin]);
    // The existing claim keeps its 24h / 7d terms.
    let c = env.claim(id);
    assert_eq!((c.dispute_window, c.resolution_grace), (DAY, 7 * DAY));
    let id2 = env.claim_with(&creator, 5 * USDC, &[], None);
    let c2 = env.claim(id2);
    assert_eq!((c2.dispute_window, c2.resolution_grace), (60, 120));
}

#[test]
fn two_step_admin_transfer() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    let next = env.user(0);
    let i = env.admin_ix("propose_admin", [0u8; 32], &admin.pubkey());
    env.fails(&[i], &[&admin], "ZeroKey");
    let i = env.admin_ix("propose_admin", next.pubkey().to_bytes(), &admin.pubkey());
    env.ok(&[i], &[&admin]);
    assert_eq!(env.config().admin, admin.pubkey().to_bytes(), "not transferred until accepted");
    let intruder = env.user(0);
    let accept = |who: &Keypair| ix("accept_admin", (), vec![rs(who.pubkey()), w(config_pda())]);
    env.fails(&[accept(&intruder)], &[&intruder], "NotPendingAdmin");
    env.ok(&[accept(&next)], &[&next]);
    let c = env.config();
    assert_eq!(c.admin, next.pubkey().to_bytes());
    assert_eq!(c.pending_admin, [0u8; 32]);
    let i = env.admin_ix("set_paused", true, &admin.pubkey());
    env.fails(&[i], &[&admin], "NotAdmin");
}

#[test]
fn oracle_rotation_is_timelocked() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    let next = env.user(0);
    let exec = ix("execute_oracle", (), vec![w(config_pda())]);
    env.fails(&[exec.clone()], &[&admin], "NothingQueued");
    let i = env.admin_ix("queue_oracle", next.pubkey().to_bytes(), &admin.pubkey());
    env.ok(&[i], &[&admin]);
    env.fails(&[exec.clone()], &[&admin], "Timelocked");
    env.warp(2 * DAY - 1);
    env.fails(&[exec.clone()], &[&admin], "Timelocked");
    env.warp(1);
    env.ok(&[exec], &[&next]); // permissionless
    assert_eq!(env.config().oracle, next.pubkey().to_bytes());
    // cancel path
    let other = env.user(0);
    let i = env.admin_ix("queue_oracle", other.pubkey().to_bytes(), &admin.pubkey());
    env.ok(&[i], &[&admin]);
    let i = env.admin_ix("cancel_oracle", (), &admin.pubkey());
    env.ok(&[i], &[&admin]);
    assert_eq!(env.config().pending_oracle_eta, 0);
}

#[test]
fn fee_policy_is_timelocked_capped_and_frozen_per_claim() {
    let mut env = setup();
    let admin = env.admin.insecure_clone();
    let treasury = env.treasury.pubkey().to_bytes();
    let i = env.admin_ix("queue_fee_policy", (901u16, 100u16, treasury), &admin.pubkey());
    env.fails(&[i], &[&admin], "FeeTooHigh");
    let i = env.admin_ix("queue_fee_policy", (100u16, 0u16, [0u8; 32]), &admin.pubkey());
    env.fails(&[i], &[&admin], "NoFeeRecipient");

    let creator = env.user(100 * USDC);
    let ch = env.bettor(10 * USDC);
    let id = env.claim_with(&creator, 10 * USDC, &[(&ch, 10 * USDC)], None);

    let i = env.admin_ix("queue_fee_policy", (1000u16, 0u16, treasury), &admin.pubkey());
    env.ok(&[i], &[&admin]);
    let exec = ix("execute_fee_policy", (), vec![w(config_pda())]);
    env.fails(&[exec.clone()], &[&admin], "Timelocked");
    env.warp(2 * DAY);
    env.ok(&[exec], &[&admin]);
    assert_eq!(env.config().platform_fee_bps, 1000);

    // The claim created before the change still settles at 0.5%.
    let oracle = env.oracle.insecure_clone();
    let p = env.propose_ix(id, SIDE_CHALLENGERS, &oracle.pubkey());
    env.ok(&[p], &[&oracle]);
    env.warp(DAY);
    let f = env.finalize_ix(id);
    env.ok(&[f], &[&oracle]);
    let i = env.payout_challenger_ix(id, 0, None);
    env.ok(&[i], &[&oracle]);
    assert_eq!(env.usdc_of(&ch.pubkey()), 20 * USDC - 50_000);
    assert_eq!(env.claim(id).platform_fee_bps, 50);
}

#[test]
fn challenge_rules_still_hold() {
    let mut env = setup();
    let creator = env.user(100 * USDC);
    let ch = env.bettor(10 * USDC);
    let id = env.claim_with(&creator, 5 * USDC, &[], None);
    let i = env.challenge_ix(id, &ch.pubkey(), 1 * USDC, None);
    env.fails(&[i], &[&ch], "StakeTooSmall");
    let i = env.challenge_ix(id, &ch.pubkey(), 20 * USDC, None);
    env.fails(&[i], &[&ch], "InsufficientBalance");
    let i = env.challenge_ix(id, &ch.pubkey(), 2 * USDC, None);
    env.ok(&[i.clone()], &[&ch]);
    env.fails(&[i], &[&ch], "AlreadyChallenged");
    env.warp(3_600 - 30);
    let late = env.bettor(5 * USDC);
    let i = env.challenge_ix(id, &late.pubkey(), 2 * USDC, None);
    env.fails(&[i], &[&late], "ChallengeWindowClosed");
    let c = env.cancel_ix(id, &creator);
    env.fails(&[c], &[&creator], "NotOpen");
}

trait CancelIx {
    fn cancel_ix(&self, id: u64, creator: &Keypair) -> solana_instruction::Instruction;
}
impl CancelIx for Env {
    fn cancel_ix(&self, id: u64, creator: &Keypair) -> solana_instruction::Instruction {
        ix(
            "cancel_claim",
            (),
            vec![rs(creator.pubkey()), r(config_pda()), w(claim_pda(id)), w(self.ata(&creator.pubkey())), w(vault_pda()), r(TOKEN_PROGRAM)],
        )
    }
}
