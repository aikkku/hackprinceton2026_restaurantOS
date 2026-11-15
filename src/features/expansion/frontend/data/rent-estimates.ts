import { ensureSession } from "./account-client.ts";
import {
  estimateRentsResponseSchema,
  type RentEstimate,
} from "../../domain/rent-estimate.ts";

export class RentEstimatesError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

/**
 * Load deterministic base-rent estimates for a finished run's unlisted-rent
 * candidates. Estimates are an enhancement: callers treat a failure as "no
 * estimates" rather than a workspace failure.
 */
export async function loadRentEstimates(
  runId: string,
  source: "agent" | "deterministic",
  signal?: AbortSignal,
): Promise<Map<string, RentEstimate>> {
  await ensureSession().catch(() => null);
  const base =
    source === "agent"
      ? `/api/expansion/agent-runs/${encodeURIComponent(runId)}/rent-estimates`
      : `/api/expansion/runs/${encodeURIComponent(runId)}/rent-estimates`;
  const response = await fetch(base, { signal, cache: "no-store" });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error =
      body && typeof body === "object" && "error" in body && body.error &&
      typeof body.error === "object"
        ? (body.error as { code?: unknown; message?: unknown })
        : {};
    throw new RentEstimatesError(
      typeof error.message === "string" ? error.message : "Rent estimates could not load.",
      response.status,
      typeof error.code === "string" ? error.code : undefined,
    );
  }
  const parsed = estimateRentsResponseSchema.parse(body);
  return new Map(
    parsed.estimates
      .filter((entry) => entry.estimate !== null)
      .map((entry) => [entry.candidateId, entry.estimate as RentEstimate]),
  );
}
