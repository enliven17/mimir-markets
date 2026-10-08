/**
 * The app's records, kept in the backend (convex/appStore.ts) since the Postgres tables were retired. Server only:
 * every call carries the store secret (MIMIR_STORE_SECRET, lib/internal-secrets.ts). Rows keep their old column names; `t` is the old table name.
 *
 * Writes are batches (`tx`) run as one transaction: a step marked `must` that cannot apply (a key that already
 * exists, a condition that no longer holds) throws StoreConflict and nothing in the batch is written.
 *
 * Tests swap in the in-memory store (`useMemoryStore`), which follows the same rules.
 */
import { internalSecret } from "../internal-secrets";
import { ConvexHttpClient } from "convex/browser";

import { api } from "@/convex/_generated/api";

export type Step =
  | { op: "put"; t: string; k: string; d: object; i1?: string; i2?: string; at?: number }
  | { op: "insert"; t: string; k: string; d: object; i1?: string; i2?: string; at?: number; must?: boolean }
  | { op: "update"; t: string; k: string; d: object; when?: Record<string, unknown>; i1?: string; i2?: string; at?: number; must?: boolean }
  | { op: "remove"; t: string; k: string }
  | { op: "take"; t: string; k: string }
  | { op: "incr"; t: string; k: string; field?: string; by?: number; d?: object; i1?: string; i2?: string; at?: number };

export interface ListOptions {
  i1?: string;
  i2?: string;
  /** Only rows whose time is at or after this (ms). */
  since?: number;
  limit?: number;
}

export interface Store {
  get<T>(t: string, k: string): Promise<T | null>;
  getMany<T>(t: string, ks: string[]): Promise<T[]>;
  /** Newest first. */
  list<T>(t: string, opts?: ListOptions): Promise<T[]>;
  count(t: string, i1?: string): Promise<number>;
  tx(steps: Step[]): Promise<unknown[]>;
  prune(t: string, before: number, limit?: number): Promise<number>;
}

/** A `must` step that could not apply; the batch wrote nothing. */
export class StoreConflict extends Error {
  constructor(readonly code: "exists" | "conflict", readonly t: string, readonly k: string) {
    super(`${code}: ${t}/${k}`);
  }
}

// Convex values: no undefined, no bigint, plain objects only.
const clean = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function convexStore(url: string, secret: string): Store {
  const c = new ConvexHttpClient(url);
  return {
    get: async (t, k) => (await c.query(api.appStore.get, { secret, t, k })) as never,
    getMany: async (t, ks) => (ks.length ? ((await c.query(api.appStore.getMany, { secret, t, ks })) as never) : []),
    list: async (t, opts = {}) => (await c.query(api.appStore.list, { secret, t, ...clean(opts) })) as never,
    count: (t, i1) => c.query(api.appStore.count, { secret, t, ...(i1 !== undefined ? { i1 } : {}) }),
    tx: async (steps) => {
      try {
        return await c.mutation(api.appStore.tx, { secret, steps: clean(steps) });
      } catch (err) {
        const data = (err as { data?: { code?: string; t?: string; k?: string } }).data;
        if (data?.code === "exists" || data?.code === "conflict") throw new StoreConflict(data.code, data.t ?? "", data.k ?? "");
        throw err;
      }
    },
    prune: (t, before, limit) => c.mutation(api.appStore.prune, { secret, t, before, ...(limit ? { limit } : {}) }),
  };
}

type MemRow = { d: Record<string, unknown>; i1?: string; i2?: string; at: number; seq: number };

