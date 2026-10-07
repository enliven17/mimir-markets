import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
// ~86k runs a month, well inside the free 1M calls.
crons.interval("arc indexer", { seconds: 30 }, internal.arcSync.sync, {});
// Settles, finalizes, refunds and pays (convex/arcOracle.ts); a run that overlaps the next tick is skipped by Convex.
crons.interval("arc oracle", { minutes: 1 }, internal.arcOracle.tick, {});
// The council: a few persona decisions per tick, each at most one throttled LLM call (convex/arcCouncil.ts).
crons.interval("arc council", { minutes: 5 }, internal.arcCouncil.tick, {});
// The house market creator: drafts and opens VS markets hourly (convex/arcCreator.ts).
crons.interval("arc market creator", { hours: 1 }, internal.arcCreator.tick, {});
export default crons;
