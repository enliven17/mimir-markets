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
import type * as crons from "../crons.js";

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
  crons: typeof crons;
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
