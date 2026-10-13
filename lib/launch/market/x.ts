// X (Twitter) mentions through an external CLI. Disabled (returns []) unless AGENT_REACH_BIN is set.
// agent-reach routes X to `twitter-cli` (https://github.com/Panniantong/Agent-Reach), whose search is
// `twitter search "<query>" -n <N> --json`; point AGENT_REACH_BIN at that binary, or override the
// argv with X_SEARCH_ARGS (JSON array, "{query}" and "{n}" are substituted).
// UNVERIFIED: the JSON output shape. We accept an array (or {data|tweets|results: [...]}) of objects
// with text|full_text|content and created_at|createdAt|time; anything else is ignored.
//
// We can only map a mention to a token when the post contains its mint address (cashtags are
// ambiguous), so mentions1h = number of distinct posts in the last hour containing that mint.
// Spawned without a shell (execFile), with a timeout and an output cap.
import { execFile } from "node:child_process";
import type { Candidate, MarketSource } from "../ports";
import { isMint } from "../engine/candidates";
import { ttlCache } from "./http";
import type { OnError } from "./http";

export type RunCli = (bin: string, args: string[], timeoutMs: number) => Promise<string>;

export const runCli: RunCli = (bin, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true, shell: false }, (err, stdout) =>
      err ? reject(new Error(`x cli failed: ${err.message.slice(0, 200)}`)) : resolve(String(stdout)),
    );
  });

export type XOptions = {
  bin?: string;
  args?: string[];
  query?: string;
  limit?: number;
  run?: RunCli;
  now?: () => number;
  onError?: OnError;
  timeoutMs?: number;
  ttlMs?: number;
};

export const DEFAULT_X_QUERY = "pump.fun OR pump OR solana CA";
const DEFAULT_ARGS = ["search", "{query}", "-n", "{n}", "--json"];
const MINT_IN_TEXT = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

type Post = { text: string; at: number | null };

export function parsePosts(stdout: string): Post[] {
  let body: unknown;
  try {
    body = JSON.parse(stdout);
  } catch {
    return [];
  }
  const obj = body as Record<string, unknown> | null;
  const list = Array.isArray(body) ? body : Array.isArray(obj?.data) ? obj.data : Array.isArray(obj?.tweets) ? obj.tweets : Array.isArray(obj?.results) ? obj.results : [];
  return (list as Record<string, unknown>[]).flatMap((p) => {
    const text = [p?.text, p?.full_text, p?.content].find((t): t is string => typeof t === "string");
    if (!text) return [];
    const rawAt = [p.created_at, p.createdAt, p.time].find((t) => typeof t === "string" || typeof t === "number");
    const at = typeof rawAt === "number" ? (rawAt < 1e12 ? rawAt * 1000 : rawAt) : typeof rawAt === "string" ? Date.parse(rawAt) : NaN;
    return [{ text, at: Number.isFinite(at) ? at : null }];
  });
}

export function createXSource(opts: XOptions): MarketSource {
  const now = opts.now ?? Date.now;
  const run = opts.run ?? runCli;
  const cache = ttlCache<Candidate[]>(opts.ttlMs ?? 120_000, now);
  const n = String(opts.limit ?? 100);
  const query = opts.query ?? DEFAULT_X_QUERY;
  const args = (opts.args ?? DEFAULT_ARGS).map((a) => a.replace("{query}", query).replace("{n}", n));

  async function load(): Promise<Candidate[]> {
    const posts = parsePosts(await run(opts.bin as string, args, opts.timeoutMs ?? 20_000));
    const cutoff = now() - 60 * 60_000;
    const counts = new Map<string, number>();
    for (const p of posts) {
      if (p.at !== null && p.at < cutoff) continue;
      for (const mint of new Set(p.text.match(MINT_IN_TEXT) ?? [])) if (isMint(mint)) counts.set(mint, (counts.get(mint) ?? 0) + 1);
    }
    return [...counts].map(([mint, c]) => ({
      mint,
      symbol: "",
      source: "x" as const,
      priceSol: null,
      metrics: { mentions1h: c },
      note: `${c} X post${c > 1 ? "s" : ""} with this contract address in the last hour (sample of ${posts.length})`,
    }));
  }

  return {
    id: "x",
    async candidates() {
      if (!opts.bin) return [];
      try {
        return await cache.get("x", load);
      } catch (err) {
        opts.onError?.("x", err);
        return [];
      }
    },
  };
}
