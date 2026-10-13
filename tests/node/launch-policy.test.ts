import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { agentWalletPolicy, ALLOWED_PROGRAMS, copyTradeWalletPolicy, PRIVY_IN_MAX, PROGRAMS, wsolAccount } from "../../lib/launch/solana/policy";

const addr = () => Keypair.generate().publicKey.toBase58();

test("agent policy: program allow-list, SOL transfers only to treasury/creator/own WSOL, no SPL transfers", () => {
  const wallet = addr();
  const creator = addr();
  const treasury = addr();
  const p = agentWalletPolicy({ wallet, creator, treasury });
  assert.equal(p.version, "1.0");
  assert.equal(p.chain_type, "solana");
  assert.ok(p.name.length <= 50);
  assert.deepEqual([...new Set(p.rules.map((r) => r.method))].sort(), ["signAndSendTransaction", "signTransaction"]);
  assert.equal(p.rules.length, 6);

  for (const method of ["signAndSendTransaction", "signTransaction"]) {
    const rules = p.rules.filter((r) => r.method === method);
    const programs = rules.find((r) => r.conditions[0].field === "programId");
    assert.equal(programs?.action, "ALLOW");
    assert.deepEqual(programs?.conditions, [{ field_source: "solana_program_instruction", field: "programId", operator: "in", value: [...ALLOWED_PROGRAMS] }]);
    assert.ok(!(programs?.conditions[0].value as string[]).includes(PROGRAMS.system), "System must not be allowed wholesale");

    const transfer = rules.find((r) => r.conditions.some((c) => c.field === "Transfer.to"));
    assert.equal(transfer?.action, "ALLOW");
    assert.deepEqual(transfer?.conditions[0], { field_source: "solana_system_program_instruction", field: "instructionName", operator: "eq", value: "Transfer" });
    assert.deepEqual(transfer?.conditions[1].value, [treasury, creator, wsolAccount(wallet)]);

    const deny = rules.find((r) => r.action === "DENY");
    assert.deepEqual(deny?.conditions, [{ field_source: "solana_token_program_instruction", field: "instructionName", operator: "in", value: ["Transfer", "TransferChecked", "Approve", "ApproveChecked", "SetAuthority"] }]);
  }
  for (const r of p.rules) assert.ok(r.name.length <= 50, r.name);
});

test("allow-list covers every program seen in PumpPortal and Jupiter transactions", () => {
  for (const p of [PROGRAMS.computeBudget, PROGRAMS.jupiter, PROGRAMS.pump, PROGRAMS.pumpAmm, PROGRAMS.pumpPortalRouter, PROGRAMS.token, PROGRAMS.token2022, PROGRAMS.associatedToken]) {
    assert.ok(ALLOWED_PROGRAMS.includes(p), p);
  }
});

test("WSOL account is the wallet's associated token account for the native mint", () => {
  // Known pair decoded from a live Jupiter /build response (taker DoyrVv..., WSOL ATA 42AT3a...).
  assert.ok(wsolAccount("DoyrVvzR2vwurz23Kkk5Z4QVeXLjs6nUfsSsnghidS8").startsWith("42AT3a"));
});

test("copy-trade policy: follower (+ optional treasury), dedupes", () => {
  const wallet = addr();
  const follower = addr();
  const p = copyTradeWalletPolicy({ wallet, follower });
  const to = p.rules.find((r) => r.conditions.some((c) => c.field === "Transfer.to"))!.conditions[1].value;
  assert.deepEqual(to, [follower, wsolAccount(wallet)]);
  const withTreasury = copyTradeWalletPolicy({ wallet, follower, treasury: follower });
  assert.deepEqual(withTreasury.rules[1].conditions[1].value, [follower, wsolAccount(wallet)]);
});

test("rejects non-base58 addresses", () => {
  assert.throws(() => agentWalletPolicy({ wallet: addr(), creator: "0xdeadbeef", treasury: addr() }), /creator is not a base58 address/);
  assert.throws(() => copyTradeWalletPolicy({ wallet: "", follower: addr() }), /wallet/);
});

test("airdrop allow-lists are split into rules of at most 100 values (Privy's `in` limit)", () => {
  const holders = Array.from({ length: 250 }, () => Keypair.generate().publicKey.toBase58());
  const p = agentWalletPolicy({ wallet: Keypair.generate().publicKey.toBase58(), creator: Keypair.generate().publicKey.toBase58(), treasury: Keypair.generate().publicKey.toBase58(), airdrop: holders });
  const values = p.rules.flatMap((r) => r.conditions.map((c) => c.value)).filter(Array.isArray);
  assert.ok(values.every((v) => v.length <= PRIVY_IN_MAX));
  const allowed = p.rules.filter((r) => r.name.startsWith("Allow this holder airdrop round")).flatMap((r) => r.conditions[1].value as string[]);
  assert.equal(new Set(allowed).size, 250);
});
