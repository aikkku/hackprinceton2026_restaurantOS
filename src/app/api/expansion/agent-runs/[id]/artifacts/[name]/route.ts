import {
  agentArtifactNames,
  type AgentArtifactName,
} from "../../../../../../../features/expansion/domain/agent.ts";
import { getAgentArtifact, getAgentEvidence } from "../../../../../../../features/expansion/backend/agent.ts";
import { localResponse } from "../../../../../../../features/expansion/backend/http.ts";
import { isNotFound, ownerRoute } from "../../../../../../../features/expansion/backend/api.ts";
import { getRepository } from "../../../../../../../features/expansion/backend/store.ts";
import { durableArtifact } from "../../../../../../../features/expansion/backend/durable.ts";

export const dynamic = "force-dynamic";

/**
 * Phase 3 artifacts plus the Phase 5 server-written `evidence` side artifact
 * (Phase 4 live source snapshots for the inspected spaces; `null` when none).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; name: string }> },
) {
  return ownerRoute(request, async ({ ownerId }) => {
    const { id, name } = await context.params;
    const isEvidence = name === "evidence";
    if (!isEvidence && !(agentArtifactNames as readonly string[]).includes(name)) {
      return localResponse({ error: { code: "invalid_query", message: "Unknown agent artifact name." } }, 400);
    }
    try {
      return localResponse(isEvidence ? getAgentEvidence({}, ownerId, id) : getAgentArtifact({}, ownerId, id, name as AgentArtifactName));
    } catch (error) {
      // Durable fallback when the run directory is gone (new host / disk loss).
      const repo = isNotFound(error) ? await getRepository() : null;
      const durable = repo ? await durableArtifact(repo, ownerId, id, isEvidence ? "evidence" : name as AgentArtifactName).catch(() => null) : null;
      if (durable) return localResponse(durable);
      throw error;
    }
  }, { issue: false });
}
