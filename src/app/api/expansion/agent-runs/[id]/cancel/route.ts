import { agentRunRecordSchema } from "../../../../../../features/expansion/domain/agent.ts";
import { cancelAgentRun } from "../../../../../../features/expansion/backend/agent.ts";
import { localFailure, localResponse } from "../../../../../../features/expansion/backend/http.ts";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const sessionId = request.headers.get("x-expansion-session") ?? "local";
    return localResponse(agentRunRecordSchema.parse(cancelAgentRun({}, sessionId, id)));
  } catch (error) {
    return localFailure(error);
  }
}
