/**
 * Mimir on Solana: full economic cycle demo (~3 minutes), V3 flow:
 *
 *   1. creator opens a claim on the BASE layer (USDC stake → vault)
 *   2. claim PDA + challenger balance PDA are DELEGATED to the MagicBlock ER
 *   3. challenger stakes inside the ER  ← zero-fee, ~30ms, the core beat
 *   4. deadline passes → oracle commits + undelegates the claim
 *   5. oracle PROPOSES a verdict (evidence hash on-chain) → dispute window
 *   6. window closes undisputed → anyone finalizes → RESOLVED
 *   7. payout cranks: winner paid from the vault, fee on profit only
 *
 * The demo claim gets a 30s dispute window (frozen on it at creation; the
 * live config is restored right after). The challenger is a derived keypair
 * whose USDC is swept back to the admin at the end.
 *
 * Run: npx tsx --env-file-if-exists=.env.local scripts/solana/demo-full-cycle.ts
 */
import { createHash } from "node:crypto";
import { MimirSolanaClient } from "../../lib/solana/client";
import { derivePersonaKeypair, loadAgentKeypair } from "../../lib/solana/keypair";
import { SIDE_CHALLENGERS, STATE_LABELS, fromUsdcUnits, toUsdcUnits } from "../../lib/solana/config";
import { ensureSol, explorer, nowSec, sendUsdc, sleep, usdcBalance, waitUntil, withShortWindows } from "./shared";

const DEMO_DISPUTE_WINDOW = 30;

function log(step: string, msg: string) {
  console.log(`\n[${step}] ${msg}`);
}

