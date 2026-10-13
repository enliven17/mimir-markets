// Jupiter Swap API V2, Router path (Metis only -> Jupiter v6 program, which the wallet policy allows).
// The Meta-Aggregator path (/order) is NOT used: it can route through JupiterZ/Dflow/OKX programs and
// market-maker co-signers that a program allow-list policy would (correctly) reject.
//
// Docs (verified 2026-10-05):
//   https://developers.jup.ag/docs/swap/index.md            base https://api.jup.ag/swap/v2, x-api-key header
//       (keyless allowed at 0.5 RPS on api.jup.ag; production should use a key).
//   https://developers.jup.ag/docs/swap/build/index.md       GET /build?inputMint&outputMint&amount&taker&slippageBps
//       -> {inAmount, outAmount, otherAmountThreshold, computeBudgetInstructions (CU price only),
//           setupInstructions, swapInstruction, cleanupInstruction, otherInstructions, tipInstruction,
//           addressesByLookupTableAddress, blockhashWithMetadata:{blockhash:number[32], lastValidBlockHeight}}.
//   https://developers.jup.ag/docs/swap/advanced/compute-units.md  simulate with 1.4M CU, then set limit to 1.2x used.
//   https://developers.jup.ag/docs/openapi-spec/swap/v2/swap.yaml  computeUnitPricePercentile, wrapAndUnwrapSol (default true).
//   https://developers.jup.ag/docs/swap/migration/metis-to-build.md  /swap/v1 quote+swap is the legacy path.
import { AddressLookupTableAccount, ComputeBudgetProgram, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { z } from "zod";
import { assertAddress, assertPositive, assertSlippageBps, errorBody, fetchWithTimeout, SolanaError, type FetchLike } from "./util";

export const WSOL_MINT = "So11111111111111111111111111111111111111112";
const BASE_URL = "https://api.jup.ag/swap/v2";
export const CU_LIMIT_MAX = 1_400_000;

const Ix = z.object({
  programId: z.string(),
  accounts: z.array(z.object({ pubkey: z.string(), isSigner: z.boolean(), isWritable: z.boolean() })),
  data: z.string(),
});
const BuildSchema = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: z.string().regex(/^\d+$/),
  outAmount: z.string().regex(/^\d+$/),
  otherAmountThreshold: z.string().regex(/^\d+$/),
  computeBudgetInstructions: z.array(Ix),
  setupInstructions: z.array(Ix),
  swapInstruction: Ix,
  cleanupInstruction: Ix.nullable().optional(),
  otherInstructions: z.array(Ix).optional().default([]),
  tipInstruction: Ix.nullable().optional(),
  addressesByLookupTableAddress: z.record(z.string(), z.array(z.string())).nullable().optional(),
  blockhashWithMetadata: z.object({ blockhash: z.array(z.number().int().min(0).max(255)).length(32), lastValidBlockHeight: z.number().int().positive() }),
});
export type JupiterBuild = z.infer<typeof BuildSchema> & { taker: string };

export type JupiterOptions = {
  fetch?: FetchLike;
  apiKey?: string;
  /** "medium" | "high" | "veryHigh" or 0..10000 bps percentile. */
  cuPricePercentile?: string;
  timeoutMs?: number;
};

export function createJupiter(o: JupiterOptions = {}) {
  const doFetch = o.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const timeoutMs = o.timeoutMs ?? 15_000;

  return {
    /** Quote plus raw instructions (ExactIn). `amount` is raw units of inputMint. */
    async quote(a: { inputMint: string; outputMint: string; amount: bigint; taker: string; slippageBps: number }): Promise<JupiterBuild> {
      const params = new URLSearchParams({
        inputMint: assertAddress("inputMint", a.inputMint),
        outputMint: assertAddress("outputMint", a.outputMint),
        amount: assertPositive("amount", a.amount).toString(),
        taker: assertAddress("taker", a.taker),
        slippageBps: String(assertSlippageBps(a.slippageBps)),
        ...(o.cuPricePercentile ? { computeUnitPricePercentile: o.cuPricePercentile } : {}),
      });
      const headers: Record<string, string> = o.apiKey ? { "x-api-key": o.apiKey } : {};
      const res = await fetchWithTimeout(doFetch, "jupiter", `${BASE_URL}/build?${params}`, { method: "GET", headers }, timeoutMs);
      if (!res.ok) throw new SolanaError("jupiter", `build -> ${res.status}: ${await errorBody(res, [o.apiKey])}`, { status: res.status, notLanded: true });
      const parsed = BuildSchema.safeParse(await res.json().catch(() => null));
      if (!parsed.success) throw new SolanaError("jupiter", `build returned an unexpected body: ${parsed.error.issues[0]?.message}`, { notLanded: true });
      const b = parsed.data;
      if (b.inputMint !== a.inputMint || b.outputMint !== a.outputMint || BigInt(b.inAmount) !== a.amount) {
        throw new SolanaError("jupiter", "build response does not match the request", { notLanded: true });
      }
      return { ...b, taker: a.taker };
    },

    /** Assembles the unsigned v0 transaction. Priority fee is capped at `maxPriorityFeeLamports`. */
    swapTx(b: JupiterBuild, o2: { cuLimit: number; maxPriorityFeeLamports: bigint }): { tx: VersionedTransaction; lastValidBlockHeight: number } {
      if (b.tipInstruction) throw new SolanaError("jupiter", "unexpected tip instruction", { notLanded: true });
      const cuLimit = Math.min(Math.max(Math.ceil(o2.cuLimit), 50_000), CU_LIMIT_MAX);
      const requested = b.computeBudgetInstructions.map(cuPriceOf).find((p) => p !== null) ?? BigInt(0);
      const cap = (o2.maxPriorityFeeLamports * BigInt(1_000_000)) / BigInt(cuLimit);
      const price = requested < cap ? requested : cap;
      const ixs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }),
        ...b.setupInstructions.map(toIx),
        toIx(b.swapInstruction),
        ...(b.cleanupInstruction ? [toIx(b.cleanupInstruction)] : []),
        ...b.otherInstructions.map(toIx),
      ];
      const alts = Object.entries(b.addressesByLookupTableAddress ?? {}).map(
        ([key, addrs]) =>
          new AddressLookupTableAccount({
            key: new PublicKey(key),
            state: { deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: addrs.map((x) => new PublicKey(x)) },
          }),
      );
      const message = new TransactionMessage({
        payerKey: new PublicKey(b.taker),
        recentBlockhash: bs58.encode(Uint8Array.from(b.blockhashWithMetadata.blockhash)),
        instructions: ixs,
      }).compileToV0Message(alts);
      return { tx: new VersionedTransaction(message), lastValidBlockHeight: b.blockhashWithMetadata.lastValidBlockHeight };
    },
  };
}

function toIx(ix: z.infer<typeof Ix>): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(ix.data, "base64"),
  });
}

/** SetComputeUnitPrice = [3, u64 LE microLamports]; anything else (e.g. a limit) -> null. */
function cuPriceOf(ix: z.infer<typeof Ix>): bigint | null {
  if (ix.programId !== ComputeBudgetProgram.programId.toBase58()) return null;
  const d = Buffer.from(ix.data, "base64");
  return d.length === 9 && d[0] === 3 ? d.readBigUInt64LE(1) : null;
}

export type Jupiter = ReturnType<typeof createJupiter>;