/** The same semantics in memory (tests). */
export function memoryStore(): Store & { rows: Map<string, MemRow> } {
  const rows = new Map<string, MemRow>();
  let seq = 0;
  const key = (t: string, k: string) => `${t}\u0000${k}`;
  const ofTable = (t: string) => [...rows.entries()].filter(([id]) => id.startsWith(`${t}\u0000`)).map(([, r]) => r);
  return {
    rows,
    get: async (t, k) => (rows.has(key(t, k)) ? (clean(rows.get(key(t, k))!.d) as never) : null),
    getMany: async (t, ks) => ks.filter((k) => rows.has(key(t, k))).map((k) => clean(rows.get(key(t, k))!.d) as never),
    list: async (t, { i1, i2, since, limit } = {}) =>
      ofTable(t)
        .filter((r) => (i1 === undefined || r.i1 === i1) && (i2 === undefined || r.i2 === i2) && (since === undefined || r.at >= since))
        .sort((a, b) => b.at - a.at || b.seq - a.seq)
        .slice(0, limit ?? 1000)
        .map((r) => clean(r.d) as never),
    count: async (t, i1) => ofTable(t).filter((r) => i1 === undefined || r.i1 === i1).length,
    tx: async (steps) => {
      const snapshot = new Map(rows);
      const results: unknown[] = [];
      try {
        for (const s of clean(steps)) {
          const id = key(s.t, s.k);
          const existing = rows.get(id);
          const index = { ...("i1" in s && s.i1 !== undefined ? { i1: s.i1 } : {}), ...("i2" in s && s.i2 !== undefined ? { i2: s.i2 } : {}) };
          const at = ("at" in s && s.at) || Date.now();
          if (s.op === "put") {
            rows.set(id, { ...(existing ?? { seq: ++seq }), d: s.d as Record<string, unknown>, at, ...index });
            results.push(true);
          } else if (s.op === "insert") {
            if (existing) {
              if (s.must) throw new StoreConflict("exists", s.t, s.k);
              results.push(false);
            } else {
              rows.set(id, { d: s.d as Record<string, unknown>, at, seq: ++seq, ...index });
              results.push(true);
            }
          } else if (s.op === "update") {
            const ok =
              !!existing &&
              Object.entries(s.when ?? {}).every(([f, want]) => (want === null ? existing.d[f] == null : existing.d[f] === want));
            if (!ok) {
              if (s.must) throw new StoreConflict("conflict", s.t, s.k);
              results.push(false);
            } else {
              rows.set(id, { ...existing, d: { ...existing.d, ...(s.d as object) }, ...index, ...(s.at ? { at: s.at } : {}) });
              results.push(true);
            }
          } else if (s.op === "remove") {
            rows.delete(id);
            results.push(true);
          } else if (s.op === "take") {
            rows.delete(id);
            results.push(existing ? existing.d : null);
          } else {
            const field = s.field ?? "hits";
            const base = (existing?.d ?? s.d ?? {}) as Record<string, unknown>;
            const next = Number(base[field] ?? 0) + (s.by ?? 1);
            rows.set(id, { ...(existing ?? { seq: ++seq, at, ...index }), d: { ...base, [field]: next } });
            results.push(next);
          }
        }
      } catch (err) {
        rows.clear();
        for (const [k, v] of snapshot) rows.set(k, v);
        throw err;
      }
      return clean(results);
    },
    prune: async (t, before) => {
      let n = 0;
      for (const [id, r] of rows) if (id.startsWith(`${t}\u0000`) && r.at < before) (rows.delete(id), n++);
      return n;
    },
  };
}

let override: Store | null = null;
let cached: Store | null | undefined;

/** Tests: run against an in-memory store (pass null to go back to the backend). */
export function useMemoryStore(s: Store | null = memoryStore()): Store | null {
  override = s;
  return s;
}

/** True when the backend URL and the internal secret are both set. */
export function storeEnabled(): boolean {
  if (override) return true;
  const secret = internalSecret("store");
  return Boolean(process.env.NEXT_PUBLIC_CONVEX_URL?.trim()) && secret.length >= 16;
}

/** The store; throws when the backend is not configured (callers check storeEnabled() first, or catch). */
export function store(): Store {
  if (override) return override;
  if (cached === undefined) {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
    const secret = internalSecret("store");
    cached = url && secret.length >= 16 ? convexStore(url, secret) : null;
  }
  if (!cached) throw new Error("the backend is not configured (NEXT_PUBLIC_CONVEX_URL, MIMIR_STORE_SECRET)");
  return cached;
}

/** One-step helpers. */
export const put = (t: string, k: string, d: object, idx: { i1?: string; i2?: string; at?: number } = {}) =>
  store().tx([{ op: "put", t, k, d, ...idx }]);
export const insert = async (t: string, k: string, d: object, idx: { i1?: string; i2?: string; at?: number } = {}) =>
  (await store().tx([{ op: "insert", t, k, d, ...idx }]))[0] === true;
export const update = async (t: string, k: string, d: object, when?: Record<string, unknown>, idx: { i1?: string; i2?: string; at?: number } = {}) =>
  (await store().tx([{ op: "update", t, k, d, when, ...idx }]))[0] === true;
export const remove = (t: string, k: string) => store().tx([{ op: "remove", t, k }]);
export const take = async <T>(t: string, k: string) => ((await store().tx([{ op: "take", t, k }]))[0] ?? null) as T | null;
