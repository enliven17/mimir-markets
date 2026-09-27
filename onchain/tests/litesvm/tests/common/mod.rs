//! LiteSVM harness for the Mimir program: raw instruction builders (Anchor
//! discriminators + borsh args), token account fixtures, account decoding.
#![allow(dead_code)]

use std::collections::HashMap;

use borsh::{BorshDeserialize, BorshSerialize};
use litesvm::LiteSVM;
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_program_option::COption;
use solana_program_pack::Pack;
use solana_signer::Signer;
use solana_transaction::Transaction;
use spl_token_interface::state::{Account as TokenAccount, AccountState, Mint};

pub const PROGRAM_ID: Address = Address::from_str_const("EnLyMg9fBhgvKcWVAyD1YKv3i2BbLejfRFb5hEXur1WE");
pub const TOKEN_PROGRAM: Address = spl_token_interface::ID;
pub const SYSTEM_PROGRAM: Address = Address::from_str_const("11111111111111111111111111111111");
pub const USDC: u64 = 1_000_000;
pub const DAY: i64 = 86_400;

// ── On-chain mirrors (layout must match state.rs exactly) ─────────────────

#[derive(BorshDeserialize, Debug, Clone)]
pub struct Config {
    pub admin: [u8; 32],
    pub pending_admin: [u8; 32],
    pub oracle: [u8; 32],
    pub pending_oracle: [u8; 32],
    pub pending_oracle_eta: i64,
    pub usdc_mint: [u8; 32],
    pub claim_count: u64,
    pub total_resolved: u64,
    pub vault_bump: u8,
    pub paused: bool,
    pub dispute_window: i64,
    pub resolution_grace: i64,
    pub fee_recipient: [u8; 32],
    pub platform_fee_bps: u16,
    pub agent_fee_bps: u16,
    pub pending_fee_recipient: [u8; 32],
    pub pending_platform_fee_bps: u16,
    pub pending_agent_fee_bps: u16,
    pub pending_fee_eta: i64,
    pub fees_accrued: u64,
    pub lifetime_fees_accrued: u64,
    pub lifetime_fees_claimed: u64,
    pub _reserved: [u8; 64],
}

#[derive(BorshDeserialize, Debug, Clone)]
pub struct Challenger {
    pub addr: [u8; 32],
    pub stake: u64,
    pub paid: bool,
    pub agent: [u8; 32],
}

#[derive(BorshDeserialize, Debug, Clone)]
pub struct Claim {
    pub id: u64,
    pub bump: u8,
    pub creator: [u8; 32],
    pub question: String,
    pub creator_position: String,
    pub counter_position: String,
    pub resolution_url: String,
    pub category: String,
    pub creator_stake: u64,
    pub total_challenger_stake: u64,
    pub deadline: i64,
    pub state: u8,
    pub winner_side: u8,
    pub resolution_summary: String,
    pub confidence: u8,
    pub evidence_hash: [u8; 32],
    pub created_at: i64,
    pub max_challengers: u8,
    pub creator_paid: bool,
    pub challengers: Vec<Challenger>,
    pub creator_agent: [u8; 32],
    pub fee_recipient: [u8; 32],
    pub platform_fee_bps: u16,
    pub agent_fee_bps: u16,
    pub total_fees: u64,
    pub dispute_window: i64,
    pub resolution_grace: i64,
    pub proposed_side: u8,
    pub proposed_at: i64,
    pub disputable_until: i64,
    pub disputer: [u8; 32],
    pub disputed_at: i64,
    pub bond: u64,
    pub bond_state: u8,
    pub resolved_at: i64,
}

#[derive(BorshDeserialize, Debug, Clone)]
pub struct UserBalance {
    pub owner: [u8; 32],
    pub amount: u64,
}

#[derive(BorshDeserialize, Debug, Clone)]
pub struct FeeBalance {
    pub owner: [u8; 32],
    pub amount: u64,
    pub lifetime: u64,
    pub bump: u8,
}

// ── Args ──────────────────────────────────────────────────────────────────

#[derive(BorshSerialize)]
pub struct InitArgs {
    pub oracle: [u8; 32],
    pub fee_recipient: [u8; 32],
    pub platform_fee_bps: u16,
    pub agent_fee_bps: u16,
    pub dispute_window: i64,
    pub resolution_grace: i64,
}

