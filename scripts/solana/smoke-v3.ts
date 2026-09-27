/**
 * Devnet smoke test for the V3 program (~4 minutes, ~14 USDC round-trip).
 *
 *   pause           → create_claim rejected with Paused, then unpaused
 *   claim A (ER)    → delegated + challenged inside the Ephemeral Rollup,
 *                     propose CREATOR → dispute (bond) → settle_dispute
 *                     CHALLENGERS → payouts + bond refund
 *   claim B         → propose CHALLENGERS → finalize (after the window) → payouts
 *   claim C         → no verdict → refund_expired after deadline + grace → refunds
 *   treasury        → withdraw_fees of the platform fees the smoke accrued
 *
 * Short windows (20s dispute, 60s grace) are frozen onto these three claims
 * only; the live config values are restored right after they are created.
 * Admin = oracle = arbiter = creator; the challenger is a derived keypair
 * whose USDC is swept back to the admin at the end.
 *
 * Run: npx tsx --env-file-if-exists=.env.local scripts/solana/smoke-v3.ts
 */
import { Keypair } from "@solana/web3.js";
import { createHash } from "node:crypto";
import { MimirSolanaClient } from "../../lib/solana/client";
import { derivePersonaKeypair, loadAgentKeypair } from "../../lib/solana/keypair";
import {
  BOND_REFUNDED,
  SIDE_CHALLENGERS,
  SIDE_CREATOR,
  SIDE_UNRESOLVABLE,
  ST_DISPUTED,
  ST_PROPOSED,
  ST_RESOLVED,
  fromUsdcUnits,
  toUsdcUnits,
} from "../../lib/solana/config";
import { ensureSol, explorer, nowSec, sendUsdc, sleep, usdcBalance, waitUntil, withRetry, withShortWindows } from "./shared";

const DISPUTE_WINDOW = 20;
const GRACE = 60;
const STAKE = toUsdcUnits(2);

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`  ${ok ? "✓" : "✗ FAIL"} ${what}`);
  if (!ok) failures++;
}

async function expectError(what: string, code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(false, `${what} should fail with ${code}`);
  } catch (err: any) {
    const got = err?.error?.errorCode?.code ?? String(err?.message ?? err);
    check(String(got).includes(code) || String(err).includes(code), `${what} rejected (${code})`);
  }
}

function claimInput(label: string, deadline: number) {
  return {
    question: `[smoke] ${label}: will the V3 lifecycle settle correctly?`,
    creatorPosition: "Yes",
    counterPosition: "No",
    resolutionUrl: "https://flashapi.trade/prices/SOL",
    category: "crypto",
    stakeAmount: STAKE,
    deadline,
    maxChallengers: 4,
  };
}

