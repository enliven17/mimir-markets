import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
// ~86k runs a month, well inside the free 1M calls.
crons.interval("arc indexer", { seconds: 30 }, internal.arcSync.sync, {});
export default crons;