#[derive(BorshSerialize)]
pub struct CreateClaimArgs {
    pub question: String,
    pub creator_position: String,
    pub counter_position: String,
    pub resolution_url: String,
    pub category: String,
    pub stake_amount: u64,
    pub deadline: i64,
    pub max_challengers: u8,
    pub agent: Option<[u8; 32]>,
}

// ── PDAs ──────────────────────────────────────────────────────────────────

pub fn pda(seeds: &[&[u8]]) -> Address {
    Address::find_program_address(seeds, &PROGRAM_ID).0
}
pub fn config_pda() -> Address {
    pda(&[b"config"])
}
pub fn vault_pda() -> Address {
    pda(&[b"vault"])
}
pub fn balance_pda(user: &Address) -> Address {
    pda(&[b"balance", user.as_ref()])
}
pub fn claim_pda(id: u64) -> Address {
    pda(&[b"claim", &id.to_le_bytes()])
}
pub fn fee_pda(owner: &Address) -> Address {
    pda(&[b"fees", owner.as_ref()])
}

fn disc(name: &str) -> [u8; 8] {
    let h = Sha256::digest(format!("global:{name}").as_bytes());
    h[..8].try_into().unwrap()
}

pub fn ix(name: &str, args: impl BorshSerialize, accounts: Vec<AccountMeta>) -> Instruction {
    let mut data = disc(name).to_vec();
    args.serialize(&mut data).unwrap();
    Instruction { program_id: PROGRAM_ID, accounts, data }
}

pub fn w(a: Address) -> AccountMeta {
    AccountMeta::new(a, false)
}
pub fn r(a: Address) -> AccountMeta {
    AccountMeta::new_readonly(a, false)
}
pub fn ws(a: Address) -> AccountMeta {
    AccountMeta::new(a, true)
}
pub fn rs(a: Address) -> AccountMeta {
    AccountMeta::new_readonly(a, true)
}
/// Anchor encodes a missing Option<Account> as the program id.
pub fn none_acc() -> AccountMeta {
    r(PROGRAM_ID)
}

// ── Environment ───────────────────────────────────────────────────────────

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub oracle: Keypair,
    pub treasury: Keypair,
    pub mint: Address,
    pub errors: HashMap<String, u32>,
    atas: HashMap<Address, Address>,
}

fn manifest_path(rel: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(rel)
}

fn load_errors() -> HashMap<String, u32> {
    let path = std::env::var("MIMIR_IDL").map(Into::into).unwrap_or_else(|_| manifest_path("../../target/idl/mimir.json"));
    let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).expect("IDL: run anchor idl build")).unwrap();
    json["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| (e["name"].as_str().unwrap().to_string(), e["code"].as_u64().unwrap() as u32))
        .collect()
}

impl Env {
    pub fn new() -> Self {
        let mut svm = LiteSVM::new().with_transaction_history(0);
        let so = std::env::var("MIMIR_SO").map(Into::into).unwrap_or_else(|_| manifest_path("../../target/deploy/mimir.so"));
        svm.add_program_from_file(PROGRAM_ID, &so).expect("mimir.so: run anchor build");
        let admin = Keypair::new();
        let oracle = Keypair::new();
        let treasury = Keypair::new();
        for k in [&admin, &oracle, &treasury] {
            svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
        }
        let mint = Address::new_unique();
        let mut data = vec![0u8; Mint::LEN];
        Mint {
            mint_authority: COption::Some(admin.pubkey()),
            supply: 1_000_000 * USDC,
            decimals: 6,
            is_initialized: true,
            freeze_authority: COption::None,
        }
        .pack_into_slice(&mut data);
        svm.set_account(mint, Account { lamports: 1_000_000_000, data, owner: TOKEN_PROGRAM, executable: false, rent_epoch: 0 })
            .unwrap();
        let mut env = Env { svm, admin, oracle, treasury, mint, errors: load_errors(), atas: HashMap::new() };
        env.set_time(1_000_000);
        env
    }

    pub fn now(&self) -> i64 {
        self.svm.get_sysvar::<Clock>().unix_timestamp
    }

