/**
 * An agent's own token, optional, launched and paid for by its owner. Two steps, both signed by the owner:
 *   1. prepare: the server builds the launch transaction with the owner's wallet as creator (Argus on Arc: params, a
 *      mined hook salt and a simulation from the owner; Clanker v4 on Base: the SDK's deploy call with the owner as
 *      token admin and only reward recipient). The token image is pinned to IPFS. Nothing is sent.
 *   2. the owner's wallet signs and sends it, paying the gas; then record: the server reads the receipt and keeps the
 *      token only if the sender is the agent's owner and the launch event names the owner as creator and the agent's
 *      ticker as the symbol.
 * Every creator fee goes to the owner, who claims from their own wallet (components/launch/TokenFees.tsx). Mimir
 * takes no share and holds nothing. Chain access is injected, so the checks run in tests.
 */
import { getAddress, type Address, type Hex, type Log } from "viem";
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import { ARGUS, decodeLaunch, launchParams, type ArgusParams } from "./argus";
import { decodeClankerLaunch } from "./base/clanker";
import type { DeployTx } from "./base/deploy";
import type { Cx } from "./request";

export type TokenChain = "arc" | "base";
/** Convex documents are capped at 1 MB and request bodies are bounded: an uploaded image stays well under both. */
const MAX_IMAGE_CHARS = 700_000;

export const TokenPrepareBody = z.object({
  chain: z.enum(["arc", "base"]),
  description: z.string().max(280).default(""),
  /** Optional: without one, the token image is the agent's face (token-image.tsx). */
  image: z.string().regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/).max(MAX_IMAGE_CHARS, "Image is too large (about 500 KB max).").optional(),
  /** Argus only: the per-side tax, 0 to 10% each, not both 0. */
  argus: z.object({ buyTaxBps: z.number().int().min(0).max(ARGUS.maxTaxBps), sellTaxBps: z.number().int().min(0).max(ARGUS.maxTaxBps) }).strict().optional(),
})
  .refine((b) => b.chain !== "arc" || (b.argus !== undefined && b.argus.buyTaxBps + b.argus.sellTaxBps > 0), { message: "An Argus token needs a buy or sell tax above 0.", path: ["argus"] });
export type TokenPrepareInput = z.infer<typeof TokenPrepareBody>;

