import { z } from "zod";
import { sourceObservationSchema, type SourceObservation } from "./evidence.ts";
import type { SpaceCandidate } from "./matching.ts";

export const ACS_RELEASE = "2023-acs5";
export const ACS_VARIABLES = ["B01003_001E", "B01003_001M", "B19013_001E", "B19013_001M"] as const;
export const ACS_ALLOCATION = "tract-context-only-v1";
export const HEIGHTS_DEFINITION = {
  version: "houston-sn15-lookup-v1", name: "Greater Heights (Super Neighborhood 15)",
  referenceUrl: "https://www.houstontx.gov/superneighborhoods/15.html",
  limitation: "Greater Heights is a documented possible interpretation of the owner's Heights preference. Membership requires a sourced boundary lookup; address text alone is not membership. Owner confirmation of this definition remains needed.",
};
const text = z.string().min(1);
const number = z.number().finite().nonnegative();
const sourceDate = z.iso.date().nullable();
export const matterportLinkSchema = z.object({
  modelId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), propertyId: text,
  candidateId: text.nullable(), verifiedAt: sourceDate, reference: text,
  viewerPermitted: z.boolean(),
});
export const matterportMetadataSchema = z.object({
  id: text, name: z.string().nullable(), capturedAt: sourceDate,
  measurements: z.object({ usableDiningSqFt: number.positive(), sourceRecordId: text }).nullable(),
});
export function mapMatterport(candidate: SpaceCandidate, rawLink: unknown, rawModel: unknown, now: string, densitySqFtPerSeat: number | null = null): SourceObservation {
  const link = matterportLinkSchema.parse(rawLink);
  const model = matterportMetadataSchema.parse(rawModel);
  if (candidate.propertyId !== link.propertyId || model.id !== link.modelId || (link.candidateId !== null && candidate.id !== link.candidateId)) throw new Error("Property/model/offered-suite association mismatch.");
  const suiteAssociated = link.candidateId === candidate.id && link.verifiedAt !== null;
  const details = [`Model ${model.id}: ${model.name ?? "Unnamed"}`, suiteAssociated ? `Offered-suite association verified ${link.verifiedAt}: ${link.reference}` : "Property-level association only; the offered suite has not been identified."];
  const limitations = ["Metadata alone does not verify a suite kitchen, usable dining area or legal occupancy."];
  if (model.capturedAt === null) limitations.push("Capture date unavailable; retrieval time is separate.");
  if (model.measurements && suiteAssociated) {
    details.push(`Measured usable dining area: ${model.measurements.usableDiningSqFt} SF (${model.measurements.sourceRecordId}).`);
    if (densitySqFtPerSeat !== null) {
      z.number().finite().positive().parse(densitySqFtPerSeat);
      details.push(`Planning estimate: ${Math.floor(model.measurements.usableDiningSqFt / densitySqFtPerSeat)} seats at an assumed ${densitySqFtPerSeat} SF/seat; not legal occupancy.`);
    }
  } else limitations.push("Supported suite-scoped dining measurements unavailable; no seat estimate calculated.");
  return sourceObservationSchema.parse({
    id: `matterport:${candidate.id}:${model.id}`, provider: "matterport", candidateId: candidate.id,
    scope: suiteAssociated ? "suite" : "property", sourceRecordId: model.id, sourceDate: model.capturedAt,
    retrievedAt: now, origin: "observed", isSynthetic: false, label: "Matterport metadata", details, limitations,
    referenceUrl: "https://developers.matterport.com/api/model/overview/",
    viewerUrl: link.viewerPermitted ? `https://my.matterport.com/show/?m=${model.id}` : null, facts: [], exportAllowed: false,
  });
}