    pub fn set_time(&mut self, t: i64) {
        let mut c = self.svm.get_sysvar::<Clock>();
        c.unix_timestamp = t;
        c.slot += 1;
        self.svm.set_sysvar(&c);
    }

    pub fn warp(&mut self, secs: i64) {
        let t = self.now() + secs;
        self.set_time(t);
    }

    pub fn user(&mut self, usdc: u64) -> Keypair {
        let k = Keypair::new();
        self.svm.airdrop(&k.pubkey(), 10_000_000_000).unwrap();
        self.token_account(&k.pubkey(), usdc);
        k
    }

    /// A token account for `owner` holding `amount` (idempotent per owner).
    pub fn token_account(&mut self, owner: &Address, amount: u64) -> Address {
        let addr = *self.atas.entry(*owner).or_insert_with(Address::new_unique);
        let mut data = vec![0u8; TokenAccount::LEN];
        TokenAccount {
            mint: self.mint,
            owner: *owner,
            amount,
            delegate: COption::None,
            state: AccountState::Initialized,
            is_native: COption::None,
            delegated_amount: 0,
            close_authority: COption::None,
        }
        .pack_into_slice(&mut data);
        self.svm
            .set_account(addr, Account { lamports: 1_000_000_000, data, owner: TOKEN_PROGRAM, executable: false, rent_epoch: 0 })
            .unwrap();
        addr
    }

    pub fn ata(&self, owner: &Address) -> Address {
        self.atas[owner]
    }

    pub fn token_balance(&self, addr: &Address) -> u64 {
        TokenAccount::unpack(&self.svm.get_account(addr).unwrap().data).unwrap().amount
    }

    pub fn usdc_of(&self, owner: &Address) -> u64 {
        self.token_balance(&self.ata(owner))
    }

    pub fn vault(&self) -> u64 {
        self.token_balance(&vault_pda())
    }

