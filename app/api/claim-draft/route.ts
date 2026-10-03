import { NextResponse } from "next/server";

import { generateClaimDrafts } from "@/lib/server/source-claim-generator";
import { createApiError } from "@/lib/server/api-validation";
import { clientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { allowLlmRequest, parseClaimDraftBody } from "@/lib/server/llm-route-guard";
import { readLimitedJson } from "@/lib/server/body-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_FEATURE_SOURCE_DRAFTS !== "1") {
    return NextResponse.json(
      createApiError("feature_disabled", "Source drafting is not enabled"),
      { status: 404 }
    );
  }

  // Each draft is a fetch plus a Gemini call; ten a minute per IP is plenty
  // for a human, and the deploy-wide ceiling caps rotating IPs.
  if (
    !(await allowLlmRequest({
      bucket: "claim-draft",
      key: clientIp(request),
      perKey: 10,
      globalEnv: "CLAIM_DRAFT_GLOBAL_PER_MIN",
      globalDefault: 30,
    }))
  ) {
    return tooManyRequests(60);
  }

  const read = await readLimitedJson(request);
  if (!read.ok) {
    return NextResponse.json(
      createApiError("invalid_request", read.status === 413 ? "Request body is too large" : "Request body must be valid JSON"),
      { status: read.status }
    );
  }
  const parsed = parseClaimDraftBody(read.value);
  if ("error" in parsed) {
    return NextResponse.json(createApiError("invalid_request", parsed.error), { status: 400 });
  }
  const { url, locale } = parsed;

  try {
    const result = await generateClaimDrafts({ sourceUrl: url, locale });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to draft claim suggestions";
    const status =
      /not configured|not enabled/i.test(message)
        ? 503
        : /valid source URL|not supported|did not produce|readable text|Unable to fetch source|must be an HTML or text page/i.test(
              message
            )
          ? 400
          : 500;

    if (status === 500) console.error("[api/claim-draft] failed:", error);
    // 400/503 messages are our own validation text; anything else may carry
    // upstream or network detail and stays in the log.
    return NextResponse.json(
      createApiError(
        "claim_draft_error",
        status === 500 ? "Unable to draft claim suggestions right now" : message
      ),
      { status }
    );
  }
}

