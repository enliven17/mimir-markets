/**
 * System wallet roster: prints every wallet the system uses (admin/oracle,
 * market-creator, both council tracks) with SOL, USDC-ATA and ER virtual
 * balances, and how much USDC each wallet is short of its target.
 *
 * USDC comes from https://faucet.circle.com (Solana Devnet); send it to
 * the addresses this script prints. With --fund the script then:
 *   - tops up SOL for base-layer fees (from the admin wallet)
 *   - sweeps each bettor's faucet USDC: deposit into the Mimir vault →
 *     delegate the balance PDA to the Ephemeral Rollup
 * The market-creator keeps its USDC in its token account (it stakes from
 * there directly), so for it there is nothing to sweep.
 *
 * Devnet USDC is Circle's faucet mint (no mint authority), so this script
 * never mints: a wallet short of USDC is only reported, with the amount it
 * needs, for someone to send from the faucet or another wallet.
 *
 * Run:  npx tsx --env-file-if-exists=.env.local scripts/solana/system-status.ts [--fund]
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { loadAgentKeypair, loadCreatorKeypair, derivePersonaKeypair } from "../../lib/solana/keypair";
import { COUNCIL_PERSONAS } from "../../agents/council/personas";
import { MimirSolanaClient } from "../../lib/solana/client";
import { SOLANA_RPC, USDC_MINT, toUsdcUnits, fromUsdcUnits } from "../../lib/solana/config";

const FUND = process.argv.includes("--fund");

// Public devnet RPC throttles bursts hard; pace + retry everything.
process.on("unhandledRejection", (err) => {
  console.warn("(non-fatal rejection)", String(err).slice(0, 120));
});

async function withRetry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (i >= tries) throw err;
      const wait = 3000 * i;
      console.warn(`  (${label} failed: ${String(err?.message ?? err).slice(0, 80)}, retry ${i}/${tries - 1} in ${wait / 1000}s)`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
const PERSONA_SOL = 0.03;
const PERSONA_USDC = 25;
const CREATOR_SOL = 0.1;
const CREATOR_USDC = 50;

interface Row {
  role: string;
  keypair: Keypair;
  targetSol: number;
  targetUsdc: number;
  /** deposit+delegate into the ER (bettors), or keep USDC in the ATA (creator) */
  erBettor: boolean;
}

async function solBalance(c: Connection, pk: PublicKey): Promise<number> {
  return (await c.getBalance(pk)) / LAMPORTS_PER_SOL;
}

async function ataBalance(c: Connection, owner: PublicKey): Promise<number> {
  try {
    const acc = await getAccount(c, getAssociatedTokenAddressSync(USDC_MINT, owner, true));
    return fromUsdcUnits(BigInt(acc.amount.toString()));
  } catch {
    return -1; // no ATA
  }
}

async function main() {
  const connection = new Connection(SOLANA_RPC, "confirmed");
  const admin = loadAgentKeypair();
  const creator = loadCreatorKeypair();

  const rows: Row[] = [
    { role: "creator (market-creator)", keypair: creator, targetSol: CREATOR_SOL, targetUsdc: CREATOR_USDC, erBettor: false },
    ...COUNCIL_PERSONAS.map((p) => ({
      role: `council ${p.emoji} ${p.slug}`,
      keypair: derivePersonaKeypair(admin, p.slug),
      targetSol: PERSONA_SOL,
      targetUsdc: PERSONA_USDC,
      erBettor: true,
    })),
  ];

  const shortfalls: { role: string; address: string; needUsdc: number }[] = [];

  console.log("Mimir system wallets" + (FUND ? " · FUNDING PASS" : ""));
  console.log(`  mint: ${USDC_MINT.toBase58()}  ·  rpc: ${SOLANA_RPC}\n`);

  const adminClient = new MimirSolanaClient(admin);
  console.log(
    `  admin/oracle  ${admin.publicKey.toBase58()}  ` +
      `SOL=${(await solBalance(connection, admin.publicKey)).toFixed(3)}  ` +
      `ATA=${await ataBalance(connection, admin.publicKey)}  ` +
      `ER=${fromUsdcUnits(await adminClient.getBalance())}`
  );

  for (const row of rows) {
    const pk = row.keypair.publicKey;
    const client = new MimirSolanaClient(row.keypair);
    let sol = await solBalance(connection, pk);
    let ata = await ataBalance(connection, pk);
    let er = fromUsdcUnits(await client.getBalance());

    if (FUND) {
      if (sol < row.targetSol) {
        await withRetry(`${row.role} SOL`, () =>
          sendAndConfirmTransaction(
            connection,
            new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: admin.publicKey,
                toPubkey: pk,
                lamports: Math.round((row.targetSol - sol) * LAMPORTS_PER_SOL),
              })
            ),
            [admin]
          )
        );
        sol = await solBalance(connection, pk);
        await new Promise((r) => setTimeout(r, 2000));
      }
      // Sweep: whatever USDC the faucet delivered to a bettor's token
      // account gets deposited into the vault and delegated to the ER.
      if (row.erBettor && ata > 0) {
        const sweep = toUsdcUnits(ata);
        // A delegated balance PDA is owned by the delegation program, so the
        // base-layer deposit would fail: bring it home first, then re-delegate.
        if (await client.isBalanceDelegated()) {
          await withRetry(`${row.role} undelegate`, () => client.undelegateBalance());
          for (let i = 0; i < 30 && (await client.isBalanceDelegated()); i++) {
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
        await withRetry(`${row.role} deposit`, () => client.deposit(sweep));
        try {
          await withRetry(`${row.role} delegate`, () => client.delegateBalance(), 2);
        } catch {
          // already delegated; deposit while delegated would have failed
          // first, so reaching here with a fresh deposit means it was new
        }
        er = fromUsdcUnits(await client.getBalance());
        ata = await ataBalance(connection, pk);
      }
      await new Promise((r) => setTimeout(r, 2500)); // devnet RPC pacing
    }

    console.log(
      `  ${row.role.padEnd(28)} ${pk.toBase58()}  SOL=${sol.toFixed(3)}  ` +
        `ATA=${ata < 0 ? "-" : ata}  ER=${er}`
    );
    const held = Math.max(ata, 0) + er;
    if (held < row.targetUsdc) {
      shortfalls.push({ role: row.role, address: pk.toBase58(), needUsdc: Math.round((row.targetUsdc - held) * 100) / 100 });
    }
  }

  if (shortfalls.length) {
    const total = shortfalls.reduce((s, r) => s + r.needUsdc, 0);
    console.log(`\nUSDC shortfall (target ${PERSONA_USDC} per persona, ${CREATOR_USDC} for the creator): ${total.toFixed(2)} USDC across ${shortfalls.length} wallet(s):`);
    for (const r of shortfalls) console.log(`  ${r.role.padEnd(28)} ${r.address}  needs ${r.needUsdc.toFixed(2)} USDC`);
  } else {
    console.log("\nEvery wallet is at or above its USDC target.");
  }

  console.log(
    "\nNotes: ER = virtual balance delegated into the Ephemeral Rollup (what bettors stake from)."
  );
  console.log("ATA = plain USDC token account (what the market-creator stakes from).");
  console.log("Fund USDC at https://faucet.circle.com → Solana Devnet → the addresses above.");
  if (!FUND) console.log("Then run with --fund to sweep faucet USDC into ER betting balances.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
