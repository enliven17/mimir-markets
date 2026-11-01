/**
 * An agent's optional token, launched from its owner's own wallet (lib/launch/token.ts). Both steps signed by the owner.
 * POST /api/launch/:id/token { step: "prepare", chain: "arc"|"base", description?, image?, argus? }
 *      the transaction to send from the owner's wallet: { chain, chainId, to, data, value, token }.
 * POST /api/launch/:id/token { step: "record", chain, tx }
 *      after it landed: checks the receipt (sender and creator are the owner, the symbol is the agent's ticker) and
 *      keeps the token on the agent.
 */
import { createPublicClient, http, type Address, type Hex } from "viem";

import { arcPublicClient } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { baseRpcUrl } from "@/lib/base/chain";
import { MARKET_CHAINS } from "@/lib/chains/registry";
import { pinImage, prepareLaunch, simulateLaunch } from "@/lib/launch/argus-chain";
import { clankerDeployTx } from "@/lib/launch/base/deploy";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { defaultTokenImage } from "@/lib/launch/token-image";
import { prepareTokenLaunch, recordTokenLaunch, TokenPrepareBody, TokenRecordBody, type ReceiptReader } from "@/lib/launch/token";
import { allowRequest } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 90; // pin + hook salt mining + simulation, or a receipt wait
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://mimirmarkets.xyz").replace(/\/$/, "");

/** Waits briefly for a just-sent tx, so the browser can record right after its wallet returns the hash. */
function reader(client: ReturnType<typeof arcPublicClient>): ReceiptReader {
  return {
    getTransaction: ({ hash }) => client.getTransaction({ hash }),
    getTransactionReceipt: ({ hash }) => client.waitForTransactionReceipt({ hash, timeout: 60_000 }),
  };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-z0-9]{2,10}(-\d{1,3})?$/.test(id)) return fail(404, "No such agent.");
  const g = await readSigned(req, "token", id, 800_000);
  if (!g.ok) return g.res;
  if (!(await allowRequest("launch-token", g.owner, 10, 10 * 60_000))) return fail(429, "Too many attempts. Wait a few minutes.");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  const step = (g.body as { step?: unknown } | null)?.step;

  if (step === "prepare") {
    const parsed = TokenPrepareBody.safeParse(g.body);
    if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid token.");
    if (!MARKET_CHAINS.chains[parsed.data.chain].enabled) return fail(503, "This network is currently disabled.");
    if (MARKET_CHAINS.chains[parsed.data.chain].network !== "mainnet") return fail(503, "Token launches are available after the mainnet rollout.");
    if (parsed.data.chain === "arc" && ARC.network !== "mainnet") return fail(503, "Argus launches run on Arc mainnet only.");
    const arc = arcPublicClient(ARC);
    const r = await prepareTokenLaunch(c, {
      image: defaultTokenImage,
      pin: (dataUrl, name) => pinImage(dataUrl, name),
      argus: async (creator: Address, uid, params) => {
        const prep = await prepareLaunch(arc, creator, uid, params);
        await simulateLaunch(arc, prep);
        return { data: prep.data, token: prep.token };
      },
      arcChainId: ARC.chain.id,
      clanker: (a) => clankerDeployTx(a),
      site: SITE,
    }, g.owner, id, parsed.data);
    if (!r.ok) return fail(r.status, r.error);
    const { ok: _ok, ...tx } = r;
    return Response.json(tx, { headers: { "cache-control": "no-store" } });
  }

  if (step === "record") {
    const parsed = TokenRecordBody.safeParse(g.body);
    if (!parsed.success) return fail(400, "Send the launch transaction hash.");
    const base = createPublicClient({ transport: http(baseRpcUrl(), { timeout: 15_000 }) });
    const r = await recordTokenLaunch(c, {
      arc: reader(arcPublicClient(ARC)),
      base: {
        getTransaction: ({ hash }: { hash: Hex }) => base.getTransaction({ hash }),
        getTransactionReceipt: ({ hash }: { hash: Hex }) => base.waitForTransactionReceipt({ hash, timeout: 60_000 }),
      },
    }, g.owner, id, parsed.data);
    if (!r.ok) return fail(r.status, r.error);
    return Response.json({ token: r.token });
  }

  return fail(400, 'step must be "prepare" or "record"');
}
