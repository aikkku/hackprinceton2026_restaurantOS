import { z } from "zod";
import { ownerRoute } from "../../../../features/expansion/backend/api.ts";
import { localResponse } from "../../../../features/expansion/backend/http.ts";
import { getAgentArtifact, getAgentRun } from "../../../../features/expansion/backend/agent.ts";
import { getRun, getStoredRunReport } from "../../../../features/expansion/backend/runs.ts";
import { loadOfficialNeighborhoods, neighborhoodSnapshot, topNeighborhoodCatalog } from "../../../../features/expansion/backend/neighborhoods.ts";
import { neighborhoodCatalog } from "../../../../features/expansion/domain/neighborhood.ts";
import { searchArtifactSchema } from "../../../../features/expansion/domain/agent.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public names from the same official dataset used for property assignment. */
export async function GET(request: Request) {
  return ownerRoute(request, async () => {
    try { return localResponse(topNeighborhoodCatalog(await loadOfficialNeighborhoods())); }
    catch { return localResponse({ error: "The City boundary or listing source is unavailable. No example names substituted." }, 503); }
  }, { issue: false });
}

/** Only candidates belonging to this owner's finished run can be assigned. */
export async function POST(request: Request) {
  return ownerRoute(request, async ({ ownerId }) => {
    const { runId, source } = z.object({ runId: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/), source: z.enum(["agent", "deterministic"]) }).parse(await request.json());
    const run = source === "agent" ? getAgentRun({}, ownerId, runId) : getRun({}, ownerId, runId);
    if (!["completed", "completed_with_gaps"].includes(run.status)) return localResponse({ error: "The run has not finished." }, 409);
    const candidates = source === "agent" ? searchArtifactSchema.parse(getAgentArtifact({}, ownerId, runId, "candidates")).candidates : getStoredRunReport({}, ownerId, runId).report.candidates;
    try {
      const dataset = await loadOfficialNeighborhoods();
      return localResponse({ catalog: neighborhoodCatalog(dataset), snapshots: candidates.map(item => neighborhoodSnapshot(item.candidate, dataset)) });
    } catch { return localResponse({ error: "Official neighborhood boundaries are unavailable. Property neighborhoods remain unassigned." }, 503); }
  }, { issue: false });
}
