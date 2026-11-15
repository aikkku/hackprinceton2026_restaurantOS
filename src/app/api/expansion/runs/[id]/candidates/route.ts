import {
  getRunCandidates,
  runCandidatesPageSchema,
} from "../../../../../../features/expansion/backend/runs.ts";
import { localFailure, localResponse } from "../../../../../../features/expansion/backend/http.ts";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const sessionId = request.headers.get("x-expansion-session") ?? "local";
    const params = new URL(request.url).searchParams;
    const page = {
      offset: params.get("offset") === null ? undefined : Number(params.get("offset")),
      limit: params.get("limit") === null ? undefined : Number(params.get("limit")),
      group: params.get("group"),
    };
    return localResponse(runCandidatesPageSchema.parse(getRunCandidates({}, sessionId, id, page)));
  } catch (error) {
    return localFailure(error);
  }
}
