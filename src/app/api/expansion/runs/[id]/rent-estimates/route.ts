import { estimateRentsForRun } from "../../../../../../features/expansion/backend/rent-estimates.ts";
import { localResponse } from "../../../../../../features/expansion/backend/http.ts";
import { ownerRoute } from "../../../../../../features/expansion/backend/api.ts";

export const dynamic = "force-dynamic";

/**
 * Deterministic base-rent estimates for this run's unlisted-rent candidates.
 * Estimates never change the matching assessment; owner scope only.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return ownerRoute(request, async ({ ownerId: sessionId }) => {
    const { id } = await context.params;
    return localResponse(estimateRentsForRun({}, sessionId, id));
  }, { issue: false });
}
