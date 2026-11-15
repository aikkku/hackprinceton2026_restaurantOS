import type { DatabaseSync } from "node:sqlite";
import { candidateSchema, type SpaceCandidate } from "../domain/matching.ts";
import type { ExcludedCandidate } from "../domain/runs.ts";
import { normalizedRecordSchema, type NormalizedRecord } from "../domain/local-data.ts";
import { LocalDataError } from "./local-dataset.ts";

/**
 * Full-city offered-space candidate search (Rain-owned backend).
 *
 * Searches EVERY offered space in the supplied snapshot for a city — never a
 * first map page. Offered spaces are marketing listings' spaces with a
 * verified own-property join (enforced at import). Buildings are context,
 * not offered suites. Active marketing in the snapshot does not verify
 * current vacancy.
 */

export const SEARCH_MODEL_VERSION = "expansion-search-v1";
export const ACTIVE_STATUS = 1;
export const COMPATIBLE_SPACE_USES = new Set([5, 3]); // Retail, OfficeRetail
export const INCOMPATIBLE_SPACE_USES = new Set([1, 2, 4, 7]); // Office, OfficeMedical, Medical, Industrial
export const BATCH_SIZE = 500;
export const MAX_SCAN_SPACES = 20000;

export type CandidateSearchCounts = {
  examined: number;
  included: number;
  excluded: number;
  offMarket: number;
  unknownMarketingStatus: number;
  incompatibleUse: number;
  useUnknown: number;
  scanCapped: boolean;
};

export type CandidateSearchResult = {
  modelVersion: typeof SEARCH_MODEL_VERSION;
  cityId: string;
  datasetId: string;
  datasetDate: string | null;
  searchedAt: string;
  candidates: SpaceCandidate[];
  excluded: ExcludedCandidate[];
  counts: CandidateSearchCounts;
  cancelled: boolean;
};

function suiteFromName(name: string): string | null {
  const match = / · Suite (.+)$/.exec(name);
  return match ? match[1] : null;
}

function toCandidate(row: Record<string, unknown>, stored: NormalizedRecord): SpaceCandidate {
  // Caches imported before the $0-rent fix may still store 0 rates; a rate
  // of 0 or less is never a quoted price, so it becomes "not listed" here
  // without requiring a re-import.
  const positiveRate = (value: number | null) => value !== null && value > 0 ? value : null;
  const low = positiveRate(stored.sourceRent?.low ?? null);
  const high = positiveRate(stored.sourceRent?.high ?? null);
  return candidateSchema.parse({
    id: stored.id,
    name: stored.name,
    address: stored.address,
    suite: suiteFromName(stored.name),
    cityId: stored.cityId,
    latitude: stored.latitude,
    longitude: stored.longitude,
    h3Index: stored.h3Index,
    floorAreaSqFt: stored.floorAreaSqFt,
    sizeRangeSqFt: stored.sizeRangeSqFt ?? { minimum: null, maximum: null },
    rent: stored.sourceRent
      ? {
          low,
          high,
          rateBasisCode: stored.sourceRent.rateBasisCode,
          currencyCode: stored.sourceRent.currencyCode,
          measurementCode: stored.sourceRent.measurementCode,
          serviceTypeCode: stored.sourceRent.serviceTypeCode,
        }
      : null,
    spaceUseCode: stored.spaceUseCode ?? null,
    listingStatusCode: stored.sourceRent?.listingStatusCode ?? null,
    propertyId: stored.sourcePropertyId,
    sourceIds: stored.sourceIds,
    recordDate: stored.recordDate,
    datasetDate: stored.datasetDate,
    isDemo: false,
  });
}

export function metadataFor(db: DatabaseSync): { datasetId: string; datasetDate: string | null } {
  const row = db.prepare("SELECT value FROM meta WHERE key='metadata'").get();
  if (!row) throw new LocalDataError("source_failure", "The local dataset metadata is missing. Rebuild the Expansion cache.");
  const meta = JSON.parse(String(row.value)) as { datasetId: string; datasetDate: string | null };
  return { datasetId: meta.datasetId, datasetDate: meta.datasetDate ?? null };
}

