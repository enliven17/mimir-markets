/**
 * POST /api/launch                 step 1 of a launch (signed by the owner, lib/launch/auth.ts): validate, make the
 *                                  agent's wallets (Solana or Robinhood Chain by venue, plus Arc), store it pending.
 *                                  Returns where to send the seed (SOL, or ETH on Robinhood; nothing for Arc-only).
 * GET  /api/launch?owner=<base58>  that wallet's agents (public views).
 */
import { api } from "@/convex/_generated/api";
import { normalizeAddress } from "@/lib/agents/signature";
import { checkKey } from "@/lib/launch/byok";
import { holdsMimir } from "@/lib/launch/copy-gate";
import { CreateBody, create } from "@/lib/launch/flow";
import { fail, launchCx, readSigned } from "@/lib/launch/request";
import { agentWalletPolicy } from "@/lib/launch/solana/policy";
import { getSolana } from "@/lib/launch/solana/env";
import { robinhoodAgentPolicy } from "@/lib/launch/robinhood/policy";
import { getRobinhood } from "@/lib/launch/robinhood/env";
import { ARC } from "@/lib/arc/config";
import { createWallets } from "@/lib/server/circle-w3s";
import { allowRequest, clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  if (!(await allowRequest("launch-read", clientIp(req), 60, 60_000))) return tooManyRequests(60);
  const owner = normalizeAddress(new URL(req.url).searchParams.get("owner"));
  if (!owner) return fail(400, "owner must be a Solana public key");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  return Response.json({ agents: await c.client.query(api.launch.byOwner, { owner }) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (!(await allowRequest("launch-create-ip", clientIp(req), 10, 60 * 60_000))) return tooManyRequests(600);
  const g = await readSigned(req, "create", "new", 800_000);
  if (!g.ok) return g.res;
  if (!(await allowRequest("launch-create", g.owner, 5, 60 * 60_000))) return fail(429, "Too many agents this hour.");
  // Launching is for $MIMIR holders (the agent's own token is a separate buy).
  const holds = await holdsMimir(g.owner);
  if (holds === "unknown") return fail(503, "Could not read your $MIMIR balance. Try again.");
  if (holds === "no") return fail(403, "Hold $MIMIR to launch an agent.");
  const parsed = CreateBody.safeParse(g.body);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Invalid agent.");
  const c = launchCx();
  if (!c) return fail(503, "Launch is not configured on this server.");
  let solana: ReturnType<typeof getSolana>;
  try {
    solana = getSolana();
  } catch (e) {
    console.error("[launch] solana config:", e);
    return fail(503, "Launch is not configured on this server.");
  }
  try {
    const r = await create(c, {
      checkKey: (p, k, m) => checkKey(p, k, m),
      wallets: {
        solana: (owner) => solana.privy.createWalletWithPolicy((address) => agentWalletPolicy({ wallet: address, creator: owner, treasury: solana.treasury })),
        robinhood: (payout) => {
          const rh = getRobinhood();
          return rh.privy.createWalletWithPolicy((address) => robinhoodAgentPolicy(address, payout, rh.treasury), "ethereum");
        },
        arc: async (slug) => {
          const [w] = await createWallets([slug], ARC.network === "mainnet" ? "ARC" : "ARC-TESTNET", "mimir-launch");
          return { id: w.id, address: w.address };
        },
      },
    }, g.owner, parsed.data);
    if (!r.ok) return fail(r.status, r.error);
    return Response.json({ id: r.id, venue: r.venue, solana: r.solana, robinhood: r.robinhood, arc: r.arc, fundLamports: r.fundLamports.toString() });
  } catch (e) {
    console.error("[launch] create failed:", e);
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("LAUNCH_BYOK_SECRET")) return fail(503, "Own API keys are not configured on this server yet. Use Mimir AI for now.");
    if (msg.includes("does not look like an API key")) return fail(400, "That does not look like an API key.");
    return fail(502, "Could not create the agent's wallets. Try again.");
  }
}
