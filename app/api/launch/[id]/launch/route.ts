/**
 * POST /api/launch/:id/launch { sig }: step 2, signed by the owner. Verify the funding tx, then the agent mints its token:
 * a Solana signature for a pump.fun agent, a 0x hash for a Robinhood (Pons) or Base (Clanker) agent.
 * POST /api/launch/:id/launch {}:      the Argus path (chain "arc"): the agent's Arc wallet holds its gas, it launches on Argus.
 */
import { createPublicClient, http } from "viem";
import { z } from "zod";
import type { Address, Hex } from "viem";

import { arcPublicClient } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { ARGUS } from "@/lib/launch/argus";
import { pinImage, sendLaunch } from "@/lib/launch/argus-chain";
import { defaultTokenImage } from "@/lib/launch/token-image";
import { launch, launchArc } from "@/lib/launch/flow";
import { verifyFunding } from "@/lib/launch/funding";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { getSolana } from "@/lib/launch/solana/env";
import { getRobinhood } from "@/lib/launch/robinhood/env";
import { verifyRobinhoodFunding } from "@/lib/launch/robinhood/funding";
import { ROBINHOOD_CHAIN } from "@/lib/robinhood/chain";
import { baseRpcUrl } from "@/lib/base/chain";
import { getBase } from "@/lib/launch/base/env";
import { clankerDeployTx } from "@/lib/launch/base/deploy";
import { executeContract } from "@/lib/server/circle-w3s";
import { allowRequest } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // upload + mint + confirm; an Argus launch also mines its hook salt and waits on Circle
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://mimirmarkets.xyz").replace(/\/$/, "");

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-z0-9]{2,10}(-\d{1,3})?$/.test(id)) return fail(404, "No such agent.");
  const g = await readSigned(req, "launch", id);
  if (!g.ok) return g.res;
  // Each attempt reads a tx from RPC and may mint: a handful per owner is plenty.
  if (!(await allowRequest("launch-mint", g.owner, 10, 10 * 60_000))) return fail(429, "Too many launch attempts. Wait a few minutes.");
  const parsed = z.object({ sig: z.union([z.string().min(80).max(90), z.string().regex(/^0x[0-9a-fA-F]{64}$/)]).optional() }).safeParse(g.body);
  if (!parsed.success) return fail(400, "Missing funding signature.");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");

  if (!parsed.data.sig) {
    if (ARC.network !== "mainnet") return fail(503, "Argus launches run on Arc mainnet only.");
    const client = arcPublicClient(ARC);
    const r = await launchArc(c, {
      balanceWei: (address) => client.getBalance({ address: address as Address }),
      image: defaultTokenImage,
      pin: (dataUrl, name) => pinImage(dataUrl, name),
      launchToken: ({ walletId, wallet, uid, params }) =>
        sendLaunch(client, wallet as Address, uid, params, (callData: Hex) => executeContract({ walletId, contractAddress: ARGUS.portal, callData })),
    }, g.owner, id);
    if (!r.ok) return fail(r.status, r.error);
    return Response.json({ token: r.token, poolId: r.poolId });
  }

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
      // The logo goes to IPFS (Pinata, as for Argus); Pons stores its URL on chain.
      launchToken: async (a: { walletId: string; wallet: string; name: string; symbol: string; description: string; imageDataUrl: string }) => {
        const imageUri = await pinImage(a.imageDataUrl, `${a.symbol}.png`);
        const r = await rh.executor.launchToken({ walletId: a.walletId, wallet: a.wallet, name: a.name, symbol: a.symbol, logo: imageUri, description: a.description, website: SITE });
        return { mint: r.token, sig: r.sig, metadataUri: imageUri };
      },
    };
  };
  const base = () => {
    const b = getBase();
    const client = createPublicClient({ transport: http(baseRpcUrl(), { timeout: 15_000 }) });
    return {
      verify: verifyRobinhoodFunding,
      client,
      // The image goes to IPFS (Pinata); Clanker stores its URI on the token. The agent wallet is admin and fee recipient.
      launchToken: async (a: { walletId: string; wallet: string; name: string; symbol: string; description: string; imageDataUrl: string }) => {
        const imageUri = await pinImage(a.imageDataUrl, `${a.symbol}.png`);
        const deploy = await clankerDeployTx({ wallet: a.wallet, name: a.name, symbol: a.symbol, image: imageUri, description: a.description, website: `${SITE}/launch/${id}`, slug: id });
        const r = await b.executor.launchToken({ walletId: a.walletId, wallet: a.wallet, deploy });
        return { mint: r.token, sig: r.sig, metadataUri: imageUri };
      },
    };
  };
  const r = await launch(c, { verify: verifyFunding, conn: solana.connection, launchToken: (a) => solana.executor.launchToken(a), image: defaultTokenImage, robinhood, base }, g.owner, id, parsed.data.sig);
  if (!r.ok) return fail(r.status, r.error);
  return Response.json({ mint: r.mint });
}
