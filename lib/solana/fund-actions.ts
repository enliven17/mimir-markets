"use client";

/**
 * Onboarding's "deposit + delegate" in one call: top up the Mimir virtual
 * balance from the wallet's USDC account (base layer), then delegate the
 * balance PDA to the MagicBlock ER so challenges settle in real time.
 * A balance that is already in the rollup is brought back first (a deposit
 * writes the PDA on the base layer).
 */
import {
  delegateBalance,
  depositUsdc,
  undelegateBalance,
  type BrowserMimir,
} from "./browser-client";
import { balancePda } from "./config";

async function onBase(m: BrowserMimir): Promise<boolean> {
  const info = await m.base.provider.connection.getAccountInfo(balancePda(m.owner));
  return !info || info.owner.equals(m.base.programId);
}

export async function depositAndDelegate(
  m: BrowserMimir,
  units: bigint,
  onStep?: (step: "undelegate" | "deposit" | "delegate") => void,
): Promise<string> {
  if (!(await onBase(m))) {
    onStep?.("undelegate");
    await undelegateBalance(m);
    let back = false;
    for (let i = 0; i < 20 && !back; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      back = await onBase(m);
    }
    if (!back) throw new Error("Your balance is still in the rollup — try again in a minute.");
  }
  onStep?.("deposit");
  await depositUsdc(m, units);
  onStep?.("delegate");
  return delegateBalance(m);
}
