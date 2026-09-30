/**
 * Move test USDC out of the pre-V3 program (J9MZfzQt…) into the V3 program.
 * Devnet USDC is faucet-limited, so nothing is left stranded in the old vault.
 *
 *   1. Old claims (oracle = admin):
 *      - ACTIVE past deadline → undelegate from the ER, resolve UNRESOLVABLE
 *        (every stake refunded, the old program has no fees)
 *      - RESOLVED with unpaid legs → crank payout_creator / payout_challenger
 *      - OPEN → only the creator can cancel; cancelled here when this script
 *        holds the creator key (CREATOR_KEYPAIR[_JSON]), otherwise reported
 *   2. Wallets (admin, market-creator, every council persona):
 *      undelegate the old balance PDA → withdraw it to the ATA → deposit the
 *      same amount into the V3 program → delegate the new balance to the ER
 *      (personas only; the creator stakes from its ATA).
 *
 * Dry run by default; pass --execute to send transactions.
 * Run: npx tsx --env-file-if-exists=.env.local scripts/solana/migrate-v2-funds.ts [--execute] [--skip-claims]
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { createHash } from "node:crypto";
import legacyIdl from "./idl/mimir-v2.json";
import { KeypairWallet, MimirSolanaClient } from "../../lib/solana/client";
import { derivePersonaKeypair, loadAgentKeypair, loadCreatorKeypair } from "../../lib/solana/keypair";
import { CLASSIC_PERSONAS } from "../../agents/council/personas";
import {
  LEGACY_MIMIR_PROGRAM_ID,
  MAGICBLOCK_ER_RPC,
  SOLANA_RPC,
  USDC_MINT,
  fromUsdcUnits,
} from "../../lib/solana/config";
import { ensureSol, sleep, withRetry } from "./shared";

const EXECUTE = process.argv.includes("--execute");
const SKIP_CLAIMS = process.argv.includes("--skip-claims");
const SIDE_UNRESOLVABLE = 4;
const MIGRATION_SUMMARY = "Refunded: program migrated to V3 before this claim was settled";

const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, LEGACY_MIMIR_PROGRAM_ID)[0];
const idBuf = (id: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(id);
  return b;
};
const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(USDC_MINT, owner, true);

/** The old program, on base and ER, signed by one keypair. */
class Legacy {
  readonly base: anchor.Program;
  readonly er: anchor.Program;
  readonly conn: Connection;
  constructor(readonly kp: Keypair) {
    const w = new KeypairWallet(kp) as any;
    this.conn = new Connection(SOLANA_RPC, "confirmed");
    const idl = { ...(legacyIdl as anchor.Idl), address: LEGACY_MIMIR_PROGRAM_ID.toBase58() };
    this.base = new anchor.Program(idl, new anchor.AnchorProvider(this.conn, w, { commitment: "confirmed" }));
    this.er = new anchor.Program(idl, new anchor.AnchorProvider(new Connection(MAGICBLOCK_ER_RPC, "confirmed"), w, { commitment: "confirmed" }));
  }
  async delegated(address: PublicKey): Promise<boolean | null> {
    const info = await this.conn.getAccountInfo(address);
    return info ? !info.owner.equals(LEGACY_MIMIR_PROGRAM_ID) : null;
  }
  /** Read from the layer that owns the account (ER copies go stale after undelegation). */
  async fetch(kind: "claim" | "userBalance", address: PublicKey): Promise<any | null> {
    const d = await this.delegated(address);
    if (d === null) return null;
    return ((d ? this.er : this.base).account as any)[kind].fetch(address).catch(() => null);
  }
  async undelegate(kind: "claim" | "balance", address: PublicKey): Promise<void> {
    const method = kind === "claim" ? "undelegateClaim" : "undelegateBalance";
    await (this.er.methods as any)[method]().accounts({ payer: this.kp.publicKey, [kind]: address }).rpc({ skipPreflight: true });
    for (let i = 0; i < 25; i++) {
      await sleep(1500);
      if (!(await this.delegated(address))) return;
    }
    throw new Error(`${address.toBase58()} still delegated after undelegate`);
  }
}

