import { getResolution, isValidCell, latLngToCell } from "h3-js";
import { z } from "zod";

const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const id = z.string().min(1);
export const originSchema = z.enum([
  "observed",
  "derived",
  "assumed",
  "simulated",
  "unavailable",
]);
export const factorKeys = [
  "demand",
  "similarity",
  "competition",
  "cost",
] as const;
export type FactorKey = (typeof factorKeys)[number];
const nullableScore = finite.min(0).max(100).nullable();
export const factorsSchema = z.object({
  demand: nullableScore,
  similarity: nullableScore,
  competition: nullableScore,
  cost: nullableScore,
});
export const weightsSchema = z.object({
  demand: nonnegative.max(100),
  similarity: nonnegative.max(100),
  competition: nonnegative.max(100),
  cost: nonnegative.max(100),
});
export type Weights = z.infer<typeof weightsSchema>;
const h3Schema = id.refine(
  (value) => isValidCell(value) && getResolution(value) === 8,
  "Expected a resolution-8 H3 cell",
);

export const evidenceSchema = z.object({
  id,
  provider: id,
  recordId: id,
  label: id,
  origin: originSchema,
  isDemo: z.boolean(),
  observedAt: z.iso.datetime().nullable(),
  rights: id,
  notes: id,
});
export const datasetMetadataSchema = z.object({
  mode: z.literal("local"),
  datasetId: id,
  provider: id,
  datasetDate: z.string().nullable(),
  importedAt: z.iso.datetime(),
  rights: id,
  notes: z.array(z.string()),
  propertyCount: nonnegative.int(),
  listingCount: nonnegative.int(),
  mappableCount: nonnegative.int(),
});
export const citySchema = z.object({
  id,
  name: id,
  center: z.tuple([finite.min(-180).max(180), finite.min(-90).max(90)]),
  bounds: z
    .tuple([
      finite.min(-180).max(180),
      finite.min(-90).max(90),
      finite.min(-180).max(180),
      finite.min(-90).max(90),
    ])
    .refine(
      ([west, south, east, north]) => west < east && south < north,
      "Invalid bounds",
    ),
  isDemo: z.boolean(),
  coverage: z.object({
    propertyCount: nonnegative.int(),
    listingCount: nonnegative.int(),
    mappableCount: nonnegative.int(),
  }).optional(),
});
export const areaSchema = z.object({
  h3Index: h3Schema,
  h3Resolution: z.literal(8),
  cityId: id,
  label: id,
  factors: factorsSchema,
  sourceIds: z.array(id).min(1),
  isDemo: z.boolean(),
  averageBaseRentMonthly: nonnegative.nullable(),
  metrics: z.object({
    propertyCount: nonnegative.int(),
    listingCount: nonnegative.int(),
    rentSampleCount: nonnegative.int(),
    averageAskingRentPerSfYear: nonnegative.nullable(),
  }).optional(),
});
export const rentSchema = z.object({
  amount: nonnegative,
  unit: z.enum(["USD_PER_SF_YEAR", "USD_PER_MONTH"]),
});
export const sourceRentSchema = z.object({
  low: nonnegative.nullable(),
  high: nonnegative.nullable(),
  rateBasisCode: nonnegative.int().nullable(),
  measurementCode: nonnegative.int().nullable(),
  currencyCode: nonnegative.int().nullable(),
  serviceTypeCode: nonnegative.int().nullable(),
  availabilityTypeCode: nonnegative.int().nullable(),
  availableOnDate: z.string().nullable(),
  listingStatusCode: nonnegative.int().nullable(),
  certifiedFreshDate: z.string().nullable(),
  dateOnMarket: z.string().nullable(),
});
export const propertySchema = z
  .object({
    id,
    cityId: id,
    h3Index: h3Schema,
    name: id,
    latitude: finite.min(-90).max(90),
    longitude: finite.min(-180).max(180),
    floorAreaSqFt: finite.positive().nullable(),
    askingRent: rentSchema.nullable(),
    availability: z.enum(["available", "unavailable", "unknown"]),
    previousUse: z.string().nullable(),
    parkingSpaces: nonnegative.int().nullable(),
    sourceIds: z.array(id).min(1),
    isDemo: z.boolean(),
    recordKind: z.enum(["property", "listing"]).optional(),
    sourcePropertyId: id.optional(),
    sourceListingId: id.nullable().optional(),
    sourceSpaceId: id.nullable().optional(),
    sourceRent: sourceRentSchema.optional(),
    address: z.string().nullable().optional(),
    propertyType: z.string().nullable().optional(),
    recordDate: z.string().nullable().optional(),
    datasetDate: z.string().nullable().optional(),
    rentBasis: z.string().nullable().optional(),
    originalRentUnit: z.string().nullable().optional(),
  })
  .refine(
    (p) => latLngToCell(p.latitude, p.longitude, 8) === p.h3Index,
    "Property coordinates do not match its H3 cell",
  );

