import { ensureSession } from "./account-client.ts";
import { z } from "zod";
import { investigationRunSchema, type InvestigationRun } from "../../domain/decision-brief.ts";
import { sourceSnapshotSchema } from "../../domain/evidence.ts";
import { nearbyExplanationSchema, nearbyRestaurantsResultSchema, type NearbyExplanation, type NearbyRestaurantsResult } from "../../domain/nearby-restaurants.ts";

async function read(url: string, signal?: AbortSignal): Promise<unknown> {
  await ensureSession().catch(() => null);
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 404 ? "Run or evidence not found in your workspace." : "Investigation could not load. Retry without changing saved evidence.");
  return response.json();
}
/** Read-only adapter for the existing Phase 3 v1 APIs. No alternate run system. */
export async function loadInvestigationRun(runId: string, signal?: AbortSignal): Promise<InvestigationRun> {
  z.string().regex(/^[a-zA-Z0-9-]{1,64}$/).parse(runId);
  const root = `/api/expansion/agent-runs/${encodeURIComponent(runId)}`;
  const names = ["profile", "candidates", "summary", "market", "inspection", "finance"] as const;
  const [run, ...artifacts] = await Promise.all([read(root, signal), ...names.map(name => read(`${root}/artifacts/${name}`, signal).catch(error => {
    if (["market", "inspection", "finance"].includes(name) && !signal?.aborted) return null;
    throw error;
  }))]);
  return investigationRunSchema.parse({ run, profile: artifacts[0], search: artifacts[1], summary: artifacts[2], market: artifacts[3], inspection: artifacts[4], finance: artifacts[5] });
}
export async function refreshCandidateSources(runId: string, candidateId: string, options: { currentAddress: string | null; priceLevel: number | null; sourceMode?: "live" | "synthetic"; scope?: "all" | "neighborhood" }, signal?: AbortSignal) {
  const params = new URLSearchParams({ candidateId });
  if (options.scope) params.set("scope", options.scope);
  if (options.sourceMode === "synthetic") params.set("sourceMode", "synthetic");
  if (options.currentAddress) params.set("currentAddress", options.currentAddress);
  if (options.priceLevel !== null) params.set("priceLevel", String(options.priceLevel));
  return sourceSnapshotSchema.parse(await read(`/api/expansion/investigations/${encodeURIComponent(runId)}?${params}`, signal));
}

/** Live Google Places context; never cached or saved by the client. */
export async function loadNearbyRestaurants(runId: string, candidateId: string, cuisine: string | null, signal?: AbortSignal): Promise<NearbyRestaurantsResult> {
  await ensureSession().catch(() => null);
  const params = new URLSearchParams({ candidateId });
  if (cuisine?.trim()) params.set("cuisine", cuisine.trim().slice(0, 120));
  const response = await fetch(`/api/expansion/investigations/${encodeURIComponent(runId)}/nearby-restaurants?${params}`, { signal, cache: "no-store" });
  const parsed = nearbyRestaurantsResultSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error(response.status === 404 ? "This place is not in your current search." : "Nearby restaurants could not load. Retry.");
  return parsed.data;
}

export async function explainNearbyRestaurantsRequest(runId: string, input: { candidateId: string; cuisine: string | null; restaurantName: string | null }, signal?: AbortSignal): Promise<{ result: NearbyRestaurantsResult; explanation: NearbyExplanation }> {
  await ensureSession().catch(() => null);
  const body = Object.fromEntries(Object.entries({ candidateId: input.candidateId, cuisine: input.cuisine?.trim().slice(0, 120), restaurantName: input.restaurantName?.trim().slice(0, 160) }).filter(([, v]) => v));
  const response = await fetch(`/api/expansion/investigations/${encodeURIComponent(runId)}/nearby-restaurants`, { method: "POST", signal, cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(json?.error?.message ?? "The explanation could not be generated. Retry.");
  return z.object({ result: nearbyRestaurantsResultSchema, explanation: nearbyExplanationSchema }).parse(json);
}
