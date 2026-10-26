/** Optional product funnel events. Never send wallet addresses, signatures, prompts or funding amounts. */
export type ProductEvent = "mimir_visit" | "preview_created" | "trial_created" | "live_agent_created" | "launch_funded" | "agent_launched" | "copy_started" | "copy_funded";
import posthog from "posthog-js";
export function trackProductEvent(event: ProductEvent, props: { mode?: "paper" | "live"; chain?: string; page?: "home" | "preview" | "agents" | "markets" | "other" } = {}) {
  if (typeof window === "undefined" || navigator.doNotTrack === "1" || !process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  // instrumentation-client.ts owns initialization and /ingest routing. Do not initialize the singleton twice.
  try { posthog.capture(event, { ...props, $current_url: window.location.origin, $pathname: props.page ?? "product-flow", $referrer: "", $referring_domain: "" }); } catch { /* Analytics never block a user action. */ }
}
