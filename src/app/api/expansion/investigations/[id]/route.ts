import { z } from "zod";
import { investigationTarget } from "../../../../../features/expansion/backend/investigation.ts";
import { collectCandidateSources, collectNeighborhoodSources } from "../../../../../features/expansion/backend/investigation-sources.ts";
import { syntheticSourceSnapshot } from "../../../../../features/expansion/backend/synthetic-sources.ts";
import { localResponse } from "../../../../../features/expansion/backend/http.ts";
import { ownerRoute } from "../../../../../features/expansion/backend/api.ts";
import { getRepository } from "../../../../../features/expansion/backend/store.ts";
import { recordEvidence } from "../../../../../features/expansion/backend/durable.ts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const querySchema = z.object({ candidateId: z.string().min(1).max(300), currentAddress: z.string().trim().min(1).max(300).optional(), priceLevel: z.coerce.number().finite().positive().max(10000).optional(), scope: z.enum(["all", "neighborhood"]).default("all"), sourceMode: z.enum(["live", "synthetic"]).default("live") }).strict();
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return ownerRoute(request, async ({ ownerId }) => {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].length !== new Set(params.keys()).size) return localResponse({ error: { code: "invalid_query", message: "Duplicate query parameters." } }, 400);
    const query = querySchema.parse(Object.fromEntries(params));
    const { id } = await context.params;
    // Ownership: only a finished run in the caller's own workspace can be probed.
    const { candidate, datasetId } = investigationTarget(id, query.candidateId, ownerId);
    const options = { currentAddress: query.currentAddress ?? null, priceLevel: query.priceLevel ?? null };
    // Synthetic fixtures are an explicit request and only for synthetic candidates (409 otherwise).
    const snapshot = query.sourceMode === "synthetic"
      ? syntheticSourceSnapshot(candidate, datasetId, options, new Date().toISOString())
      : query.scope === "neighborhood" ? await collectNeighborhoodSources(candidate) : await collectCandidateSources(candidate, options);
    if (query.sourceMode === "live") for (const observation of snapshot.observations) if (observation.provider === "vexcel") observation.imageUrl = `/api/expansion/investigations/${encodeURIComponent(id)}/imagery?candidateId=${encodeURIComponent(candidate.id)}`;
    // Durable evidence record (best effort; the response never depends on it).
    void getRepository().then(repo => repo ? recordEvidence(repo, ownerId, id, snapshot, query.sourceMode) : null).catch(() => {});
    return localResponse(snapshot);
  }, { issue: false });
}
