/**
 * POST /api/launch/:id/launch { sig }: step 2, signed by the owner. Verify the funding tx, then the agent mints its token:
 * a Solana signature for a pump.fun agent, a 0x hash for a Robinhood (Pons) agent.
 */
import { createPublicClient, http } from "viem";
import { z } from "zod";

import { defaultTokenImage } from "@/lib/launch/token-image";
import { launch } from "@/lib/launch/flow";
import { verifyFunding } from "@/lib/launch/funding";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { getSolana } from "@/lib/launch/solana/env";
import { getRobinhood } from "@/lib/launch/robinhood/env";
import { verifyRobinhoodFunding } from "@/lib/launch/robinhood/funding";
import { ROBINHOOD_CHAIN } from "@/lib/robinhood/chain";
import { allowRequest } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // upload + mint + confirm
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://mimirmarkets.xyz").replace(/\/$/, "");

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-z0-9]{2,10}(-\d{1,3})?$/.test(id)) return fail(404, "No such agent.");
  const g = await readSigned(req, "launch", id);
  if (!g.ok) return g.res;
  // Each attempt reads a tx from RPC and may mint: a handful per owner is plenty.
  if (!(await allowRequest("launch-mint", g.owner, 10, 10 * 60_000))) return fail(429, "Too many launch attempts. Wait a few minutes.");
  const parsed = z.object({ sig: z.union([z.string().min(80).max(90), z.string().regex(/^0x[0-9a-fA-F]{64}$/)]) }).safeParse(g.body);
  if (!parsed.success) return fail(400, "Missing funding signature.");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  let solana: ReturnType<typeof getSolana>;
  try {
    solana = getSolana();
  } catch (e) {
    console.error("[launch] solana config:", e);
    return fail(503, "Launching is not configured on this server.");
  }
  const robinhood = () => {
    const rh = getRobinhood();
    const client = createPublicClient({ transport: http(process.env.ROBINHOOD_RPC?.trim() || ROBINHOOD_CHAIN.rpcUrl, { timeout: 15_000 }) });
    return {
      verify: verifyRobinhoodFunding,
      client,
      // The logo goes to IPFS through the same Pinata upload pump.fun launches use; Pons stores its URL on chain.
      launchToken: async (a: { walletId: string; wallet: string; name: string; symbol: string; description: string; imageDataUrl: string }) => {
        const { imageUri } = await solana.pumpportal.uploadMetadata({ name: a.name, symbol: a.symbol, description: a.description, imageDataUrl: a.imageDataUrl, website: SITE });
        const r = await rh.executor.launchToken({ walletId: a.walletId, wallet: a.wallet, name: a.name, symbol: a.symbol, logo: imageUri, description: a.description, website: SITE });
        return { mint: r.token, sig: r.sig, metadataUri: imageUri };
      },
    };
  };
  const r = await launch(c, { verify: verifyFunding, conn: solana.connection, launchToken: (a) => solana.executor.launchToken(a), image: defaultTokenImage, robinhood }, g.owner, id, parsed.data.sig);
  if (!r.ok) return fail(r.status, r.error);
  return Response.json({ mint: r.mint });
}
