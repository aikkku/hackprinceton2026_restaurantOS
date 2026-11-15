import {
  agentArtifactNames,
  type AgentArtifactName,
} from "../../../../../../../features/expansion/domain/agent.ts";
import { getAgentArtifact } from "../../../../../../../features/expansion/backend/agent.ts";
import { localFailure, localResponse } from "../../../../../../../features/expansion/backend/http.ts";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; name: string }> },
) {
  try {
    const { id, name } = await context.params;
    if (!(agentArtifactNames as readonly string[]).includes(name)) {
      return localResponse({ error: { code: "invalid_query", message: "Unknown agent artifact name." } }, 400);
    }
    const sessionId = request.headers.get("x-expansion-session") ?? "local";
    const artifact = getAgentArtifact({}, sessionId, id, name as AgentArtifactName);
    return localResponse(artifact);
  } catch (error) {
    return localFailure(error);
  }
}
