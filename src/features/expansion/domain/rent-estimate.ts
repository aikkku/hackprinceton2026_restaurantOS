import { z } from "zod";

/**
 * Deterministic estimated rents for offered spaces whose asking rent is not
 * listed (Rain-owned, pure TypeScript — all arithmetic happens here, never
 * in an AI call or the Python worker).
 *
 * An estimate is a DERIVED base-rent figure built only from listed
 * comparable asking rents in the same dated local snapshot. It never
 * changes the matching assessment: the cost status stays "Needs checking"
 * and an estimate never counts as within budget. Extra building charges
 * stay unknown — an estimate is base rent only.
 */

export const RENT_ESTIMATE_MODEL_VERSION = "expansion-rent-estimate-v1";
export const RENT_ESTIMATES_RESPONSE_VERSION = "expansion-rent-estimates-v1";

/** One row of the local `spaces` table, mapped for comparable selection. */
export type RentComparableRow = {
  id: string; // already "costar-space:N" in the cache
  cityId: string;
  latitude: number | null;
  longitude: number | null;
  rateLow: number | null;
  rateHigh: number | null;
  rateBasis: number | null; // 1 = per sq ft per month, 2 = per sq ft per year
  currencyCode: number | null; // must be 1 (USD)
  measurementCode: number | null; // must be 1 (sq ft)
  spaceUse: number | null; // 3 (OfficeRetail) or 5 (Retail)
  statusCode: number | null; // 1 = active in snapshot
};

/** The space being priced: its own target facts only. */
export type RentEstimateTarget = {
  id: string;
  cityId: string;
  latitude: number | null;
  longitude: number | null;
  floorAreaSqFt: number | null;
  sizeRangeSqFt: { minimum: number | null; maximum: number | null };
};

const finiteNonnegative = z.number().finite().nonnegative();

export const rentEstimateSchema = z.object({
  modelVersion: z.literal(RENT_ESTIMATE_MODEL_VERSION),
  method: z.enum(["nearest_neighbors", "city_fallback"]),
  comparableCount: z.number().int().nonnegative(),
  /** The radius actually used for selection; on city fallback this is the requested radius (explained in notes). */
  radiusKm: z.number().finite().nonnegative(),
  medianAnnualPerSqFt: finiteNonnegative,
  p25AnnualPerSqFt: finiteNonnegative,
  p75AnnualPerSqFt: finiteNonnegative,
  /** Monthly base-rent range; null when the size is unknown. */
  monthly: z.object({ low: finiteNonnegative, high: finiteNonnegative }).nullable(),
  sizeBasis: z.enum(["exact", "range", "unknown"]),
  /** Ids of the comparables actually used, in selection order. */
  sourceIds: z.array(z.string().min(1)),
  datasetId: z.string().min(1),
  datasetDate: z.string().nullable(),
  origin: z.literal("derived"),
  generatedAt: z.iso.datetime(),
  notes: z.array(z.string()),
});
export type RentEstimate = z.infer<typeof rentEstimateSchema>;

export const estimateRentsResponseSchema = z.object({
  modelVersion: z.literal(RENT_ESTIMATES_RESPONSE_VERSION),
  runId: z.string().min(1),
  datasetId: z.string().min(1),
  datasetDate: z.string().nullable(),
  generatedAt: z.iso.datetime(),
  estimates: z.array(
    z.object({
      candidateId: z.string().min(1),
      estimate: rentEstimateSchema.nullable(),
    }),
  ),
});
export type RentEstimatesResponse = z.infer<typeof estimateRentsResponseSchema>;

export const ESTIMATE_DEFAULTS = { neighborLimit: 8, radiusKm: 5, minNearby: 5 } as const;

const EARTH_RADIUS_KM = 6371;

function haversineKm(latA: number, lngA: number, latB: number, lngB: number): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = toRad(latB - latA);
  const deltaLng = toRad(lngB - lngA);
  const s =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
}

