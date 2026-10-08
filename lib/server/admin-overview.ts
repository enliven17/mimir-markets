/**
 * Everything the admin panel shows, gathered on the server in one pass: the backend's own read (convex/arcAdmin.ts),
 * the Arc chain (contracts, balances, solvency), the app records in the backend, Telegram and the RPCs. Each probe is timed and
 * fails on its own, so one dead service shows as red instead of blanking the page. Read-only; no secret values leave
 * this module, only whether they are set.
 */
import { internalSecret } from "@/lib/internal-secrets";
import { ConvexHttpClient } from "convex/browser";
import { parseAbi, type Address } from "viem";

import { api } from "@/convex/_generated/api";
import { arcPublicClient } from "@/lib/arc/chain";
import { ARC } from "@/lib/arc/config";
import { isInviteOnly } from "@/lib/server/access";
import { store, storeEnabled } from "@/lib/server/store";
import { SOLANA_RPC } from "@/lib/solana/config";

export type Health = "ok" | "warn" | "down";
export interface Probe<T> {
  ok: boolean;
  ms: number;
  data?: T;
  error?: string;
}

const TIMEOUT_MS = 8_000;
/** Below this many USDC an operating wallet is flagged: it pays gas and stakes. */
const LOW_USDC = 1;

async function probe<T>(fn: () => Promise<T>): Promise<Probe<T>> {
  const t0 = Date.now();
  try {
    const data = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timed out")), TIMEOUT_MS))]);
    return { ok: true, ms: Date.now() - t0, data };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

const READ_ABI = parseAbi([
  "function owner() view returns (address)",
  "function oracle() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function paused() view returns (bool)",
  "function arbiter() view returns (address)",
  "function maxMarketStake() view returns (uint256)",
  "function maxAccountStake() view returns (uint256)",
  "function lifetimeFeesAccrued() view returns (uint256)",
  "function lifetimeFeesClaimed() view returns (uint256)",
]);

async function backend() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  const secret = internalSecret("admin");
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  if (!secret) throw new Error("MIMIR_ADMIN_SECRET is not set on the site");
  return new ConvexHttpClient(url).query(api.arcAdmin.overview, { secret });
}

async function contract(address: Address | null) {
  if (!address) throw new Error("contract address is not configured");
  const c = arcPublicClient();
  const read = <T>(functionName: (typeof READ_ABI)[number]["name"]) =>
    c.readContract({ address, abi: READ_ABI, functionName }).then((v) => v as T).catch(() => null);
  const [balance, owner, oracle, feeRecipient, paused, accrued, claimed, arbiter, maxMarket, maxAccount] = await Promise.all([
    c.getBalance({ address }),
    read<Address>("owner"),
    read<Address>("oracle"),
    read<Address>("feeRecipient"),
    read<boolean>("paused"),
    read<bigint>("lifetimeFeesAccrued"),
    read<bigint>("lifetimeFeesClaimed"),
    read<Address>("arbiter"),
    read<bigint>("maxMarketStake"),
    read<bigint>("maxAccountStake"),
  ]);
  const unclaimedFees = accrued !== null && claimed !== null ? accrued - claimed : null;
  return {
    address,
    balanceWei: balance.toString(),
    owner,
    oracle,
    arbiter,
    feeRecipient,
    paused,
    // Net USDC wei, "0" = no cap; null when the contract has no caps (MimirFees) or the read failed.
    maxMarketStakeWei: maxMarket?.toString() ?? null,
    maxAccountStakeWei: maxAccount?.toString() ?? null,
    unclaimedFeesWei: unclaimedFees?.toString() ?? null,
  };
}

async function balances(wallets: Array<{ label: string; address: string }>) {
  const c = arcPublicClient();
  return Promise.all(
    wallets.map(async (w) => {
      const wei = await c.getBalance({ address: w.address as Address }).catch(() => null);
      const usdc = wei === null ? null : Number(wei) / 1e18;
      return { ...w, usdc, low: usdc !== null && usdc < LOW_USDC };
    }),
  );
}

/** The app's records in the backend (lib/server/store.ts), counted. */
async function database() {
  if (!storeEnabled()) throw new Error("the backend is not configured (NEXT_PUBLIC_CONVEX_URL, MIMIR_STORE_SECRET)");
  type R = Record<string, unknown>;
  const s = store();
  const all = (t: string) => s.list<R>(t, { limit: 5000 });
  const [accounts, grantRows, invites, chats, agentRows, payments, basketCount, subs, perms, campaign] = await Promise.all([
    s.count("arc_accounts"),
    all("access_grants"),
    all("access_invites"),
    all("telegram_chats"),
    all("agent_registry"),
    all("agent_payments"),
    s.count("baskets"),
    all("basket_subscriptions"),
    all("copy_permissions"),
    s.count("campaign_invites"),
  ]);
  const groupBy = (rows: R[], f: string) => {
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r[f] ?? "none")] = (out[String(r[f] ?? "none")] ?? 0) + 1;
    return out;
  };
  const live = chats.filter((c) => !c.blocked);
  return {
    arcAccounts: accounts,
    grants: groupBy(grantRows, "via"),
    invitesUsed: invites.filter((r) => r.used_by != null).length,
    invitesFree: invites.filter((r) => r.used_by == null).length,
    telegram: live.length,
    telegramLinked: live.filter((c) => c.wallet != null).length,
    agents: groupBy(agentRows, "status"),
    agentsArc: agentRows.filter((r) => r.arc_operator != null).length,
    agentPayments: { count: payments.length, wei: payments.reduce((n, p) => n + BigInt(String(p.amount_wei ?? "0")), 0n).toString() },
    baskets: basketCount,
    subscribers: new Set(subs.map((r) => r.follower)).size,
    copyFollowers: new Set(perms.filter((p) => p.active && p.revoked_at == null).map((p) => p.follower)).size,
    campaign,
    // The Solana program's read index went with Postgres.
    legacyClaims: 0,
  };
}

