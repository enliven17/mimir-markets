import assert from "node:assert/strict";
/** Executes real Convex handlers against indexed rows; failed mutations roll back all writes. */
export function memoryBackend() {
  let rows = new Map<string, any>(), sequence = 0;
  const db = {
    async get(id: string) { return structuredClone(rows.get(id) ?? null); },
    async insert(table: string, value: any) { const id = `${table}_${++sequence}`; rows.set(id, { ...structuredClone(value), _id: id, _creationTime: sequence }); return id; },
    async patch(id: string, patch: any) { assert.ok(rows.has(id)); rows.set(id, { ...rows.get(id), ...structuredClone(patch) }); },
    async replace(id: string, value: any) { const row = rows.get(id); assert.ok(row); rows.set(id, { ...structuredClone(value), _id: id, _creationTime: row._creationTime }); },
    async delete(id: string) { rows.delete(id); },
    normalizeId(table: string, id: string) { return id.startsWith(`${table}_`) ? id : null; },
    query(table: string) {
      const filters: ((r: any) => boolean)[] = []; let direction = 1, sort = "_creationTime";
      const q: any = {};
      for (const [name, compare] of Object.entries({ eq: (a: any, b: any) => a === b, gt: (a: number, b: number) => a > b, gte: (a: number, b: number) => a >= b, lt: (a: number, b: number) => a < b, lte: (a: number, b: number) => a <= b })) q[name] = (key: string, value: any) => { filters.push((r) => compare(r[key], value)); return q; };
      const result = () => [...rows.values()].filter((r) => r._id.startsWith(`${table}_`) && filters.every((f) => f(r))).sort((a, b) => direction * (a[sort] - b[sort]));
      const chain: any = { withIndex(index: string, fn?: (q: any) => void) { if (index === "by_at") sort = "at"; if (index === "by_deadline") sort = "deadline"; fn?.(q); return chain; }, order(order: string) { direction = order === "desc" ? -1 : 1; return chain; }, async unique() { const found = result(); assert.ok(found.length < 2); return structuredClone(found[0] ?? null); }, async first() { return structuredClone(result()[0] ?? null); }, async take(n: number) { return structuredClone(result().slice(0, n)); }, async collect() { return structuredClone(result()); } };
      return chain;
    },
  };
  return { db, async run(fn: any, args: any) { const snapshot = structuredClone(rows); try { return await fn._handler({ db, scheduler: { runAfter: async () => "scheduled" } }, args); } catch (e) { rows = snapshot; throw e; } } };
}