export const aerialObservationInputSchema = z.object({
  recordId: text, latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  capturedAt: sourceDate, occluded: z.boolean().nullable(),
  reviewedVisibleStalls: number.int().nullable(), reviewReference: text.nullable(),
});
export function mapVexcel(candidate: SpaceCandidate, raw: unknown, now: string): SourceObservation {
  const image = aerialObservationInputSchema.parse(raw);
  if (candidate.latitude !== image.latitude || candidate.longitude !== image.longitude) throw new Error("Imagery does not identify this site's coordinates.");
  const reviewed = image.occluded === false && image.reviewReference !== null;
  return sourceObservationSchema.parse({
    id: `vexcel:${candidate.id}:${image.recordId}`, provider: "vexcel", candidateId: candidate.id,
    scope: "site", sourceRecordId: image.recordId, sourceDate: image.capturedAt, retrievedAt: now,
    origin: "observed", isSynthetic: false, label: "Vexcel site context",
    details: [`Site center: ${image.latitude}, ${image.longitude}`, reviewed && image.reviewedVisibleStalls !== null ? `Reviewed visible stalls: ${image.reviewedVisibleStalls}; review ${image.reviewReference}` : "Visible stalls, patio and frontage have not been reliably reviewed."],
    limitations: ["Visible parking never establishes customer access, allocation or lease rights.", image.capturedAt === null ? "Image capture date unavailable; image freshness unknown." : `Dated image captured ${image.capturedAt}.`, image.occluded !== false ? "Occlusion unassessed or present; no count inferred." : "Visibility reviewed."],
    referenceUrl: null, viewerUrl: null, facts: [], exportAllowed: false,
  });
}

export const acsContextSchema = z.object({
  release: z.literal(ACS_RELEASE), state: z.string().regex(/^\d{2}$/), county: z.string().regex(/^\d{3}$/), tract: z.string().regex(/^\d{6}$/),
  name: text, population: number.nullable(), populationMoe: number.nullable(), income: number.nullable(), incomeMoe: number.nullable(),
  allocationMethod: z.literal(ACS_ALLOCATION),
});
export type AcsContext = z.infer<typeof acsContextSchema>;
/** Census negative sentinel values remain null, including MOE. */
export function parseAcsResponse(raw: unknown, geography: { state: string; county: string; tract: string }): AcsContext {
  const table = z.array(z.array(z.string())).length(2).parse(raw);
  const row = Object.fromEntries(table[0].map((key, i) => [key, table[1][i]]));
  if (row.state !== geography.state || row.county !== geography.county || row.tract !== geography.tract) throw new Error("ACS geography mismatch.");
  const value = (key: string) => {
    if (!(key in row)) throw new Error("Missing pinned ACS variable.");
    const numeric = row[key].trim() === "" || row[key] === "null" ? null : Number(row[key]);
    if (numeric !== null && !Number.isFinite(numeric)) throw new Error("Malformed ACS number.");
    return numeric !== null && numeric >= 0 ? numeric : null;
  };
  return acsContextSchema.parse({ ...geography, release: ACS_RELEASE, name: row.NAME, population: value(ACS_VARIABLES[0]), populationMoe: value(ACS_VARIABLES[1]), income: value(ACS_VARIABLES[2]), incomeMoe: value(ACS_VARIABLES[3]), allocationMethod: ACS_ALLOCATION });
}
export function acsObservation(candidate: SpaceCandidate, context: AcsContext, now: string): SourceObservation {
  return sourceObservationSchema.parse({
    id: `acs:${candidate.id}:${context.state}${context.county}${context.tract}:${context.release}`, provider: "acs", candidateId: candidate.id,
    scope: "tract", sourceRecordId: `${context.state}${context.county}${context.tract}`, sourceDate: null, retrievedAt: now,
    origin: "observed", isSynthetic: false, label: `Census ACS ${context.release} · ${context.name}`,
    details: [`Population: ${context.population ?? "unavailable"} persons; MOE ±${context.populationMoe ?? "unavailable"} persons (90% confidence).`, `Median household income: ${context.income ?? "unavailable"} USD (2023 inflation-adjusted); MOE ±${context.incomeMoe ?? "unavailable"} USD (90% confidence).`, `Variables: ${ACS_VARIABLES.join(", ")}`],
    limitations: [`${ACS_ALLOCATION}: the containing tract is context for the site/H3 cell; values are NOT allocated or summed across H3 cells. Median income is not area-weighted.`, "2019–2023 five-year estimates; not current demand or restaurant revenue. Composite score remains unscored."],
    referenceUrl: "https://api.census.gov/data/2023/acs/acs5.html", viewerUrl: null, facts: [], exportAllowed: true,
  });
}

/** No home similarity or price-fit is possible from a city/cuisine alone. */
export function contextGaps(currentAddress: string | null, priceLevel: number | null): string[] {
  return [!currentAddress?.trim() ? "Home similarity unavailable: current street address was not supplied." : "Home similarity unavailable until a comparable current trade-area geography is verified.", priceLevel === null ? "Price fit unavailable: no average spend/price level supplied." : "Price fit unavailable: no versioned fit model has been verified."];
}
