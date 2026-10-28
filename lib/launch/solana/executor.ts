// Executor (lib/server/ports.ts): buys/sells from a Privy server wallet. Routing: pump.fun bonding curve
// via PumpPortal while the curve is live, Jupiter (Metis, /swap/v2/build) once the coin has migrated or
// for any non-pump token. Fills are measured from the confirmed transaction.
//
// Curve state (verified on mainnet 2026-10-05): PDA ["bonding-curve", mint] under pump.fun
// 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P; Anchor discriminator sha256("account:BondingCurve")[0..8]
// = 17b7f83760d8ac60; `complete` is the bool at byte 48 (after 5 u64 reserves/supply fields).
// pump.fun coins are now Token-2022 mints (create_v2), so the token program is read from the mint owner.
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import type { Executor, Fill, TradeArgs } from "../ports";
import { buySpendCeiling } from "../spend-ceiling";
import type { Jupiter } from "./jupiter";
import { CU_LIMIT_MAX, WSOL_MINT } from "./jupiter";
import { createOps } from "./ops";
import { ALLOWED_PROGRAMS, PROGRAMS, wsolAccount } from "./policy";
import type { Privy } from "./privy";
import type { Meteora } from "./meteora";
import type { PumpPortal } from "./pumpportal";
import { createSubmitter, simulationGuard, type Conn, type Endpoints, type RetryEvent, type Unsigned } from "./submit";
import { lockedMintsOf } from "./locks";
import { resolveLookups } from "./alt";
import { fillFrom, inspectTx, walletDeltas, type SendOptions } from "./tx";
import { assertAddress, assertPositive, assertSlippageBps, SolanaError } from "./util";

export const RESERVE_LAMPORTS = BigInt(10_000_000); // 0.01 SOL kept for fees and rent
/** A sell's network + priority fees may eat this much of its minimum proceeds (M5). */
export const SELL_FEE_ALLOWANCE = BigInt(5_000_000);
/** pump.fun protocol + creator fees and PumpPortal's 0.5%, as a margin on the curve price (bps). */
const CURVE_FEE_BPS = 300;
const CURVE_DISCRIMINATOR = Buffer.from("17b7f83760d8ac60", "hex");

export type ExecutorDeps = {
  privy: Pick<Privy, "signTransaction">;
  connection: Conn;
  pumpportal: PumpPortal;
  meteora?: Meteora | null;
  jupiter: Jupiter;
  reserveLamports?: bigint;
  /** Cap on the Jupiter priority fee (lamports per tx). */
  maxPriorityFeeLamports?: bigint;
  send?: SendOptions;
  maxAttempts?: number;
  onRetry?: (e: RetryEvent) => void;
  /** Own token(s) of a wallet: never sold or moved (default: the process lock registry). */
  lockedMints?: (wallet: string) => readonly string[] | Promise<readonly string[]>;
  /** H1: the endpoint each transaction is pinned to (lib/solana/rpc-pool stickyPool). */
  endpoints?: Endpoints;
};

export type Route = "curve" | "jupiter";

