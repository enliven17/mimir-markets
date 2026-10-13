import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// MIMIR_BACKEND_OFF=1 in a deployment's env turns every job below into a no-op (the old testnet backend).
// Node actions (oracle, council, watchdog, creator) are what the Convex compute quota pays for: keep them sparse.
const crons = cronJobs();
// ~86k runs a month, well inside the free 1M calls.
crons.interval("arc indexer", { seconds: 30 }, internal.arcSync.sync, {});
// Settles, finalizes, refunds and pays (convex/arcOracle.ts); a run that overlaps the next tick is skipped by Convex.
crons.interval("arc oracle", { minutes: 2 }, internal.arcOracle.tick, {});
// The council: a few persona decisions per tick, each at most one throttled LLM call (convex/arcCouncil.ts).
crons.interval("arc council", { minutes: 15 }, internal.arcCouncil.tick, {});
// The house market creator: drafts and opens two-sided pools hourly (convex/arcCreator.ts).
crons.interval("arc market creator", { hours: 1 }, internal.arcCreator.tick, {});
// The app store's housekeeping: expired relay answers, old rate-limit windows, nonces and replies (convex/appStore.ts).
crons.interval("app store sweep", { minutes: 10 }, internal.appStore.sweep, {});
// The watchdog: problems that need a human go to the admin Telegram (convex/arcWatch.ts).
crons.interval("arc watchdog", { minutes: 10 }, internal.arcWatch.tick, {});
// Mimir Launch agents staking on markets (convex/launchArc.ts); a no-op until LAUNCH_ARC=1.
crons.interval("launch arc", { minutes: 5 }, internal.launchArc.tick, {});
// Mimir Launch agents trading on Solana: a cheap mutation fans out one action per due agent (convex/launchSolDb.ts); a no-op until LAUNCH_SOLANA=1.
crons.interval("launch solana", { seconds: 30 }, internal.launchSolDb.tickAll, {});
// Mimir Launch creator fees (convex/launchFeeDb.ts fans out convex/launchFees.ts): hourly claims and payouts, holder
// snapshots every 2 h, airdrop checks every 30 min. All no-ops until LAUNCH_FEES=1.
crons.interval("launch fees", { hours: 1 }, internal.launchFeeDb.feeAll, {});
crons.interval("launch holder snapshots", { hours: 2 }, internal.launchFeeDb.snapshotAll, {});
crons.interval("launch holder airdrops", { minutes: 30 }, internal.launchFeeDb.airdropAll, {});
export default crons;
