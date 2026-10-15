/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appStore from "../appStore.js";
import type * as arc from "../arc.js";
import type * as arcAdmin from "../arcAdmin.js";
import type * as arcCouncil from "../arcCouncil.js";
import type * as arcCouncilDb from "../arcCouncilDb.js";
import type * as arcCreator from "../arcCreator.js";
import type * as arcCutover from "../arcCutover.js";
import type * as arcOracle from "../arcOracle.js";
import type * as arcSync from "../arcSync.js";
import type * as arcTriage from "../arcTriage.js";
import type * as arcViews from "../arcViews.js";
import type * as arcWatch from "../arcWatch.js";
import type * as arcWatchDb from "../arcWatchDb.js";
import type * as crons from "../crons.js";
import type * as launch from "../launch.js";
import type * as launchArc from "../launchArc.js";
import type * as launchArgus from "../launchArgus.js";
import type * as launchArgusDb from "../launchArgusDb.js";
import type * as launchCopy from "../launchCopy.js";
import type * as launchCopyJobs from "../launchCopyJobs.js";
import type * as launchFeeDb from "../launchFeeDb.js";
import type * as launchFees from "../launchFees.js";
import type * as launchMarkets from "../launchMarkets.js";
import type * as launchMarketsDb from "../launchMarketsDb.js";
import type * as launchSol from "../launchSol.js";
import type * as launchSolDb from "../launchSolDb.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appStore: typeof appStore;
  arc: typeof arc;
  arcAdmin: typeof arcAdmin;
  arcCouncil: typeof arcCouncil;
  arcCouncilDb: typeof arcCouncilDb;
  arcCreator: typeof arcCreator;
  arcCutover: typeof arcCutover;
  arcOracle: typeof arcOracle;
  arcSync: typeof arcSync;
  arcTriage: typeof arcTriage;
  arcViews: typeof arcViews;
  arcWatch: typeof arcWatch;
  arcWatchDb: typeof arcWatchDb;
  crons: typeof crons;
  launch: typeof launch;
  launchArc: typeof launchArc;
  launchArgus: typeof launchArgus;
  launchArgusDb: typeof launchArgusDb;
  launchCopy: typeof launchCopy;
  launchCopyJobs: typeof launchCopyJobs;
  launchFeeDb: typeof launchFeeDb;
  launchFees: typeof launchFees;
  launchMarkets: typeof launchMarkets;
  launchMarketsDb: typeof launchMarketsDb;
  launchSol: typeof launchSol;
  launchSolDb: typeof launchSolDb;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
