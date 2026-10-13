// Shared plumbing for market adapters: injected fetch with a hard timeout, and a TTL cache that
// also dedupes concurrent loads (stampede protection) so many agents ticking at once cost one call.

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type OnError = (source: string, err: unknown) => void;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** GET/POST JSON with a timeout; throws HttpError on non-2xx. Never logs the URL (it may carry an api key). */
export async function getJson(
  fetchFn: FetchLike,
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; signal?: AbortSignal; redact?: string } = {},
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8_000);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetchFn(url, { headers: { accept: "application/json", ...opts.headers }, signal: ctrl.signal });
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 200);
      const safe = opts.redact ? body.split(opts.redact).join("***") : body;
      throw new HttpError(res.status, `HTTP ${res.status}${safe ? `: ${safe}` : ""}`);
    }
    return await res.json();
  } catch (err) {
    if (ctrl.signal.aborted && !(err instanceof HttpError)) throw new Error(`timeout after ${opts.timeoutMs ?? 8_000}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

export type TtlCache<T> = {
  /** Cached value if fresh, else runs `load` once even under concurrent callers. Failures are not cached. */
  get(key: string, load: () => Promise<T>): Promise<T>;
  peek(key: string): T | undefined;
  clear(): void;
};

export function ttlCache<T>(ttlMs: number, now: () => number = Date.now, maxEntries = 2_000): TtlCache<T> {
  const values = new Map<string, { value: T; until: number }>();
  const inflight = new Map<string, Promise<T>>();
  return {
    async get(key, load) {
      const hit = values.get(key);
      if (hit && hit.until > now()) return hit.value;
      const pending = inflight.get(key);
      if (pending) return pending;
      const p = load()
        .then((value) => {
          if (values.size >= maxEntries) values.delete(values.keys().next().value as string);
          values.set(key, { value, until: now() + ttlMs });
          return value;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
    peek(key) {
      const hit = values.get(key);
      return hit && hit.until > now() ? hit.value : undefined;
    },
    clear() {
      values.clear();
    },
  };
}

export const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

export function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