/**
 * Scan all offered spaces in a city, separating active-snapshot candidates
 * from off-market records and explicit incompatible uses. Batching yields to
 * the event loop so cancellation can interleave; a scan cap is reported, not
 * hidden.
 */
export async function searchOfferedSpaces(
  db: DatabaseSync,
  cityId: string,
  options: {
    yieldLoop?: () => Promise<void>;
    shouldCancel?: () => boolean;
    /** Test hook: override the scan cap. */
    maxScan?: number;
  } = {},
): Promise<CandidateSearchResult> {
  const yieldLoop = options.yieldLoop ?? (() => Promise.resolve());
  const shouldCancel = options.shouldCancel ?? (() => false);
  const scanLimit = Math.min(options.maxScan ?? MAX_SCAN_SPACES, MAX_SCAN_SPACES);
  const meta = metadataFor(db);
  const city = db.prepare("SELECT 1 FROM records WHERE city_id=? LIMIT 1").get(cityId);
  if (!city) throw new LocalDataError("invalid_query", "Unsupported city.");
  const total = Number(db.prepare("SELECT COUNT(*) n FROM spaces WHERE city_id=?").get(cityId)!.n);
  const candidates: SpaceCandidate[] = [];
  const excluded: ExcludedCandidate[] = [];
  const counts: CandidateSearchCounts = {
    examined: 0,
    included: 0,
    excluded: 0,
    offMarket: 0,
    unknownMarketingStatus: 0,
    incompatibleUse: 0,
    useUnknown: 0,
    scanCapped: false,
  };
  const cap = Math.min(total, scanLimit);
  const statement = db.prepare(
    "SELECT id, status_code, space_use, payload FROM spaces WHERE city_id=? ORDER BY id LIMIT ? OFFSET ?",
  );
  for (let offset = 0; offset < cap; offset += BATCH_SIZE) {
    await yieldLoop();
    if (shouldCancel()) break;
    const rows = statement.all(cityId, Math.min(BATCH_SIZE, cap - offset), offset) as Array<Record<string, unknown>>;
    for (const row of rows) {
      counts.examined += 1;
      const stored = normalizedRecordSchema.parse(JSON.parse(String(row.payload)));
      const statusCode = row.status_code === null ? null : Number(row.status_code);
      const useCode = row.space_use === null ? null : Number(row.space_use);
      if (statusCode !== ACTIVE_STATUS) {
        const reasonCode = statusCode === null || statusCode === 0 ? "unknown_marketing_status" : "off_market";
        if (reasonCode === "off_market") counts.offMarket += 1;
        else counts.unknownMarketingStatus += 1;
        counts.excluded += 1;
        excluded.push({
          id: stored.id,
          name: stored.name,
          reasonCode,
          reason:
            reasonCode === "off_market"
              ? `Marketing status ${statusCode} (${statusCode === 3 ? "OffMarket" : "not Active"}) in the snapshot; active marketing does not verify current vacancy.`
              : "The marketing status is unknown in the snapshot; not treated as actively marketed.",
        });
        continue;
      }
      if (useCode !== null && INCOMPATIBLE_SPACE_USES.has(useCode)) {
        counts.incompatibleUse += 1;
        counts.excluded += 1;
        excluded.push({
          id: stored.id,
          name: stored.name,
          reasonCode: "incompatible_space_use",
          reason: `Market space use code ${useCode} is explicitly incompatible with a restaurant offering; unknown-use spaces stay separate instead.`,
        });
        continue;
      }
      const candidate = toCandidate(row, stored);
      if (candidate.spaceUseCode === 0 || candidate.spaceUseCode === null) counts.useUnknown += 1;
      candidates.push(candidate);
      counts.included += 1;
    }
  }
  const cancelled = shouldCancel();
  return {
    modelVersion: SEARCH_MODEL_VERSION,
    cityId,
    datasetId: meta.datasetId,
    datasetDate: meta.datasetDate,
    searchedAt: new Date().toISOString(),
    candidates,
    excluded,
    counts: { ...counts, scanCapped: !cancelled && counts.examined < total },
    cancelled,
  };
}
