import { z } from "zod";
import { investigationCandidate } from "../../../../../features/expansion/backend/investigation.ts";
import { collectCandidateSources } from "../../../../../features/expansion/backend/investigation-sources.ts";
import { localFailure, localResponse } from "../../../../../features/expansion/backend/http.ts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const querySchema = z.object({ candidateId: z.string().min(1).max(300), currentAddress: z.string().trim().min(1).max(300).optional(), priceLevel: z.coerce.number().finite().positive().max(10000).optional() }).strict();
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].length !== new Set(params.keys()).size) return localResponse({ error: { code: "invalid_query", message: "Duplicate query parameters." } }, 400);
    const query = querySchema.parse(Object.fromEntries(params));
    const { id } = await context.params;
    const candidate = investigationCandidate(id, query.candidateId, request.headers.get("x-expansion-session") ?? "local");
    const snapshot = await collectCandidateSources(candidate, { currentAddress: query.currentAddress ?? null, priceLevel: query.priceLevel ?? null });
    for (const observation of snapshot.observations) if (observation.provider === "vexcel") observation.imageUrl = `/api/expansion/investigations/${encodeURIComponent(id)}/imagery?candidateId=${encodeURIComponent(candidate.id)}`;
    return localResponse(snapshot);
  } catch (error) { return localFailure(error); }
}
