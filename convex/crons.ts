import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// MIMIR_BACKEND_OFF=1 in a deployment's env turns every job below into a no-op (the old testnet backend).
// Node actions (oracle, council, watchdog, creator) are what the Convex compute quota pays for: keep them sparse.
// Free-plan friendly intervals (~75% fewer calls & Node-action compute).
// User actions still trigger instant indexing via arc:poke.
const crons = cronJobs();
crons.interval("discovery cleanup", { hours: 6 }, internal.discovery.sweep, {});
// Primary BSC indexer every 60s (~43k calls/mo); dormant chains check every 15m and exit immediately.
crons.interval("bsc indexer", { seconds: 60 }, internal.arcSync.sync, { chain: "bsc" });
crons.interval("base indexer", { minutes: 15 }, internal.arcSync.sync, { chain: "base" });
crons.interval("arc indexer", { minutes: 15 }, internal.arcSync.sync, { chain: "arc" });
// Settles, finalizes, refunds and pays on every enabled chain (convex/arcOracle.ts).
crons.interval("arc oracle", { minutes: 5 }, internal.arcOracle.tick, {});
// The council: forecast takes on open markets (convex/arcCouncil.ts).
crons.interval("arc council", { minutes: 30 }, internal.arcCouncil.tick, {});
// The house market creator: drafts and opens pools every 2 hours (convex/arcCreator.ts).
crons.interval("arc market creator", { hours: 2 }, internal.arcCreator.tick, {});
// The twin reconciler: no-op in single-chain mode (convex/arcTwins.ts).
crons.interval("market twins", { hours: 1 }, internal.arcTwins.tick, {});
// The app store's housekeeping (convex/appStore.ts).
crons.interval("app store sweep", { minutes: 30 }, internal.appStore.sweep, {});
// The watchdog: admin alerts (convex/arcWatch.ts).
crons.interval("arc watchdog", { minutes: 30 }, internal.arcWatch.tick, {});
// Mimir Launch agents: no-op until LAUNCH_ARC=1.
crons.interval("launch arc", { minutes: 30 }, internal.launchArc.tick, {});
crons.interval("launch agent markets", { hours: 2 }, internal.launchMarketsDb.createAll, {});
export default crons;
