import { agentRunRecordSchema } from "../../../../../../features/expansion/domain/agent.ts";
import { cancelAgentRun } from "../../../../../../features/expansion/backend/agent.ts";
import { localResponse } from "../../../../../../features/expansion/backend/http.ts";
import { ownerRoute, scheduleRunSync } from "../../../../../../features/expansion/backend/api.ts";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return ownerRoute(request, async ({ ownerId }) => {
    const { id } = await context.params;
    const record = agentRunRecordSchema.parse(cancelAgentRun({}, ownerId, id));
    scheduleRunSync(ownerId, id);
    return localResponse(record);
  }, { issue: false });
}