async function telegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const call = async (method: string) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { cache: "no-store" });
    const body = (await res.json()) as { ok: boolean; result?: Record<string, unknown>; description?: string };
    if (!body.ok) throw new Error(`${method}: ${body.description ?? res.status}`);
    return body.result ?? {};
  };
  const [me, hook] = await Promise.all([call("getMe"), call("getWebhookInfo")]);
  return {
    bot: `@${String(me.username ?? "")}`,
    webhook: String(hook.url ?? "") || null,
    pending: Number(hook.pending_update_count ?? 0),
    lastError: hook.last_error_message ? String(hook.last_error_message).slice(0, 200) : null,
  };
}

async function solanaSlot(url: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [] }),
    cache: "no-store",
  });
  const body = (await res.json()) as { result?: number; error?: { message?: string } };
  if (typeof body.result !== "number") throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body.result;
}

/** Which of the site's own secrets are set (yes/no), never their values. */
function siteKeys() {
  const names = [
    "MIMIR_STORE_SECRET", "MIMIR_EVENTS_SECRET", "MIMIR_ADMIN_SECRET", "MIMIR_INTERNAL_SECRET", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "ARC_FEE_SIGNER_KEY",
    "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "TYPESAFE_API_KEY", "CMC_API_KEY",
    "SOLANA_MAINNET_RPC", "NEXT_PUBLIC_CIRCLE_CLIENT_KEY", "NEXT_PUBLIC_POSTHOG_KEY",
  ];
  return Object.fromEntries(names.map((n) => [n, Boolean(process.env[n]?.trim())]));
}

const minutes = (ms: number) => ms / 60_000;

