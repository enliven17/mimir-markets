// The app's own records (schema.ts `appStore`), reached only from the web server with MIMIR_INTERNAL_SECRET
// (lib/server/store.ts). Reads are queries; every write is one `tx` mutation, so the checks a table relied on in
// Postgres (a code used once, a nonce seen once, a payment tx counted once, the first relay answer wins) hold: a
// conditional step that fails throws and nothing in the batch is written.
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

function allowed(secret: string) {
  const expected = process.env.MIMIR_INTERNAL_SECRET?.trim() ?? "";
  if (expected.length < 16 || secret !== expected) throw new Error("not allowed");
}

const row = (ctx: QueryCtx | MutationCtx, t: string, k: string) =>
  ctx.db.query("appStore").withIndex("by_key", (q) => q.eq("t", t).eq("k", k)).unique();

/** A field matches when equal; `null` also matches a missing field. */
const matches = (d: Record<string, unknown>, when: Record<string, unknown> | undefined) =>
  !when || Object.entries(when).every(([f, want]) => (want === null ? d[f] === null || d[f] === undefined : d[f] === want));

const keyArgs = { t: v.string(), k: v.string() };

export const get = query({
  args: { secret: v.string(), ...keyArgs },
  handler: async (ctx, { secret, t, k }) => {
    allowed(secret);
    return (await row(ctx, t, k))?.d ?? null;
  },
});

export const getMany = query({
  args: { secret: v.string(), t: v.string(), ks: v.array(v.string()) },
  handler: async (ctx, { secret, t, ks }) => {
    allowed(secret);
    const out: Array<unknown> = [];
    for (const k of ks.slice(0, 500)) {
      const r = await row(ctx, t, k);
      if (r) out.push(r.d);
    }
    return out;
  },
});

/** Rows of one table, optionally by its lookup columns or newer than `since` (ms), newest first. */
export const list = query({
  args: {
    secret: v.string(),
    t: v.string(),
    i1: v.optional(v.string()),
    i2: v.optional(v.string()),
    since: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { secret, t, i1, i2, since, limit }) => {
    allowed(secret);
    const n = Math.min(Math.max(limit ?? 1000, 1), 5000);
    const base =
      i1 !== undefined
        ? ctx.db.query("appStore").withIndex("by_i1", (q) => q.eq("t", t).eq("i1", i1))
        : i2 !== undefined
          ? ctx.db.query("appStore").withIndex("by_i2", (q) => q.eq("t", t).eq("i2", i2))
          : ctx.db.query("appStore").withIndex("by_at", (q) => (since !== undefined ? q.eq("t", t).gte("at", since) : q.eq("t", t)));
    const rows = await base.order("desc").take(n);
    return rows.filter((r) => since === undefined || r.at >= since).map((r) => r.d);
  },
});

export const count = query({
  args: { secret: v.string(), t: v.string(), i1: v.optional(v.string()) },
  handler: async (ctx, { secret, t, i1 }) => {
    allowed(secret);
    const q =
      i1 !== undefined
        ? ctx.db.query("appStore").withIndex("by_i1", (x) => x.eq("t", t).eq("i1", i1))
        : ctx.db.query("appStore").withIndex("by_key", (x) => x.eq("t", t));
    // ponytail: counts by reading the rows; fine for the app's tables (hundreds of rows), an aggregate past that.
    return (await q.collect()).length;
  },
});

const step = v.object({
  op: v.union(v.literal("put"), v.literal("insert"), v.literal("update"), v.literal("remove"), v.literal("take"), v.literal("incr")),
  t: v.string(),
  k: v.string(),
  /** put / insert: the whole row. update: the fields to set. incr: the row to start from. */
  d: v.optional(v.any()),
  i1: v.optional(v.string()),
  i2: v.optional(v.string()),
  /** update: only when these fields hold these values (null = unset). */
  when: v.optional(v.any()),
  /** insert / update: a step that cannot apply fails the whole batch. */
  must: v.optional(v.boolean()),
  /** incr: the counter field and the amount. */
  field: v.optional(v.string()),
  by: v.optional(v.number()),
  /** The row's time (ms), for `list({ since })` and pruning; defaults to now. */
  at: v.optional(v.number()),
});