async function main() {
  const adminKp = loadAgentKeypair(); // admin = oracle = creator (demo)
  const challengerKp = derivePersonaKeypair(adminKp, "demo-challenger");
  const oracle = new MimirSolanaClient(adminKp);
  const challenger = new MimirSolanaClient(challengerKp);
  const conn = oracle.baseConnection;

  console.log("Mimir × Solana × MagicBlock ER: full cycle demo (V3)");
  console.log("  program   :", oracle.base.programId.toBase58());
  console.log("  admin     :", adminKp.publicKey.toBase58());
  console.log("  challenger:", challengerKp.publicKey.toBase58());

  const cfg = await oracle.getConfig();
  if (!cfg) throw new Error("program not initialized; run scripts/solana/initialize.ts");
  if (cfg.paused) throw new Error("program is paused");

  // ── 0. Fund the challenger (SOL for fees, 8 USDC from the admin) ───────
  log("0", "funding the demo challenger...");
  if ((await usdcBalance(conn, adminKp.publicKey)) < toUsdcUnits(13)) {
    throw new Error(
      `admin needs 13 USDC. Fund it: https://faucet.circle.com → Solana Devnet → ${adminKp.publicKey.toBase58()}`
    );
  }
  await ensureSol(conn, adminKp, challengerKp.publicKey, 0.05);
  await sendUsdc(conn, adminKp, challengerKp.publicKey, toUsdcUnits(8) - (await usdcBalance(conn, challengerKp.publicKey)));

  // ── 1. Creator opens a claim (base layer) ──────────────────────────────
  const deadline = nowSec() + 150;
  log("1", `creating claim on base layer (5 USDC creator stake, ${DEMO_DISPUTE_WINDOW}s dispute window)...`);
  const { txSig, claimId } = await withShortWindows(oracle, DEMO_DISPUTE_WINDOW, cfg.resolutionGrace, () =>
    oracle.createClaim({
      question: "Will BTC trade above $100,000 right now per Flash Trade oracle?",
      creatorPosition: "Yes: BTC is above $100k",
      counterPosition: "No: BTC is at or below $100k",
      resolutionUrl: "https://flashapi.trade/prices/BTC",
      category: "crypto",
      stakeAmount: toUsdcUnits(5),
      deadline,
      maxChallengers: 8,
    })
  );
  console.log("  claim #" + claimId, explorer(txSig));

  // ── 2. Delegate claim + challenger balance into the ER ─────────────────
  log("2", "depositing challenger USDC into escrow + delegating to the ER...");
  if (await challenger.isBalanceDelegated()) {
    console.log("  balance already in the ER");
  } else {
    console.log("  deposit 8 USDC:", explorer(await challenger.deposit(toUsdcUnits(8))));
    console.log("  balance PDA → ER:", explorer(await challenger.delegateBalance()));
  }
  console.log("  claim PDA   → ER:", explorer(await oracle.delegateClaim(claimId)));
  await sleep(3000); // let delegation settle

  // ── 3. Challenge inside the Ephemeral Rollup ───────────────────────────
  log("3", "challenging inside the ER (zero fee, real-time)...");
  const t0 = Date.now();
  const erSig = await challenger.challengeClaimER(claimId, toUsdcUnits(5));
  console.log(`  ER challenge landed in ${Date.now() - t0}ms: ${explorer(erSig, true)}`);
  const live = await oracle.getClaim(claimId);
  console.log(
    `  live ER state: ${live?.challengers.length} challenger(s), pool = ${fromUsdcUnits(
      (live?.creatorStake ?? 0n) + (live?.totalChallengerStake ?? 0n)
    )} USDC`
  );

  // ── 4. Deadline → commit + undelegate ──────────────────────────────────
  log("4", "waiting for the deadline, then committing the claim back to base...");
  await waitUntil(deadline + 3, "the deadline");
  if (!(await oracle.ensureClaimOnBase(claimId))) throw new Error("claim still delegated");
  console.log("  claim is back on the base layer");

  // ── 5. Oracle proposes ─────────────────────────────────────────────────
  let evidence = "";
  try {
    evidence = await (await fetch("https://flashapi.trade/prices")).text();
  } catch {
    evidence = "demo-evidence-unavailable";
  }
  const evidenceHash = createHash("sha256").update(evidence).digest();
  log("5", "oracle proposes CHALLENGERS_WIN (demo verdict), now disputable...");
  const prop = await oracle.proposeResolution(
    claimId,
    SIDE_CHALLENGERS,
    "Demo verdict: challenger side wins. Evidence fetched from Flash Trade price API.",
    92,
    evidenceHash
  );
  console.log("  " + explorer(prop));
  const proposed = await oracle.getBaseClaim(claimId);
  console.log(`  state ${STATE_LABELS[proposed!.state]}, disputable until ${new Date(proposed!.disputableUntil * 1000).toISOString()}`);

  // ── 6. Finalize after the window ───────────────────────────────────────
  log("6", "no dispute, finalizing once the window closes (permissionless)...");
  await waitUntil(proposed!.disputableUntil + 2, "the dispute window");
  console.log("  " + explorer(await challenger.finalizeResolution(claimId)));

  // ── 7. Payouts ─────────────────────────────────────────────────────────
  log("7", "cranking payouts from the vault...");
  const { paid, failed } = await oracle.crankPayouts(claimId);
  console.log(`  ${paid} leg(s) paid${failed.length ? `, failed: ${failed.join("; ")}` : ""}`);

  const finalClaim = await oracle.getBaseClaim(claimId);
  const won = await usdcBalance(conn, challengerKp.publicKey);
  console.log("\n══════════ RESULT ══════════");
  console.log("  claim state:", STATE_LABELS[finalClaim!.state]);
  console.log("  winner side:", finalClaim?.winnerSide, "(2 = challengers)");
  console.log("  confidence :", finalClaim?.confidence + "%");
  console.log("  fees (0.5% platform on the 5 USDC profit):", fromUsdcUnits(finalClaim!.totalFees), "USDC");
  console.log("  challenger wallet USDC:", fromUsdcUnits(won), "(10 gross − 0.025 fee = 9.975 expected)");
  console.log("  evidence hash:", Buffer.from(finalClaim!.evidenceHash).toString("hex").slice(0, 16) + "…");

  // Sweep the demo wallet back: 3 USDC of free ER balance + its ATA.
  await challenger.undelegateBalance();
  for (let i = 0; i < 20 && (await challenger.isBalanceDelegated()); i++) await sleep(1500);
  const free = await challenger.getBalance();
  if (free > 0n) await challenger.withdraw(free);
  const sweep = await usdcBalance(conn, challengerKp.publicKey);
  await sendUsdc(conn, challengerKp, adminKp.publicKey, sweep);
  console.log(`  swept ${fromUsdcUnits(sweep)} USDC back to the admin`);
  console.log("\nDone. Mimir cycle: base → ER (real-time challenge) → base (propose → finalize → payout). ✅");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
