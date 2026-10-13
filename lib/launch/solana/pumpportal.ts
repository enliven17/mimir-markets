// pump.fun via PumpPortal's Local Transaction API (we sign; PumpPortal never sees a key) and token
// metadata via Pinata.
//
// Docs (verified 2026-10-05):
//   https://pumpportal.fun/local-trading-api/trading-api/  POST https://pumpportal.fun/api/trade-local, JSON
//       {publicKey, action:"buy"|"sell", mint, amount, denominatedInSol:"true"|"false", slippage (percent),
//        priorityFee (SOL), pool}; 200 -> raw serialized VersionedTransaction bytes.
//   https://pumpportal.fun/creation/      action:"create" {tokenMetadata:{name,symbol,uri}, mint:<mint pubkey>,
//       denominatedInSol, amount (dev buy), slippage, priorityFee, pool:"pump"}; tx must be signed by the mint
//       keypair AND the creator. "pump.fun/api/ipfs is no longer supported": upload metadata to IPFS (Pinata).
//   https://pumpportal.fun/creator-fee/   action:"collectCreatorFee" {publicKey, priorityFee}; pump.fun claims all
//       of the creator's fees at once (no mint needed).
//   https://pumpportal.fun/fees/          0.5% fee per Local trade (taken inside PumpPortal's router program).
//   https://docs.pinata.cloud/api-reference/endpoint/upload-a-file.md  POST https://uploads.pinata.cloud/v3/files,
//       Bearer JWT, multipart {file, network:"public"} -> {data:{cid}}.
// Observed (decoded live responses): priorityFee is the TOTAL priority fee in SOL (CU limit x CU price);
// pool "auto" on a migrated coin routes to PumpSwap and adds a top-level System transfer of PumpPortal's
// fee to 7FeFBYbewCqXG7LP6gC8Fnqzk7hmQFMtntXVRqnXi4g6, which our wallet policy rejects, so this module only
// ever uses pool "pump" (bonding curve). Migrated coins go through Jupiter.
import { z } from "zod";
import { assertAddress, assertPositive, assertSlippageBps, errorBody, fetchWithTimeout, SolanaError, toApiAmount, toDecimal, type FetchLike } from "./util";

const TRADE_URL = "https://pumpportal.fun/api/trade-local";
const PINATA_URL = "https://uploads.pinata.cloud/v3/files";
const DEFAULT_GATEWAY = "https://ipfs.io/ipfs";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DATA_URL = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

export type PumpPortalOptions = {
  fetch?: FetchLike;
  pinataJwt?: string;
  ipfsGateway?: string;
  /** Total priority fee per transaction, lamports. */
  priorityFeeLamports: bigint;
  timeoutMs?: number;
};

export type TokenMeta = { name: string; symbol: string; description: string; imageDataUrl: string; website?: string; twitter?: string; telegram?: string };

export function validateMeta(m: TokenMeta): void {
  const bad = (why: string) => new SolanaError("pumpportal", why, { code: "BAD_INPUT" });
  if (typeof m.name !== "string" || !m.name.trim() || m.name.length > 32) throw bad("name must be 1..32 chars");
  if (typeof m.symbol !== "string" || !/^[A-Za-z0-9$]{1,10}$/.test(m.symbol)) throw bad("symbol must be 1..10 letters/digits");
  if (typeof m.description !== "string" || m.description.length > 1000) throw bad("description must be <= 1000 chars");
  for (const u of [m.website, m.twitter, m.telegram]) if (u !== undefined && !/^https:\/\/\S{1,200}$/.test(u)) throw bad("links must be https URLs");
}

const PinataSchema = z.object({ data: z.object({ cid: z.string().regex(/^[A-Za-z0-9]{40,100}$/) }) });

