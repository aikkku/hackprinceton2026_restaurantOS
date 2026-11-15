import { agentRunRecordSchema } from "../../../../../features/expansion/domain/agent.ts";
import { getAgentRun } from "../../../../../features/expansion/backend/agent.ts";
import { localResponse } from "../../../../../features/expansion/backend/http.ts";
import { isNotFound, ownerRoute, scheduleRunSync } from "../../../../../features/expansion/backend/api.ts";
import { getRepository } from "../../../../../features/expansion/backend/store.ts";
import { durableRun } from "../../../../../features/expansion/backend/durable.ts";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return ownerRoute(request, async ({ ownerId }) => {
    const { id } = await context.params;
    try {
      const record = agentRunRecordSchema.parse(getAgentRun({}, ownerId, id));
      scheduleRunSync(ownerId, id);
      return localResponse(record);
    } catch (error) {
      // Durable fallback: the run directory may be gone (new host / disk loss).
      const repo = isNotFound(error) ? await getRepository() : null;
      const durable = repo ? await durableRun(repo, ownerId, id).catch(() => null) : null;
      if (durable) return localResponse(durable);
      throw error;
    }
  }, { issue: false });
}
