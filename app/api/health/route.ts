import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
export const dynamic = "force-dynamic";
const intervals = { indexer: 30, oracle: 120, council: 900, creator: 3600, agents: 300 } as const;
export async function GET(): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return Response.json({ status: "critical", network: "solana-devnet", monitored: false }, { status: 503 });
  try {
    const data = await new ConvexHttpClient(url).query(api.solanaDb.health, {}), now = Date.now();
    const alarms = Object.entries(intervals).map(([worker, interval]) => {
      const row = data.workers.find(w => w.name === worker), ageSec = row?.finishedAt ? Math.max(0, Math.floor((now - row.finishedAt) / 1000)) : null;
      const severity = !row || ageSec === null || ageSec > interval * 4 ? "critical" : row.status === "error" || ageSec > interval * 2 ? "warn" : "ok";
      return { worker, severity, ageSec, reason: !row ? "not started" : row.status === "error" ? "last cycle failed" : ageSec !== null && ageSec > interval * 2 ? "late" : "reporting" };
    });
    const status = alarms.some(a => a.severity === "critical") ? "critical" : alarms.some(a => a.severity === "warn") ? "warn" : "ok";
    return Response.json({ status, at: now, network: "solana-devnet", monitored: true, alarms }, { status: status === "critical" ? 503 : 200, headers: { "cache-control": "no-store" } });
  } catch { return Response.json({ status: "critical", network: "solana-devnet", monitored: false }, { status: 503, headers: { "cache-control": "no-store" } }); }
}
