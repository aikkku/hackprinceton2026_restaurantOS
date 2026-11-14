import {
  marketsResponseSchema,
  propertyDetailResponseSchema,
  queryResponseSchema,
} from "../../domain/local-data.ts";
import type { z } from "zod";

export type Viewport = [number, number, number, number];
export class LocalDataError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

async function request<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal) {
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