export function createExecutor(d: ExecutorDeps): Executor & ReturnType<typeof createOps> & { route(mint: string): Promise<Route>; tokenBalance(wallet: string, mint: string): Promise<bigint>; buildUserTrade(a: { wallet: string; mint: string; side: "buy" | "sell"; amount: bigint; slippageBps: number }): Promise<string> } {
  const conn = d.connection;
  const reserve = d.reserveLamports ?? RESERVE_LAMPORTS;
  const maxFee = d.maxPriorityFeeLamports ?? BigInt(1_000_000);
  const lockedMints = d.lockedMints ?? lockedMintsOf;
  const submitter = createSubmitter({ privy: d.privy, connection: conn, send: d.send, maxAttempts: d.maxAttempts, onRetry: d.onRetry, lockedMints, endpoints: d.endpoints });

  const curvePda = (mint: string) => PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(mint).toBuffer()], new PublicKey(PROGRAMS.pump))[0];

  /**
   * The wallet's own token(s): the agent record's mint passed by the caller plus the registry (filled
   * from the same DB records). NEVER inferred from chain data: pump.fun's create takes `creator` as an
   * argument, so anyone can launch a coin naming any wallet as creator (H2).
   */
  async function ownMints(wallet: string, ownMint?: string | null): Promise<string[]> {
    return [...new Set([...(await lockedMints(wallet)), ...(ownMint ? [ownMint] : [])])];
  }

  /** pump.fun bonding-curve creator (Pubkey at bytes 49..81, after `complete`), or null. */
  async function curveCreator(mint: string): Promise<string | null> {
    const acc = await conn.getAccountInfo(curvePda(mint), "confirmed");
    if (!acc || acc.owner.toBase58() !== PROGRAMS.pump || acc.data.length < 81 || !acc.data.subarray(0, 8).equals(CURVE_DISCRIMINATOR)) return null;
    return new PublicKey(acc.data.subarray(49, 81)).toBase58();
  }

  /** Live curve reserves (virtual token @8, virtual SOL @16, complete @48), or null when not a live pump.fun curve. */
  async function liveCurve(mint: string): Promise<{ vTokens: bigint; vSol: bigint } | null> {
    const acc = await conn.getAccountInfo(curvePda(mint), "confirmed");
    if (!acc || !acc.owner.equals(new PublicKey(PROGRAMS.pump)) || acc.data.length < 49 || !acc.data.subarray(0, 8).equals(CURVE_DISCRIMINATOR)) return null;
    if (acc.data[48] !== 0) return null;
    return { vTokens: acc.data.readBigUInt64LE(8), vSol: acc.data.readBigUInt64LE(16) };
  }

  async function route(mint: string): Promise<Route> {
    return (await liveCurve(mint)) ? "curve" : "jupiter";
  }

  /** M5: least SOL a sell may bring back: the quote's minimum (after slippage and fees) less the tx fee allowance. */
  const minSolIn = (minOut: bigint) => minOut - SELL_FEE_ALLOWANCE;
  const curveMinOut = (c: { vTokens: bigint; vSol: bigint }, tokens: bigint, slippageBps: number) =>
    c.vTokens + tokens === BigInt(0) ? BigInt(0) : (((tokens * c.vSol) / (c.vTokens + tokens)) * BigInt(Math.max(0, 10_000 - slippageBps - CURVE_FEE_BPS))) / BigInt(10_000);
  /** Least tokens a curve buy of `lamports` may bring: the curve's price less slippage and fees. */
  const curveMinTokens = (c: { vTokens: bigint; vSol: bigint }, lamports: bigint, slippageBps: number) =>
    c.vSol + lamports === BigInt(0) ? BigInt(0) : (((lamports * c.vTokens) / (c.vSol + lamports)) * BigInt(Math.max(0, 10_000 - slippageBps - CURVE_FEE_BPS))) / BigInt(10_000);
  /** Spend ceiling of a buy: the amount + 5% for curve/pool fees + 0.02 SOL for rent and priority. */
  const buyCeiling = buySpendCeiling;

  async function mintInfo(mint: string): Promise<{ program: PublicKey; decimals: number }> {
    const acc = await conn.getAccountInfo(new PublicKey(mint), "confirmed");
    const owner = acc?.owner.toBase58();
    if (!acc || (owner !== PROGRAMS.token && owner !== PROGRAMS.token2022) || acc.data.length < 82) {
      throw new SolanaError("solana", `${mint} is not an SPL mint`, { code: "BAD_INPUT" });
    }
    return { program: acc.owner, decimals: acc.data[44] };
  }

  async function tokenBalance(wallet: string, mint: string, program: PublicKey): Promise<bigint> {
    const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(wallet), false, program);
    try {
      return BigInt((await conn.getTokenAccountBalance(ata, "confirmed")).value.amount);
    } catch (err) {
      if (/could not find account|invalid param/i.test(err instanceof Error ? err.message : String(err))) return BigInt(0);
      throw err;
    }
  }

  async function spendable(wallet: string): Promise<bigint> {
    const bal = BigInt(await conn.getBalance(new PublicKey(assertAddress("wallet", wallet)), "confirmed"));
    return bal > reserve ? bal - reserve : BigInt(0);
  }

  /** Jupiter: quote -> simulate at max CU -> rebuild at 1.2x consumed (Jupiter's documented pattern). */
  async function jupiterTx(a: { inputMint: string; outputMint: string; amount: bigint; wallet: string; slippageBps: number }): Promise<Unsigned & { minOut: bigint }> {
    const build = await d.jupiter.quote({ inputMint: a.inputMint, outputMint: a.outputMint, amount: a.amount, taker: a.wallet, slippageBps: a.slippageBps });
    const probe = d.jupiter.swapTx(build, { cuLimit: CU_LIMIT_MAX, maxPriorityFeeLamports: maxFee });
    const sim = await conn.simulateTransaction(probe.tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
    if (sim.value.err) throw new SolanaError("jupiter", `swap simulation failed: ${JSON.stringify(sim.value.err)}`, { notLanded: true });
    const used = sim.value.unitsConsumed ?? CU_LIMIT_MAX;
    return { ...d.jupiter.swapTx(build, { cuLimit: Math.ceil(used * 1.2), maxPriorityFeeLamports: maxFee }), minOut: BigInt(build.otherAmountThreshold) };
  }

  const fromBytes = (bytes: Uint8Array): Unsigned => ({ tx: VersionedTransaction.deserialize(bytes) });

  async function buy(a: TradeArgs & { lamports: bigint }): Promise<Fill> {
    const wallet = assertAddress("wallet", a.wallet);
    const mint = assertAddress("mint", a.mint);
    const lamports = assertPositive("lamports", a.lamports);
    const slippageBps = assertSlippageBps(a.slippageBps);
    const own = await ownMints(wallet, a.ownMint);
    // H2: a coin whose curve names this wallet as creator but is not the agent's own (DB) mint is bait.
    if (!own.includes(mint) && (await curveCreator(mint)) === wallet) {
      throw new SolanaError("solana", `${mint} names this wallet as creator but is not the agent's token: refused`, { code: "FOREIGN_CREATOR", notLanded: true });
    }
    if (lamports > (await spendable(wallet))) throw new SolanaError("solana", "buy exceeds spendable SOL", { code: "INSUFFICIENT" });
    return submitter.run(
      `buy ${mint}`,
      async () => {
        const unsigned =
          (await route(mint)) === "curve"
            ? fromBytes(await d.pumpportal.buildTradeTx({ wallet, mint, side: "buy", amount: lamports, decimals: 9, slippageBps }))
            : await jupiterTx({ inputMint: WSOL_MINT, outputMint: mint, amount: lamports, wallet, slippageBps });
        // allowLockedTouch: a buyback buys the own token; the submitter still refuses any decrease of it.
        return { walletId: a.walletId, wallet, unsigned: { ...unsigned, maxSolOut: buyCeiling(lamports), allowLockedTouch: true, lockedMints: own, protectMints: [...(a.protect ?? []), mint], onSigned: a.onSigned } };
      },
      (tx) => fillFrom(walletDeltas(tx, wallet, mint), "buy"),
    );
  }

  async function sell(a: TradeArgs & { tokens: bigint }): Promise<Fill> {
    const wallet = assertAddress("wallet", a.wallet);
    const mint = assertAddress("mint", a.mint);
    const tokens = assertPositive("tokens", a.tokens);
    const slippageBps = assertSlippageBps(a.slippageBps);
    const own = await ownMints(wallet, a.ownMint);
    if (own.includes(mint)) throw new SolanaError("solana", "the agent's own token is locked: it can only be burned, never sold", { code: "OWN_TOKEN_LOCKED", notLanded: true });
    const { program, decimals } = await mintInfo(mint);
    return submitter.run(
      `sell ${mint}`,
      async () => {
        const held = await tokenBalance(wallet, mint, program);
        if (held <= BigInt(0)) throw new SolanaError("solana", `wallet holds no ${mint}`, { code: "NO_BALANCE" });
        const amount = tokens < held ? tokens : held; // never ask to sell more than is held
        const curve = await liveCurve(mint);
        let unsigned: Unsigned;
        let minOut: bigint;
        if (curve) {
          unsigned = fromBytes(await d.pumpportal.buildTradeTx({ wallet, mint, side: "sell", amount: amount === held ? "all" : amount, decimals, slippageBps }));
          minOut = curveMinOut(curve, amount, slippageBps);
        } else {
          const j = await jupiterTx({ inputMint: mint, outputMint: WSOL_MINT, amount, wallet, slippageBps });
          unsigned = j;
          minOut = j.minOut;
        }
        const protect = (a.protect ?? []).filter((m) => m !== mint);
        return { walletId: a.walletId, wallet, unsigned: { ...unsigned, lockedMints: own, protectMints: protect, spend: { mint, amount }, minSolIn: minSolIn(minOut) } };
      },
      (tx) => fillFrom(walletDeltas(tx, wallet, mint), "sell"),
    );
  }

  /**
   * A trade for a USER's own wallet (buy/sell panel, dev buy): built here, signed and sent by the
   * user's wallet extension. No Privy, no custody; returns the unsigned tx, base64.
   * Before it is handed out (a compromised builder must not give a member a draining tx): the
   * lookup-table accounts are resolved from chain and the full account list is inspected (programs,
   * signers, SOL only into the wallet's own WSOL account, no token approvals/transfers), then the tx
   * is simulated against the member's wallet: SOL out and tokens in (buy), or tokens out and SOL in
   * (sell) must match the quote within slippage.
   */
  async function buildUserTrade(a: { wallet: string; mint: string; side: "buy" | "sell"; amount: bigint; slippageBps: number }): Promise<string> {
    const wallet = assertAddress("wallet", a.wallet);
    const mint = assertAddress("mint", a.mint);
    const amount = assertPositive("amount", a.amount);
    const slippageBps = assertSlippageBps(a.slippageBps);
    const curve = await liveCurve(mint);
    let tx: VersionedTransaction;
    let expect: Omit<Unsigned, "tx">;
    if (a.side === "buy") {
      if (curve) {
        tx = fromBytes(await d.pumpportal.buildTradeTx({ wallet, mint, side: "buy", amount, decimals: 9, slippageBps })).tx;
        expect = { maxSolOut: buyCeiling(amount), minTokensIn: { mint, amount: curveMinTokens(curve, amount, slippageBps) } };
      } else {
        const j = await jupiterTx({ inputMint: WSOL_MINT, outputMint: mint, amount, wallet, slippageBps });
        tx = j.tx;
        expect = { maxSolOut: buyCeiling(amount), minTokensIn: { mint, amount: j.minOut } };
      }
    } else {
      const { decimals } = await mintInfo(mint);
      if (curve) {
        tx = fromBytes(await d.pumpportal.buildTradeTx({ wallet, mint, side: "sell", amount, decimals, slippageBps })).tx;
        expect = { spend: { mint, amount }, minSolIn: minSolIn(curveMinOut(curve, amount, slippageBps)) };
      } else {
        const j = await jupiterTx({ inputMint: mint, outputMint: WSOL_MINT, amount, wallet, slippageBps });
        tx = j.tx;
        expect = { spend: { mint, amount }, minSolIn: minSolIn(j.minOut) };
      }
    }
    inspectTx(tx, { feePayer: wallet, allowedPrograms: [...ALLOWED_PROGRAMS, PROGRAMS.system], allowedTransferTo: [wsolAccount(wallet)], loaded: await resolveLookups(conn, tx) });
    await simulationGuard(conn, tx, wallet, expect, []);
    return Buffer.from(tx.serialize()).toString("base64");
  }

  const ops = createOps({ connection: conn, pumpportal: d.pumpportal, meteora: d.meteora, submitter, mintInfo, tokenBalance });
  /** The wallet's raw balance of `mint` (0 when it has no account). */
  async function walletTokenBalance(wallet: string, mint: string): Promise<bigint> {
    const { program } = await mintInfo(assertAddress("mint", mint));
    return tokenBalance(assertAddress("wallet", wallet), mint, program);
  }

  return { buy, sell, spendable, route, buildUserTrade, tokenBalance: walletTokenBalance, ...ops };
}
