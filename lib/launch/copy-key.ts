/**
 * Mimir Launch: who an agent slug may be, and which copy subscriptions are whose. Council personas and launched
 * agents share the /launch/:slug space, so a launched agent may never take a persona's (or a house) name, and copy
 * subscriptions are keyed by kind ("council:socrates", "launch:odin"): a launch agent can never inherit a persona's
 * followers. Relative imports: Convex imports this.
 */
import { COUNCIL_PERSONAS } from "../../agents/council/personas";
import { isReservedAgentId } from "../agents/reserved";

const COUNCIL = new Set(COUNCIL_PERSONAS.map((p) => p.slug));

export const isCouncilSlug = (slug: string) => COUNCIL.has(slug);
/** A slug a launched agent may not use: a persona, a house role, or a look-alike of one. */
export const reservedLaunchSlug = (slug: string) => COUNCIL.has(slug) || isReservedAgentId(slug);

export const councilCopyKey = (slug: string) => `council:${slug}`;
export const launchCopyKey = (slug: string) => `launch:${slug}`;
/** The copy key behind a /launch/:slug page. */
export const copyKeyFor = (slug: string) => (COUNCIL.has(slug) ? councilCopyKey(slug) : launchCopyKey(slug));
