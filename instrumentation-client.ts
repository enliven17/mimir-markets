/**
 * PostHog: product analytics, web analytics and session replay. Off until
 * NEXT_PUBLIC_POSTHOG_KEY is set (the project's public key). Traffic goes
 * through our own /ingest (next.config.js rewrites), so ad blockers and the
 * CSP see a same-origin call. Replays mask every input; anything secret on
 * screen (the recovery phrase) also carries `ph-no-capture`.
 */
import posthog from "posthog-js";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
if (key) {
  try {
    posthog.init(key, {
      api_host: "/ingest",
      ui_host: process.env.NEXT_PUBLIC_POSTHOG_REGION === "eu" ? "https://eu.posthog.com" : "https://us.posthog.com",
      // Pageviews on client-side navigation, exceptions captured, the current recommended settings.
      defaults: "2025-05-24",
      capture_exceptions: true,
      person_profiles: "identified_only",
      session_recording: { maskAllInputs: true },
    });
  } catch (err) {
    console.warn("[posthog] init failed:", err);
  }
}