async function migrateClaims(oracle: Legacy, creator: Legacy | null): Promise<void> {
  const cfg: any = await (oracle.base.account as any).config.fetch(pda(Buffer.from("config")));
  const count = BigInt(cfg.claimCount.toString());
  const now = Math.floor(Date.now() / 1000);
  const openLeft: string[] = [];
  let resolved = 0;
  let legs = 0;
  console.log(`\n[claims] old program has ${count} claims`);
  for (let id = 1n; id <= count; id++) {
    const address = pda(Buffer.from("claim"), idBuf(id));
    let c = await withRetry(`read #${id}`, () => oracle.fetch("claim", address));
    if (!c) continue;
    const state: number = c.state;
    if (state === 3) continue;
    if (state === 0) {
      if (creator && c.creator.equals(creator.kp.publicKey)) {
        console.log(`  #${id} OPEN → cancel (${fromUsdcUnits(BigInt(c.creatorStake.toString()))} USDC back to creator)`);
        if (EXECUTE) {
          if (await creator.delegated(address)) await creator.undelegate("claim", address);
          await creator.base.methods.cancelClaim().accounts({ creator: creator.kp.publicKey, claim: address, creatorToken: ata(creator.kp.publicKey) }).rpc();
        }
      } else {
        openLeft.push(`#${id} (${fromUsdcUnits(BigInt(c.creatorStake.toString()))} USDC, creator ${c.creator.toBase58()})`);
      }
      continue;
    }
    if (state === 1) {
      if (c.deadline.toNumber() > now) {
        console.log(`  #${id} ACTIVE until ${new Date(c.deadline.toNumber() * 1000).toISOString()}, skipped (not expired)`);
        continue;
      }
      console.log(`  #${id} ACTIVE expired → undelegate + resolve UNRESOLVABLE (refund)`);
      if (!EXECUTE) continue;
      if (await oracle.delegated(address)) await withRetry(`undelegate #${id}`, () => oracle.undelegate("claim", address));
      const hash = createHash("sha256").update(`migration:${id}`).digest();
      await withRetry(`resolve #${id}`, () =>
        oracle.base.methods
          .resolveClaim(SIDE_UNRESOLVABLE, MIGRATION_SUMMARY, 0, Array.from(hash))
          .accounts({ oracle: oracle.kp.publicKey, claim: address })
          .rpc()
      );
      resolved++;
      c = await (oracle.base.account as any).claim.fetch(address);
    }
    // RESOLVED: crank whatever is still owed (pull-based payouts are permissionless).
    const side: number = c.winnerSide;
    const creatorOwed = !c.creatorPaid && (side === 1 || side === 3 || side === 4);
    const chOwed = (c.challengers as any[])
      .map((ch, i) => ({ ch, i }))
      .filter(({ ch }) => !ch.paid && (side === 2 || side === 3 || side === 4));
    if (!creatorOwed && chOwed.length === 0) continue;
    console.log(`  #${id} RESOLVED side ${side} → ${Number(creatorOwed) + chOwed.length} unpaid leg(s)`);
    if (!EXECUTE) continue;
    if (await oracle.delegated(address)) await withRetry(`undelegate #${id}`, () => oracle.undelegate("claim", address));
    if (creatorOwed) {
      await withRetry(`payout creator #${id}`, () =>
        oracle.base.methods.payoutCreator().accounts({ claim: address, creatorToken: ata(c.creator) }).rpc()
      );
      legs++;
    }
    for (const { ch, i } of chOwed) {
      await withRetry(`payout #${id}/${i}`, () =>
        oracle.base.methods.payoutChallenger(i).accounts({ claim: address, challengerToken: ata(ch.addr) }).rpc()
      );
      legs++;
    }
  }
  console.log(`[claims] resolved ${resolved} expired ACTIVE claim(s), cranked ${legs} payout leg(s)`);
  if (openLeft.length) console.log(`[claims] OPEN claims only their creator can cancel: ${openLeft.join(", ")}`);
}

