import type { DatabaseSync } from "node:sqlite";
import { searchArtifactSchema } from "../domain/agent.ts";
import type { SpaceCandidate } from "../domain/matching.ts";
import {
  estimateRent,
  estimateRentsResponseSchema,
  RENT_ESTIMATES_RESPONSE_VERSION,
  type RentComparableRow,
  type RentEstimatesResponse,
} from "../domain/rent-estimate.ts";
import { getAgentArtifact, getAgentRun, type AgentServiceConfig } from "./agent.ts";
import { metadataFor } from "./candidate-search.ts";
import { LocalDataError, openDatabase } from "./local-dataset.ts";
import {
  getRun,
  getStoredRunReport,
  RunError,
  type RunServiceConfig,
} from "./runs.ts";

/**
 * Deterministic rent estimates for candidates whose asking rent is not
 * listed (Rain-owned backend).
 *
 * Estimates are computed from the SAME dated local snapshot the run used,
 * never from live networks or AI output. They are an enhancement: the
 * matching assessment is untouched, and a candidate with a listed rent gets
 * no entry at all.
 */

const COMPARABLE_COLUMNS =
  "id, city_id, lat, lon, rate_low, rate_high, rate_basis, currency_code, measurement_code, space_use, status_code";

function toComparable(row: Record<string, unknown>): RentComparableRow {
  const numberOrNull = (value: unknown): number | null =>
    value === null || value === undefined ? null : Number(value);
  return {
    id: String(row.id),
    cityId: String(row.city_id),
    latitude: numberOrNull(row.lat),
    longitude: numberOrNull(row.lon),
    rateLow: numberOrNull(row.rate_low),
    rateHigh: numberOrNull(row.rate_high),
    rateBasis: numberOrNull(row.rate_basis),
    currencyCode: numberOrNull(row.currency_code),
    measurementCode: numberOrNull(row.measurement_code),
    spaceUse: numberOrNull(row.space_use),
    statusCode: numberOrNull(row.status_code),
  };
}

/** A quoted rent is unusable when it is absent or has no rate bounds. */
const hasUnusableRent = (candidate: SpaceCandidate) =>
  candidate.rent === null || (candidate.rent.low === null && candidate.rent.high === null);

/**
 * Estimates for every candidate whose quoted rent is unusable. The `spaces`
 * table is queried once per run city; candidates with a listed rent get NO
 * entry in the array.
 */
export function rentEstimatesForCandidates(
  db: DatabaseSync,
  candidates: SpaceCandidate[],
  dataset: { datasetId: string; datasetDate: string | null },
): RentEstimatesResponse["estimates"] {
  const targets = candidates.filter(hasUnusableRent);
  if (targets.length === 0) return [];
  const comparablesByCity = new Map<string, RentComparableRow[]>();
  try {
    const statement = db.prepare(
      `SELECT ${COMPARABLE_COLUMNS} FROM spaces WHERE city_id = ?`,
    );
    for (const cityId of new Set(targets.map((candidate) => candidate.cityId))) {
      const rows = statement.all(cityId) as Array<Record<string, unknown>>;
      comparablesByCity.set(cityId, rows.map(toComparable));
    }
  } catch (error) {
    if (error instanceof LocalDataError) throw error;
    throw new LocalDataError("source_failure", "The local snapshot query failed. Rebuild the Expansion cache.");
  }
  return targets.map((candidate) => ({
    candidateId: candidate.id,
    estimate: estimateRent(
      {
        id: candidate.id,
        cityId: candidate.cityId,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        floorAreaSqFt: candidate.floorAreaSqFt,
        sizeRangeSqFt: candidate.sizeRangeSqFt,
      },
      comparablesByCity.get(candidate.cityId) ?? [],
      dataset,
    ),
  }));
}

function closeQuietly(db: DatabaseSync | null) {
  try {
    db?.close();
  } catch {
    /* already closed */
  }
}

function toLocalDataFailure(error: unknown): never {
  if (error instanceof LocalDataError || error instanceof RunError) throw error;
  throw new LocalDataError("source_failure", "The local snapshot query failed. Rebuild the Expansion cache.");
}

/** Deterministic-run flavor: estimates from a finished Phase 2 run's stored candidates. */
export function estimateRentsForRun(
  rawConfig: Partial<RunServiceConfig>,
  sessionId: string,
  runId: string,
): RentEstimatesResponse {
  const record = getRun(rawConfig, sessionId, runId);
  if (record.status !== "completed" && record.status !== "completed_with_gaps") {
    throw new RunError("conflict", "This search hasn't finished.");
  }
  const candidates = getStoredRunReport(rawConfig, sessionId, runId).report.candidates.map(
    (item) => item.candidate,
  );
  let db: DatabaseSync | null = null;
  try {
    db = openDatabase(rawConfig.db);
    const dataset = metadataFor(db);
    const estimates = rentEstimatesForCandidates(db, candidates, dataset);
    return estimateRentsResponseSchema.parse({
      modelVersion: RENT_ESTIMATES_RESPONSE_VERSION,
      runId,
      datasetId: dataset.datasetId,
      datasetDate: dataset.datasetDate,
      generatedAt: new Date().toISOString(),
      estimates,
    });
  } catch (error) {
    toLocalDataFailure(error);
  } finally {
    closeQuietly(db);
  }
}

/** Agent-run flavor: estimates from a finished Deep Agents run's candidates artifact. */
export function estimateRentsForAgentRun(
  rawConfig: Partial<AgentServiceConfig>,
  sessionId: string,
  runId: string,
): RentEstimatesResponse {
  const run = getAgentRun(rawConfig, sessionId, runId);
  if (run.status !== "completed" && run.status !== "completed_with_gaps") {
    throw Object.assign(new Error("This search hasn't finished."), { code: "conflict" });
  }
  const search = searchArtifactSchema.parse(
    getAgentArtifact(rawConfig, sessionId, runId, "candidates"),
  );
  const datasetId = search.datasetId ?? run.datasetId ?? null;
  const datasetDate = search.datasetDate ?? run.datasetDate ?? null;
  if (datasetId === null) {
    throw new LocalDataError(
      "source_failure",
      "The run's dataset identity is missing, so rent estimates cannot be attributed to a dated snapshot.",
    );
  }
  const dataset = { datasetId, datasetDate };
  let db: DatabaseSync | null = null;
  try {
    db = openDatabase(rawConfig.db);
    const estimates = rentEstimatesForCandidates(
      db,
      search.candidates.map((item) => item.candidate),
      dataset,
    );
    return estimateRentsResponseSchema.parse({
      modelVersion: RENT_ESTIMATES_RESPONSE_VERSION,
      runId,
      datasetId,
      datasetDate,
      generatedAt: new Date().toISOString(),
      estimates,
    });
  } catch (error) {
    toLocalDataFailure(error);
  } finally {
    closeQuietly(db);
  }
}
