import type { Page } from "@playwright/test";

/** Id used for the fixture claim; the API calls for it are intercepted. */
export const FIXTURE_CLAIM_ID = 424242;

const CREATOR = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const CHALLENGER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const now = () => Math.floor(Date.now() / 1000);

/** A live (ACTIVE, one challenger) claim in the /api/arena/[id] shape. */
export function fixtureClaim() {
  const t = now();
  return {
    id: FIXTURE_CLAIM_ID,
    creator: CREATOR,
    question: "Will SOL trade above $250 on Binance by the deadline?",
    creatorPosition: "Yes, SOL closes above $250",
    counterPosition: "No, SOL stays at or below $250",
    resolutionUrl: "https://www.binance.com/en/trade/SOL_USDT",
    category: "crypto",
    creatorStake: "5000000",
    totalChallengerStake: "2000000",
    deadline: t + 86_400,
    state: 1,
    winnerSide: 0,
    resolutionSummary: "",
    confidence: 0,
    createdAt: t - 3_600,
    maxChallengers: 8,
    delegated: true,
    challengers: [{ addr: CHALLENGER, stake: "2000000", paid: false }],
    creatorPaid: false,
    proposedSide: 0,
    proposedAt: 0,
    disputableUntil: 0,
    disputer: "",
    disputedAt: 0,
    bond: "0",
    bondState: 0,
    disputeWindow: 86_400,
    resolutionGrace: 604_800,
    resolvedAt: 0,
    creatorAgent: "",
    platformFeeBps: 100,
    agentFeeBps: 0,
    totalFees: "0",
  };
}

/** Route the fixture claim's API calls to canned responses. */
export async function mockFixtureClaim(page: Page): Promise<void> {
  await page.route(`**/api/arena/${FIXTURE_CLAIM_ID}`, (route) =>
    route.fulfill({ json: { success: true, data: fixtureClaim() } }),
  );
  await page.route(`**/api/arena/${FIXTURE_CLAIM_ID}/council`, (route) =>
    route.fulfill({
      json: { claimId: FIXTURE_CLAIM_ID, total: 0, stakedCount: 0, totalUsdc: 0, votes: [] },
    }),
  );
}