interface WalletRow {
  role: string;
  kp: Keypair;
  /** re-delegate the new balance to the ER (bettors) */
  erBettor: boolean;
}

async function migrateWallet(row: WalletRow, admin: Keypair): Promise<bigint> {
  const legacy = new Legacy(row.kp);
  const address = pda(Buffer.from("balance"), row.kp.publicKey.toBuffer());
  const bal = await withRetry(`${row.role} balance`, () => legacy.fetch("userBalance", address));
  const amount = bal ? BigInt(bal.amount.toString()) : 0n;
  if (amount === 0n) {
    console.log(`  ${row.role.padEnd(18)} old balance 0, nothing to move`);
    return 0n;
  }
  console.log(`  ${row.role.padEnd(18)} old balance ${fromUsdcUnits(amount)} USDC → V3${row.erBettor ? " (delegated to ER)" : ""}`);
  if (!EXECUTE) return amount;
  if (!row.kp.publicKey.equals(admin.publicKey)) await ensureSol(legacy.conn, admin, row.kp.publicKey, 0.02);
  if (await legacy.delegated(address)) await withRetry(`${row.role} undelegate`, () => legacy.undelegate("balance", address));
  await withRetry(`${row.role} withdraw`, () =>
    legacy.base.methods
      .withdraw(new BN(amount.toString()))
      .accounts({ user: row.kp.publicKey, owner: row.kp.publicKey, userToken: ata(row.kp.publicKey) })
      .rpc()
  );
  const v3 = new MimirSolanaClient(row.kp);
  if (await v3.isBalanceDelegated()) {
    // Already on V3 in the ER: its free balance there is unchanged, the moved USDC stays in the ATA.
    console.log(`    V3 balance already delegated; ${fromUsdcUnits(amount)} USDC left in the ATA (system:fund sweeps it)`);
    return amount;
  }
  await withRetry(`${row.role} deposit`, () => v3.deposit(amount));
  if (row.erBettor) await withRetry(`${row.role} delegate`, () => v3.delegateBalance());
  return amount;
}

async function main() {
  const admin = loadAgentKeypair();
  const creatorKp = loadCreatorKeypair();
  console.log(`Mimir V2 → V3 fund migration (${EXECUTE ? "EXECUTE" : "dry run, pass --execute"})`);
  console.log(`  old program ${LEGACY_MIMIR_PROGRAM_ID.toBase58()}`);
  const solBefore = await new Connection(SOLANA_RPC).getBalance(admin.publicKey);

  if (!SKIP_CLAIMS) {
    const creator = creatorKp.publicKey.equals(admin.publicKey) ? null : new Legacy(creatorKp);
    await migrateClaims(new Legacy(admin), creator);
  }

  console.log("\n[wallets]");
  const rows: WalletRow[] = [{ role: "admin/oracle", kp: admin, erBettor: true }];
  if (!creatorKp.publicKey.equals(admin.publicKey)) rows.push({ role: "market-creator", kp: creatorKp, erBettor: false });
  else console.log("  (market-creator key not available locally; set CREATOR_KEYPAIR[_JSON] to migrate it)");
  // Only the classic ten existed under the old program.
  for (const p of CLASSIC_PERSONAS) rows.push({ role: `council ${p.slug}`, kp: derivePersonaKeypair(admin, p.slug), erBettor: true });
  let total = 0n;
  for (const row of rows) {
    try {
      total += await migrateWallet(row, admin);
    } catch (err: any) {
      console.warn(`  ${row.role}: FAILED: ${String(err?.message ?? err).slice(0, 160)}`);
    }
  }
  const spent = (solBefore - (await new Connection(SOLANA_RPC).getBalance(admin.publicKey))) / 1e9;
  console.log(`\n${EXECUTE ? "Moved" : "Would move"} ${fromUsdcUnits(total)} USDC of virtual balances. Admin SOL spent: ${spent.toFixed(4)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