    fn decode<T: BorshDeserialize>(&self, addr: &Address) -> T {
        let acc = self.svm.get_account(addr).expect("account missing");
        T::deserialize(&mut &acc.data[8..]).unwrap()
    }
    pub fn config(&self) -> Config {
        self.decode(&config_pda())
    }
    pub fn claim(&self, id: u64) -> Claim {
        self.decode(&claim_pda(id))
    }
    pub fn balance(&self, user: &Address) -> UserBalance {
        self.decode(&balance_pda(user))
    }
    pub fn fee_balance(&self, owner: &Address) -> FeeBalance {
        self.decode(&fee_pda(owner))
    }

    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> Result<(), String> {
        let payer = signers[0].pubkey();
        let tx = Transaction::new_signed_with_payer(ixs, Some(&payer), signers, self.svm.latest_blockhash());
        self.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?} {:?}", e.err, e.meta.logs))
    }

    pub fn ok(&mut self, ixs: &[Instruction], signers: &[&Keypair]) {
        if let Err(e) = self.send(ixs, signers) {
            panic!("tx failed: {e}");
        }
    }

    /// Assert the tx fails with the named Mimir error.
    pub fn fails(&mut self, ixs: &[Instruction], signers: &[&Keypair], error: &str) {
        let code = *self.errors.get(error).unwrap_or_else(|| panic!("unknown error {error}"));
        match self.send(ixs, signers) {
            Ok(()) => panic!("expected {error}, tx succeeded"),
            Err(e) => assert!(e.contains(&format!("Custom({code})")), "expected {error} ({code}), got {e}"),
        }
    }

    // ── Instruction builders ─────────────────────────────────────────────

    pub fn initialize(&mut self, platform_bps: u16, agent_bps: u16, dispute_window: i64, grace: i64) {
        let args = InitArgs {
            oracle: self.oracle.pubkey().to_bytes(),
            fee_recipient: self.treasury.pubkey().to_bytes(),
            platform_fee_bps: platform_bps,
            agent_fee_bps: agent_bps,
            dispute_window,
            resolution_grace: grace,
        };
        let i = ix(
            "initialize",
            args,
            vec![ws(self.admin.pubkey()), w(config_pda()), r(self.mint), w(vault_pda()), r(TOKEN_PROGRAM), r(SYSTEM_PROGRAM)],
        );
        let admin = self.admin.insecure_clone();
        self.ok(&[i], &[&admin]);
        let treasury = self.treasury.pubkey();
        self.token_account(&treasury, 0);
    }

    pub fn admin_ix(&self, name: &str, args: impl BorshSerialize, signer: &Address) -> Instruction {
        ix(name, args, vec![rs(*signer), w(config_pda())])
    }

    pub fn deposit_ix(&self, user: &Address, amount: u64) -> Instruction {
        ix(
            "deposit",
            amount,
            vec![ws(*user), r(config_pda()), w(balance_pda(user)), w(self.ata(user)), w(vault_pda()), r(TOKEN_PROGRAM), r(SYSTEM_PROGRAM)],
        )
    }

    pub fn withdraw_ix(&self, user: &Address, amount: u64) -> Instruction {
        ix(
            "withdraw",
            amount,
            vec![rs(*user), r(config_pda()), w(balance_pda(user)), r(*user), w(self.ata(user)), w(vault_pda()), r(TOKEN_PROGRAM)],
        )
    }

    pub fn create_ix(&self, creator: &Address, stake: u64, deadline: i64, agent: Option<Address>) -> Instruction {
        let next = self.config().claim_count + 1;
        let args = CreateClaimArgs {
            question: "Will SOL close above $200 on Friday?".into(),
            creator_position: "Yes".into(),
            counter_position: "No".into(),
            resolution_url: "https://example.com".into(),
            category: "crypto".into(),
            stake_amount: stake,
            deadline,
            max_challengers: 0,
            agent: agent.map(|a| a.to_bytes()),
        };
        ix(
            "create_claim",
            args,
            vec![ws(*creator), w(config_pda()), w(claim_pda(next)), w(self.ata(creator)), w(vault_pda()), r(TOKEN_PROGRAM), r(SYSTEM_PROGRAM)],
        )
    }

    pub fn challenge_ix(&self, id: u64, challenger: &Address, stake: u64, agent: Option<Address>) -> Instruction {
        ix(
            "challenge_claim",
            (stake, agent.map(|a| a.to_bytes())),
            vec![rs(*challenger), r(config_pda()), w(claim_pda(id)), w(balance_pda(challenger))],
        )
    }

    pub fn propose_ix(&self, id: u64, side: u8, signer: &Address) -> Instruction {
        ix(
            "propose_resolution",
            (side, "LLM verdict".to_string(), 90u8, [7u8; 32]),
            vec![rs(*signer), w(config_pda()), w(claim_pda(id))],
        )
    }

    pub fn dispute_ix(&self, id: u64, disputer: &Address) -> Instruction {
        ix(
            "dispute_resolution",
            (),
            vec![rs(*disputer), r(config_pda()), w(claim_pda(id)), w(self.ata(disputer)), w(vault_pda()), r(TOKEN_PROGRAM)],
        )
    }

    pub fn finalize_ix(&self, id: u64) -> Instruction {
        ix("finalize_resolution", (), vec![w(config_pda()), w(claim_pda(id))])
    }

    pub fn settle_ix(&self, id: u64, side: u8, signer: &Address) -> Instruction {
        ix(
            "settle_dispute",
            (side, "Arbiter ruling".to_string(), 100u8, [9u8; 32]),
            vec![rs(*signer), w(config_pda()), w(claim_pda(id))],
        )
    }

    pub fn refund_expired_ix(&self, id: u64, caller: &Address) -> Instruction {
        ix("refund_expired", (), vec![rs(*caller), w(config_pda()), w(claim_pda(id))])
    }

    pub fn refund_bond_ix(&self, id: u64, disputer: &Address) -> Instruction {
        ix(
            "refund_bond",
            (),
            vec![r(config_pda()), w(claim_pda(id)), w(self.ata(disputer)), w(vault_pda()), r(TOKEN_PROGRAM)],
        )
    }

    pub fn payout_creator_ix(&self, id: u64, agent: Option<Address>) -> Instruction {
        let c = self.claim(id);
        let creator = Address::from(c.creator);
        ix(
            "payout_creator",
            (),
            vec![
                w(config_pda()),
                w(claim_pda(id)),
                w(self.ata(&creator)),
                w(vault_pda()),
                agent.map(|a| w(fee_pda(&a))).unwrap_or_else(none_acc),
                r(TOKEN_PROGRAM),
            ],
        )
    }

    pub fn payout_challenger_ix(&self, id: u64, index: u8, agent: Option<Address>) -> Instruction {
        let c = self.claim(id);
        let who = Address::from(c.challengers[index as usize].addr);
        ix(
            "payout_challenger",
            index,
            vec![
                w(config_pda()),
                w(claim_pda(id)),
                w(self.ata(&who)),
                w(vault_pda()),
                agent.map(|a| w(fee_pda(&a))).unwrap_or_else(none_acc),
                r(TOKEN_PROGRAM),
            ],
        )
    }

    pub fn open_fee_ix(&self, payer: &Address, owner: &Address) -> Instruction {
        ix("open_fee_account", owner.to_bytes(), vec![ws(*payer), w(fee_pda(owner)), r(SYSTEM_PROGRAM)])
    }

    pub fn claim_agent_fees_ix(&self, owner: &Address) -> Instruction {
        ix(
            "claim_agent_fees",
            (),
            vec![rs(*owner), r(config_pda()), w(fee_pda(owner)), w(self.ata(owner)), w(vault_pda()), r(TOKEN_PROGRAM)],
        )
    }

    pub fn withdraw_fees_ix(&self, authority: &Address, amount: u64) -> Instruction {
        let rec = self.ata(&self.treasury.pubkey());
        ix("withdraw_fees", amount, vec![rs(*authority), w(config_pda()), w(rec), w(vault_pda()), r(TOKEN_PROGRAM)])
    }

    // ── Composite helpers ────────────────────────────────────────────────

    /// Fund + deposit a bettor's virtual balance.
    pub fn bettor(&mut self, deposit: u64) -> Keypair {
        let k = self.user(deposit);
        let i = self.deposit_ix(&k.pubkey(), deposit);
        self.ok(&[i], &[&k]);
        k
    }

    /// Creator stakes `stake`, each challenger stakes its amount; returns claim id.
    pub fn claim_with(&mut self, creator: &Keypair, stake: u64, challengers: &[(&Keypair, u64)], agent: Option<Address>) -> u64 {
        let deadline = self.now() + 3_600;
        let i = self.create_ix(&creator.pubkey(), stake, deadline, agent);
        self.ok(&[i], &[creator]);
        let id = self.config().claim_count;
        for (ch, s) in challengers {
            let i = self.challenge_ix(id, &ch.pubkey(), *s, None);
            self.ok(&[i], &[*ch]);
        }
        id
    }

    /// Everything the vault owes (see the invariant in lib.rs), for this test's accounts.
    pub fn liabilities(&self, users: &[&Address], claims: &[u64], agents: &[&Address]) -> u64 {
        let mut owed = self.config().fees_accrued;
        for u in users {
            if self.svm.get_account(&balance_pda(u)).is_some() {
                owed += self.balance(u).amount;
            }
        }
        for a in agents {
            if self.svm.get_account(&fee_pda(a)).is_some() {
                owed += self.fee_balance(a).amount;
            }
        }
        for id in claims {
            let c = self.claim(*id);
            if c.bond_state == 1 || c.bond_state == 2 {
                owed += c.bond;
            }
            match c.state {
                3 => {}
                2 => {
                    // unpaid legs, gross (fees are booked when the leg is paid)
                    let creator_leg = match c.winner_side {
                        1 => c.creator_stake + c.total_challenger_stake,
                        3 | 4 => c.creator_stake,
                        _ => 0,
                    };
                    if !c.creator_paid {
                        owed += creator_leg;
                    }
                    for ch in c.challengers.iter().filter(|ch| !ch.paid) {
                        owed += match c.winner_side {
                            2 => ch.stake + (ch.stake as u128 * c.creator_stake as u128 / c.total_challenger_stake as u128) as u64,
                            3 | 4 => ch.stake,
                            _ => 0,
                        };
                    }
                }
                _ => owed += c.creator_stake + c.total_challenger_stake,
            }
        }
        owed
    }
}