export async function adminOverview() {
  const nowMs = Date.now();
  const [be, chainHead, v3, pool, db, tg, solDev, solMain] = await Promise.all([
    probe(backend),
    probe(() => arcPublicClient().getBlockNumber().then(Number)),
    probe(() => contract(ARC.contracts.mimirV3)),
    probe(() => contract(ARC.contracts.mimirPool)),
    probe(database),
    probe(telegram),
    probe(() => solanaSlot(SOLANA_RPC)),
    probe(() => solanaSlot(process.env.SOLANA_MAINNET_RPC?.trim() || "https://api.mainnet-beta.solana.com")),
  ]);

  const b = be.data;
  const wallets = b
    ? [
        ...(b.oracle.address ? [{ label: "Oracle", address: b.oracle.address }] : []),
        ...(b.house ? [{ label: "Market creator", address: b.house }] : []),
        ...b.council.wallets.map((w) => ({ label: `Council · ${w.slug}`, address: w.address })),
        ...(v3.data?.feeRecipient ? [{ label: "Fee recipient", address: v3.data.feeRecipient }] : []),
      ]
    : [];
  const walletBalances = await probe(() => balances(wallets));

  // Solvency: what the contract holds against what the index says it owes (stakes in play, unclaimed pool payouts,
  // dispute bonds) plus fees accrued but not withdrawn. An estimate: parked VS payouts are not in the index.
  const solvency = (c: Probe<Awaited<ReturnType<typeof contract>>>, owedWei: string | undefined) => {
    if (!c.data || owedWei === undefined) return null;
    const owed = BigInt(owedWei) + BigInt(c.data.unclaimedFeesWei ?? "0");
    const held = BigInt(c.data.balanceWei);
    return { heldWei: held.toString(), owedWei: owed.toString(), surplusWei: (held - owed).toString(), ok: held >= owed };
  };

  const lag = b?.cursorBlock != null && chainHead.data != null ? chainHead.data - b.cursorBlock : null;
  // Expected cadence per job (crons.ts); a heartbeat older than 3 periods is stale.
  const JOBS: Record<string, number> = { "arc-sync": 0.5, "arc-oracle": 1, "arc-council": 5, "arc-creator": 60 };
  const jobs = Object.entries(JOBS).map(([name, every]) => {
    const at = b?.heartbeats.find((h) => h.name === name)?.at ?? null;
    const ago = at ? minutes(nowMs - at) : null;
    const health: Health = ago === null ? "warn" : ago > every * 3 ? "down" : ago > every * 1.5 ? "warn" : "ok";
    return { name, everyMinutes: every, lastAt: at, health };
  });
  const lowWallets = walletBalances.data?.filter((w) => w.low).length ?? 0;
  const oracleStuck = b?.oracle.deferred.filter((d) => d.attempts >= 5).length ?? 0;
  const v3Solvent = solvency(v3, b?.owedWei.vs);
  const poolSolvent = solvency(pool, b?.owedWei.pool);

  const status: Array<{ name: string; health: Health; note: string }> = [
    { name: "Backend", health: be.ok ? "ok" : "down", note: be.ok ? `${be.ms} ms` : be.error ?? "" },
    { name: "Indexer", health: lag === null ? "warn" : lag > 600 ? "down" : lag > 120 ? "warn" : "ok", note: lag === null ? "unknown" : `${lag} blocks behind` },
    ...jobs.filter((j) => j.name !== "arc-sync").map((j) => ({
      name: j.name.replace("arc-", "").replace(/^./, (c) => c.toUpperCase()),
      health: j.health,
      note: j.lastAt ? `${Math.round(minutes(nowMs - j.lastAt))} min ago` : "no heartbeat yet",
    })),
    { name: "Oracle queue", health: oracleStuck > 0 ? "warn" : "ok", note: `${b?.oracle.waiting ?? "?"} waiting · ${oracleStuck} retried 5+ times` },
    { name: "Arc RPC", health: chainHead.ok ? "ok" : "down", note: chainHead.ok ? `block ${chainHead.data}` : chainHead.error ?? "" },
    { name: "Solana RPC", health: solDev.ok && solMain.ok ? "ok" : solDev.ok || solMain.ok ? "warn" : "down", note: `devnet ${solDev.ok ? "up" : "down"} · mainnet ${solMain.ok ? "up" : "down"}` },
    { name: "Database", health: db.ok ? "ok" : "down", note: db.ok ? `${db.ms} ms` : db.error ?? "" },
    { name: "Telegram", health: tg.ok ? (tg.data?.lastError ? "warn" : "ok") : "down", note: tg.ok ? (tg.data?.webhook ? "webhook" : "polling") : tg.error ?? "" },
    { name: "Wallets", health: !walletBalances.ok ? "warn" : lowWallets ? "warn" : "ok", note: lowWallets ? `${lowWallets} below ${LOW_USDC} USDC` : "funded" },
    {
      name: "Solvency",
      health: !v3Solvent || !poolSolvent ? "warn" : v3Solvent.ok && poolSolvent.ok ? "ok" : "down",
      note: !v3Solvent || !poolSolvent ? "unknown" : v3Solvent.ok && poolSolvent.ok ? "contracts cover what they owe" : "a contract holds less than it owes",
    },
  ];

  return {
    at: nowMs,
    network: ARC.network,
    inviteOnly: isInviteOnly(),
    explorer: ARC.chain.explorer,
    status,
    jobs,
    backend: be,
    chain: { head: chainHead, v3, pool, solvency: { vs: v3Solvent, pool: poolSolvent }, wallets: walletBalances },
    database: db,
    telegram: tg,
    solana: { devnet: solDev, mainnet: solMain },
    siteKeys: siteKeys(),
  };
}

export type AdminOverview = Awaited<ReturnType<typeof adminOverview>>;