export function createPumpPortal(o: PumpPortalOptions) {
  const doFetch = o.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
  const timeoutMs = o.timeoutMs ?? 20_000;
  const gateway = (o.ipfsGateway || DEFAULT_GATEWAY).replace(/\/+$/, "");
  const priorityFee = toApiAmount(assertPositive("priorityFeeLamports", o.priorityFeeLamports), 9);

  async function pin(file: Blob, name: string): Promise<string> {
    if (!o.pinataJwt) throw new SolanaError("pinata", "PINATA_JWT is not configured", { code: "CONFIG" });
    const form = new FormData();
    form.append("network", "public");
    form.append("file", file, name);
    const res = await fetchWithTimeout(doFetch, "pinata", PINATA_URL, { method: "POST", headers: { authorization: `Bearer ${o.pinataJwt}` }, body: form }, timeoutMs);
    if (!res.ok) throw new SolanaError("pinata", `upload -> ${res.status}: ${await errorBody(res, [o.pinataJwt])}`, { status: res.status });
    const parsed = PinataSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new SolanaError("pinata", "upload returned no cid", { status: res.status });
    return `${gateway}/${parsed.data.data.cid}`;
  }

  async function tradeLocal(body: Record<string, unknown>): Promise<Uint8Array> {
    const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    const res = await fetchWithTimeout(doFetch, "pumpportal", TRADE_URL, init, timeoutMs);
    if (!res.ok) throw new SolanaError("pumpportal", `${body.action} -> ${res.status}: ${await errorBody(res)}`, { status: res.status, notLanded: true });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length < 100 || bytes.length > 1232) throw new SolanaError("pumpportal", `${body.action} returned ${bytes.length} bytes, not a transaction`, { notLanded: true });
    return bytes;
  }

  return {
    /** Uploads the image then the pump.fun-style metadata JSON; returns the metadata URI for create. */
    async uploadMetadata(m: TokenMeta): Promise<{ metadataUri: string; imageUri: string }> {
      validateMeta(m);
      const match = DATA_URL.exec(m.imageDataUrl);
      if (!match) throw new SolanaError("pinata", "imageDataUrl must be a base64 png/jpeg/gif/webp data URL", { code: "BAD_INPUT" });
      const bytes = Buffer.from(match[2], "base64");
      if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new SolanaError("pinata", "image must be 1 byte..4 MB", { code: "BAD_INPUT" });
      const ext = match[1].split("/")[1];
      const imageUri = await pin(new Blob([bytes], { type: match[1] }), `${m.symbol}.${ext}`);
      const meta = { name: m.name, symbol: m.symbol, description: m.description, image: imageUri, showName: true, twitter: m.twitter, telegram: m.telegram, website: m.website };
      const metadataUri = await pin(new Blob([JSON.stringify(meta)], { type: "application/json" }), `${m.symbol}.json`);
      return { metadataUri, imageUri };
    },

    async buildCreateTx(a: { creator: string; mint: string; name: string; symbol: string; metadataUri: string; devBuyLamports: bigint; slippageBps: number }): Promise<Uint8Array> {
      if (typeof a.devBuyLamports !== "bigint" || a.devBuyLamports < BigInt(0)) throw new SolanaError("pumpportal", "devBuyLamports must be a bigint >= 0", { code: "BAD_INPUT" });
      if (!/^https:\/\/\S{1,190}$/.test(a.metadataUri)) throw new SolanaError("pumpportal", "metadataUri must be an https URL <= 190 chars", { code: "BAD_INPUT" });
      return tradeLocal({
        publicKey: assertAddress("creator", a.creator),
        action: "create",
        tokenMetadata: { name: a.name, symbol: a.symbol, uri: a.metadataUri },
        mint: assertAddress("mint", a.mint),
        denominatedInSol: "true",
        amount: Number(toDecimal(a.devBuyLamports, 9)),
        slippage: assertSlippageBps(a.slippageBps) / 100,
        priorityFee,
        pool: "pump",
      });
    },

    /** Bonding-curve trade. Buy `amount` = lamports; sell `amount` = raw token units, or "all" (sends "100%"). */
    async buildTradeTx(a: { wallet: string; mint: string; side: "buy" | "sell"; amount: bigint | "all"; decimals: number; slippageBps: number }): Promise<Uint8Array> {
      if (a.side === "buy" && a.amount === "all") throw new SolanaError("pumpportal", "buy amount must be lamports", { code: "BAD_INPUT" });
      if (!Number.isInteger(a.decimals) || a.decimals < 0 || a.decimals > 12) throw new SolanaError("pumpportal", "decimals out of range", { code: "BAD_INPUT" });
      const amount = a.amount === "all" ? "100%" : toApiAmount(assertPositive("amount", a.amount), a.side === "buy" ? 9 : a.decimals);
      return tradeLocal({
        publicKey: assertAddress("wallet", a.wallet),
        action: a.side,
        mint: assertAddress("mint", a.mint),
        amount,
        denominatedInSol: a.side === "buy" ? "true" : "false",
        slippage: assertSlippageBps(a.slippageBps) / 100,
        priorityFee,
        pool: "pump",
      });
    },

    async buildCollectFeeTx(a: { wallet: string }): Promise<Uint8Array> {
      return tradeLocal({ publicKey: assertAddress("wallet", a.wallet), action: "collectCreatorFee", priorityFee });
    },
  };
}

export type PumpPortal = ReturnType<typeof createPumpPortal>;
