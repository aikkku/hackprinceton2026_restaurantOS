import { ensureSession } from "./account-client.ts";
import {
  marketsResponseSchema,
  propertyDetailResponseSchema,
  queryResponseSchema,
} from "../../domain/local-data.ts";
import {
  runCandidatesPageSchema,
  runSchema,
  type RunCandidatesPage,
  type RunRecord,
} from "../../domain/runs.ts";
import type { RestaurantIntake } from "../../domain/intake.ts";
import type { CandidateFact } from "../../domain/matching.ts";
import type { z } from "zod";

export type Viewport = [number, number, number, number];
export class LocalDataError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

async function request<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal) {
  if (url.startsWith("/api/expansion/runs")) await ensureSession().catch(() => null);
  const response = await fetch(url, { signal, cache: "no-store" });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body
      ? typeof body.error === "string" ? body.error : body.error && typeof body.error === "object" && "message" in body.error && typeof body.error.message === "string" ? body.error.message : "The local data source could not be read."
      : "The local data source could not be read.";
    const code = body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object" && "code" in body.error && typeof body.error.code === "string" ? body.error.code : undefined;
    throw new LocalDataError(message, response.status, code);
  }
  return schema.parse(body);
}

export const loadMarkets = (signal?: AbortSignal) =>
  request("/api/expansion/markets", marketsResponseSchema, signal);

export function loadLocalArea({ cityId, bounds, budget, minimumArea, offset = 0, signal }: {
  cityId: string; bounds: Viewport; budget: number; minimumArea: number;
  offset?: number; signal?: AbortSignal;
}) {
  const [west, south, east, north] = bounds;
  const params = new URLSearchParams({ cityId, west: String(west), south: String(south),
    east: String(east), north: String(north), monthlyBudget: String(budget),
    minimumArea: String(minimumArea), includeUnknown: "true", limit: "100", offset: String(offset) });
  return request(`/api/expansion/query?${params}`, queryResponseSchema, signal);
}

export const loadLocalProperty = (id: string, signal?: AbortSignal) =>
  request(`/api/expansion/properties/${encodeURIComponent(id)}`, propertyDetailResponseSchema, signal);

// ---------------------------------------------------------------------------
// Profile-driven citywide run client (Phase 2). The same run service backs
// the browser flow; the acceptance e2e must not mock these routes.

async function postJson<T>(url: string, body: unknown, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  await ensureSession().catch(() => null);
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  const parsed: unknown = await response.json();
  if (!response.ok) {
    const message = parsed && typeof parsed === "object" && "error" in parsed && parsed.error && typeof parsed.error === "object" && "message" in parsed.error && typeof parsed.error.message === "string"
      ? parsed.error.message
      : "The request failed.";
    throw new LocalDataError(message, response.status);
  }
  return schema.parse(parsed);
}

export function createProfileRun(body: {
  runId: string;
  cityId: string;
  intake: RestaurantIntake;
  revisionId: string;
  revisionNumber: number;
  facts?: CandidateFact[];
}, signal?: AbortSignal): Promise<RunRecord> {
  return postJson("/api/expansion/runs", body, runSchema, signal);
}

export const getProfileRun = (runId: string, signal?: AbortSignal): Promise<RunRecord> =>
  request(`/api/expansion/runs/${encodeURIComponent(runId)}`, runSchema, signal);

export function getRunCandidatesRequest(
  runId: string,
  page: { offset?: number; limit?: number; group?: string | null } = {},
  signal?: AbortSignal,
): Promise<RunCandidatesPage> {
  const params = new URLSearchParams();
  if (page.offset !== undefined) params.set("offset", String(page.offset));
  if (page.limit !== undefined) params.set("limit", String(page.limit));
  if (page.group) params.set("group", page.group);
  const query = params.size ? `?${params}` : "";
  return request(`/api/expansion/runs/${encodeURIComponent(runId)}/candidates${query}`, runCandidatesPageSchema, signal);
}

export const cancelProfileRun = (runId: string, signal?: AbortSignal): Promise<RunRecord> =>
  postJson(`/api/expansion/runs/${encodeURIComponent(runId)}/cancel`, {}, runSchema, signal);
