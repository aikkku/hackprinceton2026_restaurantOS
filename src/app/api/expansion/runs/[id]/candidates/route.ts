import {
  getRunCandidates,
  runCandidatesPageSchema,
} from "../../../../../../features/expansion/backend/runs.ts";
import { localResponse } from "../../../../../../features/expansion/backend/http.ts";

import { ownerRoute } from "../../../../../../features/expansion/backend/api.ts";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return ownerRoute(request, async ({ ownerId: sessionId }) => {
    const { id } = await context.params;
    const params = new URL(request.url).searchParams;
    const page = {
      offset: params.get("offset") === null ? undefined : Number(params.get("offset")),
      limit: params.get("limit") === null ? undefined : Number(params.get("limit")),
      group: params.get("group"),
    };
    return localResponse(runCandidatesPageSchema.parse(getRunCandidates({}, sessionId, id, page)));
  }, { issue: false });
}