export const datasetSchema = z
  .object({
    cities: z.array(citySchema).min(1),
    areas: z.array(areaSchema).max(200),
    properties: z.array(propertySchema),
    evidence: z.array(evidenceSchema),
    metadata: datasetMetadataSchema.optional(),
  })
  .superRefine((data, ctx) => {
    for (const [name, values] of Object.entries({
      cities: data.cities.map((x) => x.id),
      areas: data.areas.map((x) => x.h3Index),
      properties: data.properties.map((x) => x.id),
      evidence: data.evidence.map((x) => x.id),
    })) {
      if (new Set(values).size !== values.length)
        ctx.addIssue({
          code: "custom",
          message: `Duplicate ${name} identifiers`,
        });
    }
    const sources = new Set(data.evidence.map((x) => x.id));
    for (const entity of [...data.areas, ...data.properties]) {
      const city = data.cities.find((x) => x.id === entity.cityId);
      if (!city) ctx.addIssue({ code: "custom", message: "Unknown city" });
      if (entity.sourceIds.some((s) => !sources.has(s)))
        ctx.addIssue({ code: "custom", message: "Unknown evidence reference" });
      if (
        entity.sourceIds.some(
          (s) =>
            data.evidence.find((e) => e.id === s)?.isDemo !== entity.isDemo,
        ) ||
        city?.isDemo !== entity.isDemo
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Inconsistent demo provenance",
        });
      }
    }
    for (const p of data.properties) {
      if (
        !data.areas.some(
          (a) => a.h3Index === p.h3Index && a.cityId === p.cityId,
        )
      )
        ctx.addIssue({ code: "custom", message: "Unknown property area" });
      const city = data.cities.find((c) => c.id === p.cityId);
      if (
        city &&
        (p.longitude < city.bounds[0] ||
          p.longitude > city.bounds[2] ||
          p.latitude < city.bounds[1] ||
          p.latitude > city.bounds[3])
      )
        ctx.addIssue({
          code: "custom",
          message: "Property outside city bounds",
        });
    }
  });

export const scenarioInputsSchema = z.object({
  baseRentMonthly: nonnegative,
  passThroughMonthly: nonnegative,
  otherFixedMonthly: nonnegative,
  contributionMargin: finite.min(0).max(1),
  initialInvestment: nonnegative,
  workingCapital: nonnegative,
  assumedSalesMonthly: nonnegative.nullable(),
});
export const scenarioResultsSchema = z.object({
  occupancyMonthly: nonnegative,
  fixedMonthly: nonnegative,
  requiredSalesMonthly: nonnegative.nullable(),
  contributionAfterFixedMonthly: finite.nullable(),
  paybackMonths: nonnegative.nullable(),
  initialCashRequired: nonnegative,
});
const legacyScenarioSchema = z.object({
  schemaVersion: z.literal(1),
  modelVersion: z.literal("expansion-finance-v1"),
  scoreModelVersion: z.literal("expansion-area-demo-v1"),
  id,
  restaurantId: z.literal("demo-restaurant"),
  propertyId: id,
  propertyName: id,
  cityId: id,
  label: z.string().min(1).max(100),
  createdAt: z.iso.datetime(),
  isDemo: z.literal(true),
  inputs: scenarioInputsSchema,
  results: scenarioResultsSchema,
  weights: weightsSchema,
  sourceIds: z.array(id).min(1),
  assumptionNotes: z.array(z.string()),
  monthlyBudget: finite.positive(),
});
export const scenarioSchema = z.union([
  legacyScenarioSchema,
  legacyScenarioSchema.extend({
    schemaVersion: z.literal(2),
    restaurantId: id,
    isDemo: z.boolean(),
    scoreModelVersion: z.enum(["expansion-area-demo-v1", "expansion-area-local-v1"]),
    dataMode: z.enum(["demo", "local"]),
    datasetId: id,
    datasetDate: z.string().nullable(),
    propertySnapshot: propertySchema,
    evidenceSnapshot: z.array(evidenceSchema).min(1),
  }).superRefine((snapshot, ctx) => {
    const p = snapshot.propertySnapshot;
    if (snapshot.isDemo !== (snapshot.dataMode === "demo") ||
      p.isDemo !== snapshot.isDemo || p.id !== snapshot.propertyId ||
      p.cityId !== snapshot.cityId ||
      snapshot.scoreModelVersion !== (snapshot.isDemo ? "expansion-area-demo-v1" : "expansion-area-local-v1") ||
      snapshot.evidenceSnapshot.some(e => e.isDemo !== snapshot.isDemo) ||
      [...snapshot.sourceIds, ...p.sourceIds].some(source => !snapshot.evidenceSnapshot.some(e => e.id === source))) {
      ctx.addIssue({code: "custom", message: "Inconsistent snapshot provenance"});
    }
  }),
]);
export const savedScenariosSchema = z.array(scenarioSchema).max(50);

export type Dataset = z.infer<typeof datasetSchema>;
export type DatasetMetadata = z.infer<typeof datasetMetadataSchema>;
export type City = z.infer<typeof citySchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type ExpansionArea = z.infer<typeof areaSchema>;
export type ExpansionProperty = z.infer<typeof propertySchema>;
export type ScenarioInputs = z.infer<typeof scenarioInputsSchema>;
export type ScenarioResults = z.infer<typeof scenarioResultsSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
