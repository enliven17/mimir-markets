"use client";

import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { MarketAction } from "../chains/calls";
import { MIMIR_PROGRAM_ID, USDC_MINT, balancePda, claimPda } from "./config";
import {
  type BrowserMimir, createClaim, depositUsdc, delegateBalance, challengeInER,
  getVirtualBalance, undelegateBalance, undelegateClaim, withdrawAllBalance, disputeResolution,
} from "./browser-client";

export interface SolanaReceipt { txHash: string; txHashes: string[]; marketId?: number; layer: "base" | "er" }
export const INDEX_SCALE = 1_000_000_000_000n;
export function nativeUnits(index: bigint): bigint {
  if (index < 0n || index % INDEX_SCALE) throw new Error("USDC has 6 decimals: use at most 6 digits after the point.");
  return index / INDEX_SCALE;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function onBase(m: BrowserMimir, key: PublicKey) {
  const info = await m.base.provider.connection.getAccountInfo(key, "confirmed");
  return !info || info.owner.equals(MIMIR_PROGRAM_ID);
}
async function waitForBase(m: BrowserMimir, key: PublicKey) {
  for (let i = 0; i < 20; i++) { if (await onBase(m, key)) return; await sleep(750); }
  throw new Error("The rollup is still returning the account. Your funds remain in the program; try again shortly.");
}

/** Native instructions only. Wallet approval is required for every transaction. */
export async function sendSolanaMarketAction(m: BrowserMimir, a: MarketAction): Promise<SolanaReceipt> {
  const txHashes: string[] = [];
  let marketId: number | undefined;
  let layer: "base" | "er" = "base";
  const token = getAssociatedTokenAddressSync(USDC_MINT, m.owner, true);
  if (a.type === "create") {
    if (a.market.kind !== "vs" || a.market.isPrivate) throw new Error("This devnet program supports public VS markets.");
    const amount = nativeUnits(a.market.stake);
    const held = await m.base.provider.connection.getTokenAccountBalance(token).then((r) => BigInt(r.value.amount)).catch(() => 0n);
    if (held < amount) {
      const withdrawal = await withdrawAllBalance(m);
      if (withdrawal.sig) txHashes.push(withdrawal.sig);
    }
    const created = await createClaim(m, {
      question: a.market.question, creatorPosition: a.market.labelA, counterPosition: a.market.labelB,
      resolutionUrl: a.market.resolutionUrl, category: a.market.category, stakeAmount: amount,
      deadline: a.market.deadline, maxChallengers: 16,
    });
    marketId = Number(created.claimId); txHashes.push(created.txSig);
  } else if (a.type === "stake") {
    if (a.kind !== "vs" || a.side !== 2) throw new Error("A VS challenger takes the counter position.");
    const amount = nativeUnits(a.stake);
    const free = await getVirtualBalance(m);
    if (free < amount) txHashes.push(await depositUsdc(m, amount - free));
    if (await onBase(m, claimPda(a.marketId))) {
      if (!(await onBase(m, balancePda(m.owner)))) {
        txHashes.push(await undelegateBalance(m)); await waitForBase(m, balancePda(m.owner));
      }
      const { BN } = await import("@coral-xyz/anchor");
      txHashes.push(await m.base.methods.challengeClaim(new BN(amount.toString()), null)
        .accounts({ challenger: m.owner, claim: claimPda(a.marketId), balance: balancePda(m.owner) }).rpc());
    } else {
      if (await onBase(m, balancePda(m.owner))) {
        txHashes.push(await delegateBalance(m));
        for (let i = 0; i < 20; i++) {
          const info = await m.er.provider.connection.getAccountInfo(balancePda(m.owner));
          if (info?.owner.equals(MIMIR_PROGRAM_ID)) break;
          await sleep(750);
        }
      }
      txHashes.push(await challengeInER(m, BigInt(a.marketId), amount));
      layer = "er";
    }
  } else if (a.type === "cancel") {
    if (!(await onBase(m, claimPda(a.marketId)))) {
      txHashes.push(await undelegateClaim(m, BigInt(a.marketId))); await waitForBase(m, claimPda(a.marketId));
    }
    txHashes.push(await m.base.methods.cancelClaim().accounts({ creator: m.owner, claim: claimPda(a.marketId), creatorToken: token }).rpc());
  } else if (a.type === "dispute") {
    if (a.kind !== "vs") throw new Error("Unsupported market kind.");
    txHashes.push(await disputeResolution(m, BigInt(a.marketId)));
  } else if (a.type === "withdraw") {
    const r = await withdrawAllBalance(m);
    if (!r.sig) throw new Error("There is no free program balance to withdraw.");
    txHashes.push(r.sig);
  } else {
    throw new Error("VS payouts are sent directly to the participant's token account by the settlement worker.");
  }
  return { txHash: txHashes[txHashes.length - 1], txHashes, layer, ...(marketId === undefined ? {} : { marketId }) };
}