/** PERCENTILE.INC-style linear interpolation over a sorted ascending list. */
function percentileInc(sorted: number[], p: number): number {
  const n = sorted.length;
  const index = (p / 100) * (n - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function estimateRent(
  target: RentEstimateTarget,
  comparables: RentComparableRow[],
  dataset: { datasetId: string; datasetDate: string | null },
  options: {
    neighborLimit?: number;
    radiusKm?: number;
    minNearby?: number;
    now?: () => string;
  } = {},
): RentEstimate | null {
  const neighborLimit = options.neighborLimit ?? ESTIMATE_DEFAULTS.neighborLimit;
  const radiusKm = options.radiusKm ?? ESTIMATE_DEFAULTS.radiusKm;
  const minNearby = options.minNearby ?? ESTIMATE_DEFAULTS.minNearby;
  const now = options.now ?? (() => new Date().toISOString());

  // Qualifying comparable: same city, active snapshot status, retail or
  // office-retail use, USD per sq ft, a supported rent period, and a
  // positive listed rate. Legacy caches may store 0s for unlisted spaces —
  // 0/negative is never a listed rate.
  const qualified = comparables
    .filter(
      (row) =>
        row.cityId === target.cityId &&
        row.statusCode === 1 &&
        (row.spaceUse === 3 || row.spaceUse === 5) &&
        row.currencyCode === 1 &&
        row.measurementCode === 1 &&
        (row.rateBasis === 1 || row.rateBasis === 2) &&
        ((row.rateLow !== null && row.rateLow > 0) || (row.rateHigh !== null && row.rateHigh > 0)) &&
        row.id !== target.id,
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (qualified.length === 0) return null;

  // Representative annual $/sq ft per comparable: convert the quoted period
  // to annual (per-month × 12, per-year × 1). When both low and high are
  // positive use their midpoint; when only one is positive use that one.
  const annualOf = (row: RentComparableRow): number => {
    const factor = row.rateBasis === 1 ? 12 : 1;
    const low = row.rateLow !== null && row.rateLow > 0 ? row.rateLow : null;
    const high = row.rateHigh !== null && row.rateHigh > 0 ? row.rateHigh : null;
    const value = low !== null && high !== null ? (low + high) / 2 : ((low ?? high) as number);
    return value * factor;
  };

  const notes = [
    "Estimated from listed comparable retail/office-retail asking rents; it is a derived base-rent estimate, not a quoted price.",
    "Base rent only; extra building charges are not included and stay unknown.",
  ];

  let selected: RentComparableRow[];
  let method: "nearest_neighbors" | "city_fallback";
  const hasCoordinates = target.latitude !== null && target.longitude !== null;
  if (hasCoordinates) {
    const lat = target.latitude as number;
    const lng = target.longitude as number;
    const nearby = qualified
      .filter((row) => row.latitude !== null && row.longitude !== null)
      .map((row) => ({
        row,
        km: haversineKm(lat, lng, row.latitude as number, row.longitude as number),
      }))
      .filter((entry) => entry.km <= radiusKm)
      .sort((a, b) => a.km - b.km || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0));
    if (nearby.length >= minNearby) {
      selected = nearby.slice(0, neighborLimit).map((entry) => entry.row);
      method = "nearest_neighbors";
    } else {
      selected = qualified;
      method = "city_fallback";
      notes.push(
        `Only ${nearby.length} of ${qualified.length} qualifying comparable listings lie within the requested ${radiusKm} km radius (fewer than the ${minNearby} minimum); all ${qualified.length} city comparables were used instead (city fallback).`,
      );
    }
  } else {
    selected = qualified;
    method = "city_fallback";
    notes.push(
      `The target space has no coordinates, so distance selection is impossible; all ${qualified.length} qualifying city comparables were used (city fallback).`,
    );
  }

  const rates = selected.map(annualOf).sort((a, b) => a - b);
  const p25 = percentileInc(rates, 25);
  const median = percentileInc(rates, 50);
  const p75 = percentileInc(rates, 75);

  let monthly: { low: number; high: number } | null = null;
  let sizeBasis: "exact" | "range" | "unknown" = "unknown";
  if (target.floorAreaSqFt !== null && target.floorAreaSqFt > 0) {
    monthly = { low: (p25 / 12) * target.floorAreaSqFt, high: (p75 / 12) * target.floorAreaSqFt };
    sizeBasis = "exact";
  } else if (target.sizeRangeSqFt.minimum !== null && target.sizeRangeSqFt.maximum !== null) {
    monthly = {
      low: (p25 / 12) * target.sizeRangeSqFt.minimum,
      high: (p75 / 12) * target.sizeRangeSqFt.maximum,
    };
    sizeBasis = "range";
  } else {
    notes.push("No supported size, so no monthly range is priced; the annual per-sq-ft figure is shown instead.");
  }

  return rentEstimateSchema.parse({
    modelVersion: RENT_ESTIMATE_MODEL_VERSION,
    method,
    comparableCount: selected.length,
    radiusKm,
    medianAnnualPerSqFt: median,
    p25AnnualPerSqFt: p25,
    p75AnnualPerSqFt: p75,
    monthly,
    sizeBasis,
    sourceIds: selected.map((row) => row.id),
    datasetId: dataset.datasetId,
    datasetDate: dataset.datasetDate,
    origin: "derived",
    generatedAt: now(),
    notes,
  });
}
