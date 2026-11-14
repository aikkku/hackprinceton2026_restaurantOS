import { z } from "zod";
import { areaSchema, citySchema, datasetMetadataSchema, datasetSchema, evidenceSchema, propertySchema, rentSchema, sourceRentSchema } from "./schemas.ts";
import { getResolution, isValidCell, latLngToCell } from "h3-js";

export { datasetMetadataSchema } from "./schemas.ts";
export type { DatasetMetadata } from "./schemas.ts";
const number = z.number().finite();
const count = number.nonnegative().int();
const text = z.string().min(1);

/** Server ingestion boundary. Missing geography is preserved, never geocoded. */
export const normalizedRecordSchema = z.object({
  id: text,
  sourcePropertyId: text,
  sourceListingId: text.nullable(),
  sourceSpaceId: text.nullable().optional(),
  sourceRent: sourceRentSchema.optional(),
  recordKind: z.enum(["property", "listing"]),
  cityId: text,
  name: text,
  address: z.string().nullable(),
  latitude: number.min(-90).max(90).nullable(),
  longitude: number.min(-180).max(180).nullable(),
  h3Index: text.nullable(),
  floorAreaSqFt: number.positive().nullable(),
  askingRent: rentSchema.nullable(),
  originalRentUnit: z.string().nullable(),
  rentBasis: z.string().nullable(),
  availability: z.enum(["available", "unavailable", "unknown"]),
  previousUse: z.string().nullable(),
  parkingSpaces: count.nullable(),
  propertyType: z.string().nullable(),
  recordDate: z.string().nullable(),
  datasetDate: z.string().nullable(),
  sourceIds: z.array(text).min(1),
  isDemo: z.literal(false),
}).superRefine((record, ctx) => {
  const located = record.latitude !== null && record.longitude !== null;
  if ((record.latitude === null) !== (record.longitude === null) ||
    (located ? record.h3Index === null || !isValidCell(record.h3Index) || getResolution(record.h3Index) !== 8 ||
      latLngToCell(record.latitude!, record.longitude!, 8) !== record.h3Index : record.h3Index !== null)) {
    ctx.addIssue({code: "custom", message: "Invalid coordinate/H3 relationship"});
  }
  if ((record.recordKind === "property") !== (record.sourceListingId === null)) {
    ctx.addIssue({code: "custom", message: "Invalid property/listing relationship"});
  }
});
export type NormalizedRecord = z.infer<typeof normalizedRecordSchema>;

export const MAX_QUERY_LIMIT = 200;
export const MAX_QUERY_OFFSET = 10000;
export const localQuerySchema = z.object({
  cityId: text.max(100),
  west: number.min(-180).max(180),
  south: number.min(-90).max(90),
  east: number.min(-180).max(180),
  north: number.min(-90).max(90),
  limit: count.min(1).max(MAX_QUERY_LIMIT).default(100),
  offset: count.max(MAX_QUERY_OFFSET).default(0),
  monthlyBudget: number.positive().max(1e12).optional(),
  minimumArea: number.nonnegative().max(1e9).optional(),
  includeUnknown: z.boolean().default(true),
  availability: z.enum(["available", "unavailable", "unknown"]).optional(),
  propertyType: z.string().min(1).max(100).optional(),
}).refine(q => q.west < q.east && q.south < q.north &&
  q.east - q.west <= 5 && q.north - q.south <= 5, "Viewport must have ordered bounds spanning at most five degrees");
export type LocalQuery = z.infer<typeof localQuerySchema>;

export const queryCoverageSchema = z.object({
  totalMatching: count,
  returned: count.max(MAX_QUERY_LIMIT),
  limit: count.min(1).max(MAX_QUERY_LIMIT),
  offset: count.max(MAX_QUERY_OFFSET),
  areasReturned: count.max(200),
  areasLimited: z.boolean(),
});
export type QueryCoverage = z.infer<typeof queryCoverageSchema>;
export const marketsResponseSchema = z.object({
  cities: z.array(citySchema),
  evidence: z.array(evidenceSchema),
  metadata: datasetMetadataSchema,
});
export const queryResponseSchema = z.object({dataset: datasetSchema, coverage: queryCoverageSchema});
export const propertyDetailResponseSchema = z.object({
  property: propertySchema,
  area: areaSchema,
  evidence: z.array(evidenceSchema),
  metadata: datasetMetadataSchema,
});
export type MarketsResponse = z.infer<typeof marketsResponseSchema>;
export type QueryResponse = z.infer<typeof queryResponseSchema>;
export type PropertyDetailResponse = z.infer<typeof propertyDetailResponseSchema>;

/** Strict query parsing: empty, duplicate and unknown parameters are errors. */
export function parseLocalQuery(params: URLSearchParams): LocalQuery {
  const numbers = new Set(["west", "south", "east", "north", "limit", "offset", "monthlyBudget", "minimumArea"]);
  const known = new Set([...numbers, "cityId", "includeUnknown", "availability", "propertyType"]);
  const values: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (!known.has(key) || key in values || !value.trim()) throw new Error("Invalid query parameters");
    if (numbers.has(key)) values[key] = Number(value);
    else if (key === "includeUnknown") {
      if (value !== "true" && value !== "false") throw new Error("Invalid boolean parameter");
      values[key] = value === "true";
    } else values[key] = value;
  }
  return localQuerySchema.parse(values);
}
