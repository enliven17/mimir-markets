import { moderateClaim } from "@/lib/server/claim-moderation";
import { handleClaimModerationPost } from "@/lib/server/claim-moderation-route-handler";
import { allowLlmRequest } from "@/lib/server/llm-route-guard";
import { clientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  // One flooding client would otherwise exhaust the shared Gemini quota and
  // trip the global cooldown for everyone; now it hits its own limit first,
  // and the deploy-wide ceiling caps what rotating IPs can spend.
  if (
    !(await allowLlmRequest({
      bucket: "claim-moderation",
      key: clientIp(request),
      perKey: 20,
      globalEnv: "CLAIM_MODERATION_GLOBAL_PER_MIN",
      globalDefault: 120,
    }))
  ) {
    return tooManyRequests(60);
  }
  return handleClaimModerationPost({ request, moderateClaim });
}
