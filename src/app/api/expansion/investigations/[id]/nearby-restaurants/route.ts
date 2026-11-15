import { z } from "zod";
import { investigationTarget } from "../../../../../../features/expansion/backend/investigation.ts";
import { explainNearbyRestaurants, fetchNearbyRestaurants, PlacesError } from "../../../../../../features/expansion/backend/google-places.ts";
import { localResponse } from "../../../../../../features/expansion/backend/http.ts";
import { ownerRoute } from "../../../../../../features/expansion/backend/api.ts";
import type { NearbyRestaurantsResult } from "../../../../../../features/expansion/domain/nearby-restaurants.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Live Google Places context. Responses are `private, no-store` and nothing
 * here is written to evidence, agent artifacts or saved plans (Google terms).
 */
const HTTP: Record<NearbyRestaurantsResult["status"], number> = { ok: 200, synthetic: 200, no_coordinates: 200, not_configured: 503, unavailable: 503, timeout: 504, denied: 502, rate_limited: 429 };
const text = (max: number) => z.string().trim().min(1).max(max).optional();
const querySchema = z.object({ candidateId: z.string().min(1).max(300), cuisine: text(120) }).strict();
const bodySchema = z.object({ candidateId: z.string().min(1).max(300), cuisine: text(120), restaurantName: text(160) }).strict();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return ownerRoute(request, async ({ ownerId }) => {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const { id } = await context.params;
    const { candidate } = investigationTarget(id, query.candidateId, ownerId);
    const result = await fetchNearbyRestaurants(candidate, query.cuisine ?? null);
    return localResponse(result, HTTP[result.status]);
  }, { issue: false });
}

/** Re-fetches server-side; the client never supplies the Places content being explained. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return ownerRoute(request, async ({ ownerId }) => {
    const body = bodySchema.parse(await request.json());
    const { id } = await context.params;
    const { candidate } = investigationTarget(id, body.candidateId, ownerId);
    const result = await fetchNearbyRestaurants(candidate, body.cuisine ?? null);
    if (result.status !== "ok") return localResponse({ error: { code: result.status, message: result.message } }, HTTP[result.status]);
    if (!result.restaurants.length) return localResponse({ error: { code: "empty", message: "Google returned no restaurants within 500 m, so there is nothing to compare. That is not proof of no competition." } }, 409);
    try { return localResponse({ result, explanation: await explainNearbyRestaurants(result, body.restaurantName ?? null) }); }
    catch (error) {
      const message = error instanceof PlacesError ? error.message : "The AI explanation could not be generated.";
      return localResponse({ error: { code: error instanceof PlacesError ? error.status : "unavailable", message } }, error instanceof PlacesError && error.status === "not_configured" ? 503 : 502);
    }
  }, { issue: false });
}
