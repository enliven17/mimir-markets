/**
 * Mimir Launch: creating an agent. Free and in one call: validate the owner's form, check a BYOK key with one tiny
 * call, make the agent's wallets (Circle, developer-controlled: Arc, and Base when Base markets are enabled) and store
 * it live. The agent stakes on Mimir markets from the wallet on each chain once its owner funds it (Arc: USDC, which
 * also pays gas; Base: USDC plus a little ETH for gas, no gas station), and the owner can withdraw any time.
 * Its own token is optional and separate: the owner launches it from their own wallet (lib/launch/token.ts).
 * State lives in Convex (convex/launch.ts). Dependencies are injected for tests.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { api } from "@/convex/_generated/api";
import { AVATAR_SEED_RE } from "@/lib/avatar/spec";
import { BYOK_PROVIDERS, sealKey, type ByokProvider } from "./byok";
import { Markets } from "./inputs";
import { DEFAULT_MARKET_RULES } from "./markets";
import type { Cx } from "./request";
import { reservedLaunchSlug } from "./copy-key";

const Brain = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mimir") }),
  z.object({
    kind: z.literal("byok"),
    provider: z.enum(Object.keys(BYOK_PROVIDERS) as [ByokProvider, ...ByokProvider[]]),
    apiKey: z.string().trim().min(16).max(400),
    model: z.string().trim().max(80).regex(/^[A-Za-z0-9._:/-]*$/).optional(),
  }),
]);

export const CreateBody = z.object({
  name: z.string().trim().min(2).max(32),
  ticker: z.string().regex(/^[A-Z0-9]{2,10}$/),
  thesis: z.string().max(600).default(""),
  avatarSeed: z.string().regex(AVATAR_SEED_RE).optional(),
  brain: Brain,
  markets: Markets,
})
  .refine((b) => b.markets.enabled || b.markets.create.enabled, { message: "Turn on staking, opening markets or both.", path: ["markets"] });
export type CreateInput = z.infer<typeof CreateBody>;

export interface Wallets {
  /** The agent's Arc wallet (Circle, developer-controlled): it stakes and pays its own gas in USDC. */
  arc: (slug: string) => Promise<{ id: string; address: string }>;
  /** Its Base wallet (Circle, BASE / BASE-SEPOLIA), when Base markets are enabled; null = made later on first use. */
  base?: (slug: string) => Promise<{ id: string; address: string } | null>;
}
export type KeyCheck = (provider: ByokProvider, apiKey: string, model: string) => Promise<"ok" | "bad-key" | "busy">;

export async function create({ client, secret }: Cx, deps: { wallets: Wallets; checkKey: KeyCheck }, owner: string, input: CreateInput) {
  const slug = input.ticker.toLowerCase();
  // A persona's or a house name would share a council agent's page and its copy followers: refused before anything is made.
  if (reservedLaunchSlug(slug)) return { ok: false as const, status: 409, error: `$${input.ticker} belongs to Mimir's own agents. Pick another ticker.` };
  const uid = randomUUID();
  // Check and seal the key before any wallet exists, so a bad key costs nothing.
  let brain: { kind: "mimir" } | { kind: "byok"; provider: string; sealed: string; last4: string; model: string } = { kind: "mimir" };
  if (input.brain.kind === "byok") {
    const sealed = sealKey(uid, input.brain.provider, input.brain.apiKey, input.brain.model);
    const label = BYOK_PROVIDERS[sealed.provider].label;
    const check = await deps.checkKey(sealed.provider, input.brain.apiKey, sealed.model);
    if (check === "bad-key") return { ok: false as const, status: 400, error: `${label} refused that key or model. Check both and try again.` };
    if (check === "busy") return { ok: false as const, status: 503, error: `${label} is rate-limiting that key or is down right now, so it could not be checked. Try again in a minute.` };
    brain = { kind: "byok", ...sealed };
  }
  const { enabled, budgetUsdc, create: opens, ...rules } = input.markets;
  const arc = await deps.wallets.arc(slug);
  // A Base wallet that cannot be made now is made by the agent's first Base tick instead (convex/launchArc.ts).
  const base = deps.wallets.base ? await deps.wallets.base(slug).catch(() => null) : null;
  const r = await client.mutation(api.launch.create, {
    secret, slug, uid, owner, name: input.name, ticker: input.ticker, avatarSeed: input.avatarSeed ?? slug, thesis: input.thesis, brain,
    markets: { enabled, budgetUsdc, rules: { ...DEFAULT_MARKET_RULES, ...rules }, create: opens },
    arc: { walletId: arc.id, address: arc.address },
    ...(base ? { base: { walletId: base.id, address: base.address } } : {}),
  });
  // Lost a race for the ticker after the wallet was made: it is simply never funded.
  if (!r.ok) return { ok: false as const, status: 409, error: r.reason === "reserved" ? `$${input.ticker} belongs to Mimir's own agents. Pick another ticker.` : `Too many agents named $${input.ticker}. Pick another ticker.` };
  return { ok: true as const, id: r.slug, arc: arc.address, base: base?.address ?? null };
}
