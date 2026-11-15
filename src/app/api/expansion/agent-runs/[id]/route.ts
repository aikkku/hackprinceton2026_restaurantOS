import { agentRunRecordSchema } from "../../../../../features/expansion/domain/agent.ts";
import { getAgentRun } from "../../../../../features/expansion/backend/agent.ts";
import { localFailure, localResponse } from "../../../../../features/expansion/backend/http.ts";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const sessionId = request.headers.get("x-expansion-session") ?? "local";
    return localResponse(agentRunRecordSchema.parse(getAgentRun({}, sessionId, id)));
  } catch (error) {
    return localFailure(error);
  }
}