/**
 * Applies the steps in order, in one transaction. Results per step: put/remove → true; insert → whether it was new;
 * update → whether it applied; take → the row (then gone) or null; incr → the new value.
 */
export const tx = mutation({
  args: { secret: v.string(), steps: v.array(step) },
  handler: async (ctx, { secret, steps }) => {
    allowed(secret);
    const results: unknown[] = [];
    for (const s of steps) {
      const now = s.at ?? Date.now();
      const existing = await row(ctx, s.t, s.k);
      const index = { ...(s.i1 !== undefined ? { i1: s.i1 } : {}), ...(s.i2 !== undefined ? { i2: s.i2 } : {}) };
      switch (s.op) {
        case "put":
          if (existing) await ctx.db.patch(existing._id, { d: s.d, at: now, ...index });
          else await ctx.db.insert("appStore", { t: s.t, k: s.k, d: s.d, at: now, ...index });
          results.push(true);
          break;
        case "insert":
          if (existing) {
            if (s.must) throw new ConvexError({ code: "exists", t: s.t, k: s.k });
            results.push(false);
          } else {
            await ctx.db.insert("appStore", { t: s.t, k: s.k, d: s.d, at: now, ...index });
            results.push(true);
          }
          break;
        case "update": {
          const ok = !!existing && matches(existing.d as Record<string, unknown>, s.when as Record<string, unknown> | undefined);
          if (!ok) {
            if (s.must) throw new ConvexError({ code: "conflict", t: s.t, k: s.k });
            results.push(false);
            break;
          }
          await ctx.db.patch(existing._id, { d: { ...(existing.d as object), ...(s.d as object) }, ...index, ...(s.at !== undefined ? { at: s.at } : {}) });
          results.push(true);
          break;
        }
        case "remove":
          if (existing) await ctx.db.delete(existing._id);
          results.push(true);
          break;
        case "take":
          if (existing) await ctx.db.delete(existing._id);
          results.push(existing?.d ?? null);
          break;
        case "incr": {
          const field = s.field ?? "hits";
          const base = (existing?.d ?? s.d ?? {}) as Record<string, unknown>;
          const next = Number(base[field] ?? 0) + (s.by ?? 1);
          const d = { ...base, [field]: next };
          if (existing) await ctx.db.patch(existing._id, { d });
          else await ctx.db.insert("appStore", { t: s.t, k: s.k, d, at: now, ...index });
          results.push(next);
          break;
        }
      }
    }
    return results;
  },
});

/** Deletes rows of one table older than `before` (ms), a batch at a time; returns how many went. */
export const prune = mutation({
  args: { secret: v.string(), t: v.string(), before: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { secret, t, before, limit }) => {
    allowed(secret);
    const old = await ctx.db
      .query("appStore")
      .withIndex("by_at", (q) => q.eq("t", t).lt("at", before))
      .take(Math.min(limit ?? 500, 2000));
    for (const r of old) await ctx.db.delete(r._id);
    return old.length;
  },
});

/** Data import (scripts/migrate/neon-to-convex.mjs): rows as they come, by key; run with `npx convex run`. */
export const importRows = internalMutation({
  args: { rows: v.array(v.object({ t: v.string(), k: v.string(), d: v.any(), i1: v.optional(v.string()), i2: v.optional(v.string()), at: v.number() })) },
  handler: async (ctx, { rows }) => {
    let written = 0;
    for (const r of rows) {
      const existing = await row(ctx, r.t, r.k);
      if (existing) await ctx.db.replace(existing._id, r);
      else await ctx.db.insert("appStore", r);
      written++;
    }
    return written;
  },
});

/** Clears expired relay answers and old rate-limit windows, nonces and replies (convex/crons.ts). */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoffs: Array<[string, number]> = [
      ["wallet_relay", now - 10 * 60_000],
      ["rate_limits", now - 2 * 86_400_000],
      ["agent_api_nonces", now - 2 * 86_400_000],
      ["agent_api_responses", now - 2 * 86_400_000],
      ["copy_reservations", now - 86_400_000],
    ];
    let removed = 0;
    for (const [t, before] of cutoffs) {
      const old = await ctx.db.query("appStore").withIndex("by_at", (q) => q.eq("t", t).lt("at", before)).take(500);
      for (const r of old) await ctx.db.delete(r._id);
      removed += old.length;
    }
    return removed;
  },
});