async function main() {
  const adminKp = loadAgentKeypair();
  const testerKp: Keypair = derivePersonaKeypair(adminKp, "smoke-tester");
  const admin = new MimirSolanaClient(adminKp);
  const tester = new MimirSolanaClient(testerKp);
  const conn = admin.baseConnection;
  const cfg = await admin.getConfig();
  if (!cfg) throw new Error("program not initialized — run scripts/solana/initialize.ts");
  if (!cfg.admin.equals(adminKp.publicKey) || !cfg.oracle.equals(adminKp.publicKey)) {
    throw new Error("smoke needs the admin keypair to also be the oracle");
  }
  console.log("Mimir V3 devnet smoke");
  console.log(`  program ${admin.base.programId.toBase58()}  admin ${adminKp.publicKey.toBase58()}  tester ${testerKp.publicKey.toBase58()}`);
  const solBefore = await conn.getBalance(adminKp.publicKey);
  const feesBefore = cfg.feesAccrued;

  // ── Pause ──────────────────────────────────────────────────────────────
  console.log("\n[pause]");
  await admin.setPaused(true);
  try {
    await expectError("create_claim while paused", "Paused", () => admin.createClaim(claimInput("paused", nowSec() + 600)));
  } finally {
    await withRetry("unpause", () => admin.setPaused(false));
  }
  check(!(await admin.getConfig())!.paused, "unpaused");

  // ── Fund the tester ────────────────────────────────────────────────────
  console.log("\n[fund]");
  await ensureSol(conn, adminKp, testerKp.publicKey, 0.06);
  const need = toUsdcUnits(8) - (await usdcBalance(conn, testerKp.publicKey));
  await sendUsdc(conn, adminKp, testerKp.publicKey, need);
  if ((await tester.getBalance()) < 3n * STAKE) {
    if (await tester.isBalanceDelegated()) throw new Error("tester balance is delegated — undelegate it first");
    console.log("  deposit:", explorer(await tester.deposit(3n * STAKE)));
  }

  // ── Create A, B, C with short frozen windows ───────────────────────────
  console.log("\n[create]");
  const deadline = nowSec() + 180;
  const ids = await withShortWindows(admin, DISPUTE_WINDOW, GRACE, async () => {
    const out: bigint[] = [];
    for (const label of ["A", "B", "C"]) {
      const { claimId, txSig } = await withRetry(`create ${label}`, () => admin.createClaim(claimInput(label, deadline)));
      console.log(`  claim ${label} #${claimId}:`, explorer(txSig));
      out.push(claimId);
    }
    return out;
  });
  const [A, B, C] = ids;
  const a0 = await admin.getBaseClaim(A);
  check(a0?.disputeWindow === DISPUTE_WINDOW && a0?.resolutionGrace === GRACE, "short windows frozen on the claims");
  check((await admin.getConfig())!.disputeWindow === cfg.disputeWindow, "live config windows unchanged");

  // ── Challenges: B, C on base; A inside the ER ──────────────────────────
  console.log("\n[challenge]");
  for (const id of [B, C]) console.log(`  base challenge #${id}:`, explorer(await tester.challengeClaimBase(id, STAKE)));
  console.log("  balance → ER:", explorer(await tester.delegateBalance()));
  console.log("  claim A → ER:", explorer(await admin.delegateClaim(A)));
  await sleep(4000);
  const t0 = Date.now();
  const erSig = await tester.challengeClaimER(A, STAKE);
  await sleep(1500);
  const aLive = await admin.getClaim(A);
  check(aLive?.challengers.length === 1, `ER challenge landed (${Date.now() - t0}ms incl. confirm) — ${erSig}`);

  await waitUntil(deadline + 3, "the deadline");

  // ── A: propose → dispute → settle ──────────────────────────────────────
  console.log("\n[A] propose → dispute → settle_dispute");
  check(await admin.ensureClaimOnBase(A), "claim A undelegated to base");
  const hash = createHash("sha256").update("smoke-evidence").digest();
  console.log("  propose CREATOR:", explorer(await admin.proposeResolution(A, SIDE_CREATOR, "smoke: creator", 70, hash)));
  check((await admin.getBaseClaim(A))?.state === ST_PROPOSED, "A is PROPOSED");
  await expectError("payout before finality", "NotResolved", () => admin.payoutCreator(A));
  console.log("  dispute:", explorer(await tester.disputeResolution(A)));
  check((await admin.getBaseClaim(A))?.state === ST_DISPUTED, "A is DISPUTED (bond posted)");
  console.log("  settle CHALLENGERS:", explorer(await admin.settleDispute(A, SIDE_CHALLENGERS, "smoke: arbiter overturned", 100, hash)));
  const aCrank = await admin.crankPayouts(A);
  const aEnd = await admin.getBaseClaim(A);
  check(aEnd?.state === ST_RESOLVED && aEnd.winnerSide === SIDE_CHALLENGERS, "A RESOLVED for challengers");
  check(aEnd?.bondState === BOND_REFUNDED && aEnd.challengers[0].paid, `A paid + bond refunded (${aCrank.paid} legs)`);

  // ── B: propose → finalize ──────────────────────────────────────────────
  console.log("\n[B] propose → finalize");
  console.log("  propose CHALLENGERS:", explorer(await admin.proposeResolution(B, SIDE_CHALLENGERS, "smoke: challengers", 90, hash)));
  await expectError("finalize inside the window", "DisputeWindowOpen", () => tester.finalizeResolution(B));
  const bProp = await admin.getBaseClaim(B);
  await waitUntil(bProp!.disputableUntil + 2, "B's dispute window");
  console.log("  finalize (by tester, permissionless):", explorer(await tester.finalizeResolution(B)));
  await admin.crankPayouts(B);
  const bEnd = await admin.getBaseClaim(B);
  check(bEnd?.state === ST_RESOLVED && bEnd.challengers[0].paid, "B RESOLVED + paid");
  check(bEnd?.totalFees === 10_000n, `B fee on profit only: ${fromUsdcUnits(bEnd?.totalFees ?? 0n)} USDC`);

  // ── C: refund_expired ──────────────────────────────────────────────────
  console.log("\n[C] refund_expired");
  await expectError("refund before grace", "GraceNotOver", () => tester.refundExpired(C));
  await waitUntil(deadline + GRACE + 2, "C's grace period");
  console.log("  refund_expired (by tester):", explorer(await tester.refundExpired(C)));
  await admin.crankPayouts(C);
  const cEnd = await admin.getBaseClaim(C);
  check(cEnd?.winnerSide === SIDE_UNRESOLVABLE && cEnd.creatorPaid && cEnd.challengers[0].paid, "C refunded to both sides");
  check(cEnd?.totalFees === 0n, "refunds are fee-free");

  // ── Treasury + cleanup ─────────────────────────────────────────────────
  console.log("\n[treasury + cleanup]");
  const cfgEnd = (await admin.getConfig())!;
  const accrued = cfgEnd.feesAccrued - feesBefore;
  check(accrued === 20_000n, `platform fees accrued by the smoke: ${fromUsdcUnits(accrued)} USDC`);
  if (cfgEnd.feesAccrued > 0n) console.log("  withdraw_fees:", explorer(await admin.withdrawFees(cfgEnd.feesAccrued, cfgEnd.feeRecipient)));
  console.log("  undelegate tester balance:", await tester.undelegateBalance());
  for (let i = 0; i < 20 && (await tester.isBalanceDelegated()); i++) await sleep(1500);
  const left = await tester.getBalance();
  if (left > 0n) console.log(`  withdraw ${fromUsdcUnits(left)} USDC:`, explorer(await tester.withdraw(left)));
  const sweep = await usdcBalance(conn, testerKp.publicKey);
  await sendUsdc(conn, testerKp, adminKp.publicKey, sweep);
  console.log(`  swept ${fromUsdcUnits(sweep)} USDC back to admin`);
  const spent = (solBefore - (await conn.getBalance(adminKp.publicKey))) / 1e9;
  console.log(`\nSOL spent by admin (incl. 3 claim accounts' rent + tester top-up): ${spent.toFixed(4)}`);
  console.log(failures === 0 ? "\nSMOKE PASSED ✅" : `\nSMOKE FAILED: ${failures} check(s) ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
