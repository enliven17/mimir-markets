import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
// Dedicated Solana deployment. MIMIR_BACKEND_OFF keeps development workers idle.
const crons = cronJobs();
crons.interval("solana indexer", { seconds: 30 }, internal.solanaWorkers.sync, {});
crons.interval("solana oracle", { minutes: 2 }, internal.solanaWorkers.oracle, {});
crons.interval("solana council", { minutes: 15 }, internal.solanaAutomation.council, {});
crons.interval("solana creator", { hours: 1 }, internal.solanaAutomation.creator, {});
crons.interval("solana agents", { minutes: 5 }, internal.solanaAutomation.agents, {});
crons.interval("discovery cleanup", { hours: 1 }, internal.discovery.sweep, {});
crons.interval("app store sweep", { minutes: 10 }, internal.appStore.sweep, {});
export default crons;
