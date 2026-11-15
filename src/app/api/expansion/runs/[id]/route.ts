import { getRun, runSchema } from "../../../../../features/expansion/backend/runs.ts";
import { localResponse } from "../../../../../features/expansion/backend/http.ts";

import { ownerRoute } from "../../../../../features/expansion/backend/api.ts";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return ownerRoute(request, async ({ ownerId: sessionId }) => {
    const { id } = await context.params;
    return localResponse(runSchema.parse(getRun({}, sessionId, id)));
  }, { issue: false });
}