export const TokenRecordBody = z.object({ chain: z.enum(["arc", "base"]), tx: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

/** What the browser sends from the owner's wallet: value as a 0x hex string. */
export interface LaunchTx {
  chain: TokenChain;
  chainId: number;
  to: Address;
  data: Hex;
  value: Hex;
  /** The token address the launch will produce, when known in advance. */
  token: Address | null;
}

export interface PrepareDeps {
  image: (avatarSeed: string) => Promise<string>;
  pin: (dataUrl: string, name: string) => Promise<string>;
  /** Argus: the Portal's predictions, a mined hook salt and a simulation from `creator` (throws if it would revert). */
  argus: (creator: Address, agentUid: string, params: ArgusParams) => Promise<{ data: Hex; token: Address }>;
  arcChainId: number;
  clanker: (a: { owner: string; name: string; symbol: string; image: string; description: string; website: string; slug: string }) => Promise<DeployTx>;
  site: string;
}

type Fail = { ok: false; status: number; error: string };

async function ownedAgent({ client, secret }: Cx, owner: string, id: string) {
  const a = await client.query(api.launch.forOwner, { secret, slug: id });
  if (!a || a.owner.toLowerCase() !== owner.toLowerCase()) return { ok: false as const, status: 404, error: "No such agent." };
  return { ok: true as const, a };
}

export async function prepareTokenLaunch(cx: Cx, deps: PrepareDeps, owner: string, id: string, input: TokenPrepareInput): Promise<({ ok: true } & LaunchTx) | Fail> {
  const got = await ownedAgent(cx, owner, id);
  if (!got.ok) return got;
  const a = got.a;
  if (a.token) return { ok: false, status: 409, error: `$${a.ticker} already has a token.` };
  if (a.status === "killed") return { ok: false, status: 409, error: "This agent is shut down." };
  const creator = getAddress(owner);
  let imageURI: string;
  try {
    imageURI = await deps.pin(input.image ?? (await deps.image(a.avatarSeed)), `${a.ticker}.png`);
  } catch (e) {
    console.error("token image:", e);
    return { ok: false, status: 502, error: "Could not upload the token image. Try again." };
  }
  const website = `${deps.site}/launch/${id}`;
  if (input.chain === "arc") {
    try {
      const params = launchParams({ name: a.name, symbol: a.ticker, description: input.description, imageURI, website, ...input.argus! });
      const prep = await deps.argus(creator, a.uid, params);
      return { ok: true, chain: "arc", chainId: deps.arcChainId, to: ARGUS.portal, data: prep.data, value: "0x0", token: prep.token };
    } catch (e) {
      console.error("argus prepare:", e);
      return { ok: false, status: 502, error: "Argus would reject this launch right now (your wallet may already have launched this token, or needs a little USDC for gas). Try again later." };
    }
  }
  try {
    const tx = await deps.clanker({ owner: creator, name: a.name, symbol: a.ticker, image: imageURI, description: input.description, website, slug: id });
    return { ok: true, chain: "base", chainId: 8453, to: tx.to, data: tx.data, value: `0x${tx.value.toString(16)}`, token: tx.expectedAddress };
  } catch (e) {
    console.error("clanker prepare:", e);
    return { ok: false, status: 502, error: "Could not build the Clanker launch. Try again." };
  }
}

export interface ReceiptReader {
  getTransaction(a: { hash: Hex }): Promise<{ from: Address }>;
  getTransactionReceipt(a: { hash: Hex }): Promise<{ status: "success" | "reverted"; logs: readonly Pick<Log, "address" | "data" | "topics">[] }>;
}

export type VerifiedToken = { ok: true; token: { chain: TokenChain; address: string; splitter?: string; launchTx: string } } | Fail;

/**
 * The launch tx, checked from the chain: it succeeded, the agent's owner sent it, and the launchpad's own event names
 * the owner as creator (Argus) or token admin (Clanker), with the agent's ticker as the symbol.
 */
export async function verifyTokenLaunch(reader: ReceiptReader, a: { chain: TokenChain; tx: string; owner: string; ticker: string }): Promise<VerifiedToken> {
  const hash = a.tx.toLowerCase() as Hex;
  let tx, receipt;
  try {
    [tx, receipt] = await Promise.all([reader.getTransaction({ hash }), reader.getTransactionReceipt({ hash })]);
  } catch {
    return { ok: false, status: 404, error: "Transaction not found yet. Try again in a few seconds." };
  }
  if (receipt.status !== "success") return { ok: false, status: 400, error: "That launch failed on chain." };
  const owner = a.owner.toLowerCase();
  if (tx.from.toLowerCase() !== owner) return { ok: false, status: 403, error: "That launch was not sent from the agent owner's wallet." };
  const symbolOk = (s: string) => s.toUpperCase() === a.ticker.toUpperCase();
  if (a.chain === "arc") {
    const l = decodeLaunch(receipt.logs);
    if (!l) return { ok: false, status: 400, error: "That transaction is not an Argus launch." };
    if (l.creator.toLowerCase() !== owner) return { ok: false, status: 403, error: "The token's creator is not the agent owner." };
    if (!symbolOk(l.symbol)) return { ok: false, status: 400, error: `That token is not $${a.ticker}.` };
    return { ok: true, token: { chain: "arc", address: getAddress(l.token), splitter: getAddress(l.splitter), launchTx: hash } };
  }
  const c = decodeClankerLaunch(receipt.logs);
  if (!c) return { ok: false, status: 400, error: "That transaction is not a Clanker launch." };
  if (c.admin.toLowerCase() !== owner || c.sender.toLowerCase() !== owner) return { ok: false, status: 403, error: "The token's admin is not the agent owner." };
  if (!symbolOk(c.symbol)) return { ok: false, status: 400, error: `That token is not $${a.ticker}.` };
  return { ok: true, token: { chain: "base", address: getAddress(c.token), launchTx: hash } };
}

/** Step 2: verify the owner's launch tx, then keep the token on the agent. Idempotent for the same token. */
export async function recordTokenLaunch(cx: Cx, readers: Record<TokenChain, ReceiptReader>, owner: string, id: string, body: z.infer<typeof TokenRecordBody>) {
  const got = await ownedAgent(cx, owner, id);
  if (!got.ok) return got;
  const a = got.a;
  const v = await verifyTokenLaunch(readers[body.chain], { chain: body.chain, tx: body.tx, owner, ticker: a.ticker });
  if (!v.ok) return v;
  if (a.token) {
    return a.token.address.toLowerCase() === v.token.address.toLowerCase()
      ? { ok: true as const, token: a.token }
      : { ok: false as const, status: 409, error: `$${a.ticker} already has a token.` };
  }
  const r = await cx.client.mutation(api.launch.recordToken, { secret: cx.secret, slug: id, owner: a.owner, token: v.token });
  if (r !== "ok") return { ok: false as const, status: 409, error: r === "taken" ? "That token already belongs to another agent." : `$${a.ticker} already has a token.` };
  return { ok: true as const, token: v.token };
}
