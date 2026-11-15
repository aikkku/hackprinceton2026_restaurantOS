import { z } from "zod";
import { originSchema } from "./schemas.ts";
import {
  REQUIREMENT_IDS,
  searchRequirementsSchema,
  type SearchRequirements,
} from "./requirements.ts";

/**
 * Deterministic candidate matching (Rain-owned, pure TypeScript).
 *
 * Candidates are offered lease spaces from the dated local snapshot.
 * Assessments are pass / fail / unknown / not-applicable per profile
 * requirement, with stable reason codes and fact references. Grouping and
 * ordering are pure functions with an explanation — never an opaque score.
 *
 * Rules enforced here:
 * - $5,000 is the hard TOTAL monthly occupancy cap. Included charges are
 *   never added twice; a complete upper bound <= cap passes, a supported
 *   lower bound > cap fails, and missing components or a crossing range is
 *   unknown.
 * - Kitchen and customer parking require suite-scoped verified evidence for
 *   a pass; building-only notes and nearby visible parking cannot produce a
 *   verified pass.
 * - Seats and neighborhood preference are soft: mismatches are reported,
 *   never a hard rejection. Unknown reserve prevents any upfront
 *   affordability claim (handled at run readiness level, not per candidate).
 */

export const MATCHING_MODEL_VERSION = "expansion-matching-v1";

const id = z.string().min(1);
const text = z.string().min(1);
const nonnegative = z.number().finite().nonnegative();
const nullableNonnegative = nonnegative.nullable();
const intOrNull = (max: number) => nonnegative.int().max(max).nullable();

export const ASSESSMENT_STATUSES = [
  "pass",
  "fail",
  "unknown",
  "not_applicable",
] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

/** Stable reason codes shared by search, specialists and the UI. */
export const ASSESSMENT_REASON_CODES = [
  "below_cap",
  "exceeds_cap",
  "range_crosses_cap",
  "missing_charges",
  "ambiguous_basis",
  "unsupported_units",
  "kitchen_verified",
  "kitchen_absent",
  "kitchen_unverified",
  "kitchen_likely",
  "kitchen_unlikely",
  "parking_verified",
  "parking_absent",
  "parking_unverified",
  "parking_visible",
  "parking_unlikely",
  "capacity_aligned",
  "capacity_mismatch",
  "capacity_unknown",
  "neighborhood_member",
  "neighborhood_other",
  "neighborhood_unresolved",
  "not_applicable",
  "unknown_value",
] as const;
export type AssessmentReasonCode = (typeof ASSESSMENT_REASON_CODES)[number];

// ---------------------------------------------------------------------------
// Facts

const factBase = {
  id,
  entityScope: z.literal("space"),
  entityId: id,
  origin: originSchema,
  source: z.object({
    label: z.string().min(1),
    recordId: id.nullable(),
    capturedAt: z.iso.datetime().nullable(),
  }),
  method: z.string().min(1).nullable(),
  limitations: z.array(z.string()),
  isDemo: z.boolean(),
};

const unknownValue = z.object({ kind: z.literal("unknown") });
const exactText = z.object({ kind: z.literal("exact"), value: z.string().min(1) });
const exactNumber = z.object({ kind: z.literal("exact"), value: nonnegative });
const numberRange = z.object({
  kind: z.literal("range"),
  minimum: nullableNonnegative,
  maximum: nullableNonnegative,
});

export const factSchema = z.discriminatedUnion("field", [
  z.object({
    ...factBase,
    field: z.literal("existingKitchen"),
    value: z.union([
      exactText.refine((v) =>
        ["verified_present", "verified_absent", "building_note"].includes(
          v.value,
        ),
      ),
      unknownValue,
    ]),
    unit: z.literal(null),
  }),
  z.object({
    ...factBase,
    field: z.literal("customerParking"),
    value: z.union([
      exactText.refine((v) =>
        ["verified_customer_parking", "verified_absent"].includes(v.value),
      ),
      unknownValue,
    ]),
    unit: z.literal(null),
  }),
  z.object({
    ...factBase,
    field: z.literal("seatCapacity"),
    value: z.union([exactNumber, numberRange, unknownValue]),
    unit: z.literal("seats"),
  }),
  z.object({
    ...factBase,
    field: z.literal("neighborhood"),
    value: z.union([exactText, unknownValue]),
    unit: z.literal(null),
  }),
  z.object({
    ...factBase,
    field: z.literal("monthlyAdditionalCharges"),
    value: z.union([exactNumber, unknownValue]),
    unit: z.literal("USD/month"),
  }),
]);
export type CandidateFact = z.infer<typeof factSchema>;

// ---------------------------------------------------------------------------
// Candidates

export const candidateSchema = z.object({
  id,
  name: text,
  address: z.string().nullable(),
  suite: z.string().nullable(),
  cityId: text,
  latitude: z.number().finite().min(-90).max(90).nullable(),
  longitude: z.number().finite().min(-180).max(180).nullable(),
  h3Index: text.nullable(),
  floorAreaSqFt: z.number().finite().positive().nullable(),
  sizeRangeSqFt: z.object({
    minimum: nullableNonnegative,
    maximum: nullableNonnegative,
  }),
  rent: z
    .object({
      low: nullableNonnegative,
      high: nullableNonnegative,
      rateBasisCode: intOrNull(2),
      currencyCode: intOrNull(100),
      measurementCode: intOrNull(100),
      serviceTypeCode: intOrNull(100),
    })
    .nullable(),
  spaceUseCode: intOrNull(7),
  listingStatusCode: intOrNull(100),
  propertyId: id,
  sourceIds: z.array(id).min(1),
  recordDate: z.string().nullable(),
  datasetDate: z.string().nullable(),
  isDemo: z.boolean(),
});
export type SpaceCandidate = z.infer<typeof candidateSchema>;

// ---------------------------------------------------------------------------
// Assessments

export const assessmentSchema = z.object({
  requirementId: z.enum(REQUIREMENT_IDS),
  status: z.enum(ASSESSMENT_STATUSES),
  reasonCode: z.enum(ASSESSMENT_REASON_CODES),
  reason: z.string().min(1),
  evidenceIds: z.array(id),
  /** Human-readable source value/range behind the status. */
  sourceValue: z.string().min(1),
  estimate: z.object({ kind: z.enum(["ai_estimate", "area_estimate"]), probability: z.number().min(0).max(1).optional() }).optional(),
});
export type RequirementAssessment = z.infer<typeof assessmentSchema>;

export const candidateGroups = [
  "meets_assessed_requirements",
  "needs_verification",
  "does_not_meet",
] as const;
export type CandidateGroup = (typeof candidateGroups)[number];

export const assessedCandidateSchema = z.object({
  candidate: candidateSchema,
  assessments: z.array(assessmentSchema),
  group: z.enum(candidateGroups),
  rank: nonnegative.int(),
  orderingNotes: z.array(z.string()),
});
export type AssessedCandidate = z.infer<typeof assessedCandidateSchema>;

export const assessmentReportSchema = z.object({
  modelVersion: z.literal(MATCHING_MODEL_VERSION),
  requirements: searchRequirementsSchema,
  counts: z.object({
    examined: nonnegative.int(),
    meets: nonnegative.int(),
    needsVerification: nonnegative.int(),
    doesNotMeet: nonnegative.int(),
    useUnknown: nonnegative.int(),
  }),
  candidates: z.array(assessedCandidateSchema),
});
export type AssessmentReport = z.infer<typeof assessmentReportSchema>;

// ---------------------------------------------------------------------------
// Service inclusions and occupancy normalization

/** ServiceType codes whose quoted rent already includes additional charges. */
const INCLUDED_SERVICES = new Set([1, 2, 4, 5, 6, 7, 8, 9, 19, 21, 22, 23]);
/** ServiceType codes whose quoted rent excludes additional charges. */
const EXCLUDED_SERVICES = new Set([10, 12, 13, 16, 17, 18, 20]);

export type ServiceInclusion = "included" | "not_included" | "unknown";

export function serviceInclusion(serviceTypeCode: number | null): ServiceInclusion {
  if (serviceTypeCode === null) return "unknown";
  if (INCLUDED_SERVICES.has(serviceTypeCode)) return "included";
  if (EXCLUDED_SERVICES.has(serviceTypeCode)) return "not_included";
  return "unknown";
}

export type OccupancyRange = { low: number; high: number | null };

export type OccupancyResult =
  | { known: OccupancyRange; notes: string[] }
  | { unknown: true; reasonCode: AssessmentReasonCode; reason: string };

/**
 * Normalize a candidate's quoted rent into a monthly TOTAL occupancy range
 * without double counting included charges. Supported units are USD per SF
 * per month/year only; anything else stays unknown rather than coerced.
 */
export function monthlyOccupancyRange(
  candidate: SpaceCandidate,
  extrasMonthly: number | null,
  inclusion: ServiceInclusion,
): OccupancyResult {
  const rent = candidate.rent;
  if (!rent || (rent.low === null && rent.high === null)) {
    return {
      unknown: true,
      reasonCode: "ambiguous_basis",
      reason: "No supported asking rent was supplied for this space.",
    };
  }
  if (rent.currencyCode !== 1 || rent.measurementCode !== 1) {
    return {
      unknown: true,
      reasonCode: "unsupported_units",
      reason:
        "The quoted rent uses unsupported currency or measurement units and was kept unknown rather than converted.",
    };
  }
  if (rent.rateBasisCode !== 1 && rent.rateBasisCode !== 2) {
    return {
      unknown: true,
      reasonCode: "ambiguous_basis",
      reason: "The quoted rent period is unknown, so a monthly cost cannot be derived.",
    };
  }
  const perMonth =
    rent.rateBasisCode === 1 ? 1 : 1 / 12;
  const exactArea = candidate.floorAreaSqFt;
  const areaLow = exactArea ?? candidate.sizeRangeSqFt.minimum;
  const areaHigh = exactArea ?? candidate.sizeRangeSqFt.maximum;
  if (areaLow === null || areaHigh === null) {
    return {
      unknown: true,
      reasonCode: "unknown_value",
      reason: "The offered space has no supported size, so monthly rent cannot be derived.",
    };
  }
  const baseLow = rent.low === null ? null : rent.low * perMonth * areaLow;
  const baseHigh = rent.high === null ? null : rent.high * perMonth * areaHigh;
  const notes: string[] = [];
  let low = baseLow;
  let high = baseHigh;
  if (inclusion === "included") {
    notes.push(
      "Quoted rent service includes additional charges; extras are not added again.",
    );
  } else if (extrasMonthly !== null) {
    low = low === null ? null : low + extrasMonthly;
    high = high === null ? null : high + extrasMonthly;
    notes.push(`Known nonincluded additional charges $${extrasMonthly}/month were added.`);
  } else {
    // Unknown extras make the upper bound unknown, whatever the base is.
    high = null;
    notes.push(
      inclusion === "not_included"
        ? "Additional charges are not included in the quoted rent and are unknown."
        : "Whether the quoted rent includes additional charges is unknown.",
    );
  }
  if (low === null) {
    return {
      unknown: true,
      reasonCode: "ambiguous_basis",
      reason: "The monthly occupancy lower bound cannot be established.",
    };
  }
  return { known: { low, high }, notes };
}

// ---------------------------------------------------------------------------
// Per-requirement evaluation

const HARD_IDS: readonly Requirement["id"][] = [
  "occupancy.monthlyLimit",
  "space.existingKitchen",
  "space.customerParking",
];

type Requirement = z.infer<typeof searchRequirementsSchema>["requirements"][number];

const requirementOf = (
  requirements: SearchRequirements,
  requirementId: Requirement["id"],
) => requirements.requirements.find((item) => item.id === requirementId);

function occupancyAssessment(
  candidate: SpaceCandidate,
  requirements: SearchRequirements,
  facts: CandidateFact[],
): RequirementAssessment {
  const cap = requirementOf(requirements, "occupancy.monthlyLimit");
  const limit =
    cap?.value.kind === "number" ? cap.value.value : null;
  if (limit === null) {
    return {
      requirementId: "occupancy.monthlyLimit",
      status: "unknown",
      reasonCode: "unknown_value",
      reason: "The profile has no usable monthly occupancy limit.",
      evidenceIds: [],
      sourceValue: "No profile limit",
    };
  }
  const extrasFact = facts.find((f) => f.field === "monthlyAdditionalCharges");
  const extras =
    extrasFact?.value.kind === "exact" && typeof extrasFact.value.value === "number"
      ? extrasFact.value.value
      : null;
  const result = monthlyOccupancyRange(
    candidate,
    extras,
    serviceInclusion(candidate.rent?.serviceTypeCode ?? null),
  );
  const evidenceIds = extrasFact ? [extrasFact.id] : [];
  if ("unknown" in result) {
    return {
      requirementId: "occupancy.monthlyLimit",
      status: "unknown",
      reasonCode: result.reasonCode,
      reason: result.reason,
      evidenceIds,
      sourceValue: rentSourceValue(candidate),
    };
  }
  const { low, high } = result.known;
  if (low > limit) {
    return {
      requirementId: "occupancy.monthlyLimit",
      status: "fail",
      reasonCode: "exceeds_cap",
      reason: `A supported monthly occupancy lower bound of $${Math.round(low)} exceeds the $${Math.round(limit)} total cap.`,
      evidenceIds,
      sourceValue: `${rentSourceValue(candidate)} → lower bound $${Math.round(low)}/month`,
    };
  }
  if (high !== null && high <= limit) {
    return {
      requirementId: "occupancy.monthlyLimit",
      status: "pass",
      reasonCode: "below_cap",
      reason: `The complete monthly occupancy upper bound of $${Math.round(high)} is within the $${Math.round(limit)} total cap.`,
      evidenceIds,
      sourceValue: `${rentSourceValue(candidate)} → $${Math.round(low)}–$${Math.round(high)}/month`,
    };
  }
  if (high !== null && high > limit && low <= limit) {
    return {
      requirementId: "occupancy.monthlyLimit",
      status: "unknown",
      reasonCode: "range_crosses_cap",
      reason: `The supported occupancy range $${Math.round(low)}–$${Math.round(high)} crosses the $${Math.round(limit)} cap.`,
      evidenceIds,
      sourceValue: `${rentSourceValue(candidate)} → $${Math.round(low)}–$${Math.round(high)}/month`,
    };
  }
  return {
    requirementId: "occupancy.monthlyLimit",
    status: "unknown",
    reasonCode: "missing_charges",
    reason: `Base rent is within the cap but additional occupancy charges are unknown, so the $${Math.round(limit)} total cap is unverified.`,
    evidenceIds,
    sourceValue: `${rentSourceValue(candidate)} → $${Math.round(low)}+/month`,
  };
}

function rentSourceValue(candidate: SpaceCandidate): string {
  const rent = candidate.rent;
  if (!rent || (rent.low === null && rent.high === null)) return "No asking rent";
  const low = rent.low === null ? "?" : String(rent.low);
  const high = rent.high === null || rent.high === rent.low ? "" : `–${rent.high}`;
  const period = rent.rateBasisCode === 1 ? "month" : rent.rateBasisCode === 2 ? "year" : "unknown period";
  const service = rent.serviceTypeCode ?? "unknown";
  return `Quoted ${low}${high} USD/SF/${period} (service type ${service})`;
}

function kitchenAssessment(
  candidate: SpaceCandidate,
  facts: CandidateFact[],
): RequirementAssessment {
  const fact = facts.find((f) => f.field === "existingKitchen");
  if (fact?.value.kind === "exact" && fact.value.value === "verified_present") {
    return {
      requirementId: "space.existingKitchen",
      status: "pass",
      reasonCode: "kitchen_verified",
      reason: "Suite-scoped verified evidence supports an existing kitchen.",
      evidenceIds: [fact.id],
      sourceValue: fact.source.label,
    };
  }
  if (fact?.value.kind === "exact" && fact.value.value === "verified_absent") {
    return {
      requirementId: "space.existingKitchen",
      status: "fail",
      reasonCode: "kitchen_absent",
      reason: "Suite-scoped verified evidence establishes that no existing kitchen is present.",
      evidenceIds: [fact.id],
      sourceValue: fact.source.label,
    };
  }
  const buildingNote = fact?.value.kind === "exact" && fact.value.value === "building_note";
  return {
    requirementId: "space.existingKitchen",
    status: "unknown",
    reasonCode: "kitchen_unverified",
    reason: buildingNote
      ? "Only a building-level note exists; it does not verify a kitchen in this offered suite."
      : "No suite-scoped evidence verifies an existing kitchen. Verification is needed.",
    evidenceIds: fact ? [fact.id] : [],
    sourceValue: fact ? fact.source.label : "No kitchen evidence",
  };
}

function parkingAssessment(
  candidate: SpaceCandidate,
  facts: CandidateFact[],
): RequirementAssessment {
  const fact = facts.find((f) => f.field === "customerParking");
  if (fact?.value.kind === "exact" && fact.value.value === "verified_customer_parking") {
    return {
      requirementId: "space.customerParking",
      status: "pass",
      reasonCode: "parking_verified",
      reason: "Supported evidence establishes customer parking use rights.",
      evidenceIds: [fact.id],
      sourceValue: fact.source.label,
    };
  }
  if (fact?.value.kind === "exact" && fact.value.value === "verified_absent") {
    return {
      requirementId: "space.customerParking",
      status: "fail",
      reasonCode: "parking_absent",
      reason: "Supported evidence establishes that customer parking is not available.",
      evidenceIds: [fact.id],
      sourceValue: fact.source.label,
    };
  }
  return {
    requirementId: "space.customerParking",
    status: "unknown",
    reasonCode: "parking_unverified",
    reason: "Customer parking use rights are unverified. Nearby visible stalls alone do not establish customer use.",
    evidenceIds: fact ? [fact.id] : [],
    sourceValue: fact ? fact.source.label : "No parking evidence",
  };
}

function seatsAssessment(
  candidate: SpaceCandidate,
  requirements: SearchRequirements,
  facts: CandidateFact[],
  estimateSeats = false,
): RequirementAssessment {
  const preference = requirementOf(requirements, "space.seats");
  let fact = facts.find((f) => f.field === "seatCapacity");
  let areaEstimate = false;
  if (estimateSeats && (!fact || fact.value.kind === "unknown")) {
    const lowArea = candidate.floorAreaSqFt ?? candidate.sizeRangeSqFt.minimum;
    const highArea = candidate.floorAreaSqFt ?? candidate.sizeRangeSqFt.maximum;
    if (lowArea !== null || highArea !== null) {
      // Planning assumptions: 60% dining area, 15 dining sq ft per seat.
      const seats = (area: number | null) => area === null ? null : Math.floor(area * 0.6 / 15);
      fact = { id: `area-seats:${candidate.id}`, entityScope: "space", entityId: candidate.id, field: "seatCapacity",
        value: lowArea !== null && lowArea === highArea ? { kind: "exact", value: seats(lowArea)! } : { kind: "range", minimum: seats(lowArea), maximum: seats(highArea) },
        unit: "seats", origin: "derived", source: { label: "Listing floor area", recordId: candidate.sourceIds[0], capturedAt: null },
        method: "floor(offered sq ft × 0.60 / 15)", limitations: ["Assumes 60% dining space and 15 dining sq ft per seat; layout and legal occupancy are unverified."], isDemo: candidate.isDemo };
      areaEstimate = true;
    }
  }
  if (!fact || fact.value.kind === "unknown") {
    return {
      requirementId: "space.seats",
      status: estimateSeats ? "unknown" : "not_applicable",
      reasonCode: "capacity_unknown",
      reason: "No usable dining-area or capacity evidence; the seat preference cannot be assessed.",
      evidenceIds: [],
      sourceValue: "Capacity unknown",
    };
  }
  const minimum =
    preference?.value.kind === "range" ? preference.value.minimum : null;
  const maximum =
    preference?.value.kind === "range" ? preference.value.maximum : null;
  if (minimum === null && maximum === null) {
    return {
      requirementId: "space.seats",
      status: estimateSeats ? "pass" : "not_applicable",
      reasonCode: estimateSeats ? "capacity_aligned" : "capacity_unknown",
      reason: areaEstimate ? "Planning seats = floor(listing sq ft × 60% dining allocation ÷ 15 sq ft per seat). Layout and legal occupancy require confirmation." : "The profile has no seat preference to compare against.",
      evidenceIds: areaEstimate ? candidate.sourceIds : [fact.id],
      sourceValue: `${areaEstimate ? "About " : ""}${capacitySourceValue(fact.value)}`,
      ...(areaEstimate ? { estimate: { kind: "area_estimate" as const } } : {}),
    };
  }
  const capacity = fact.value.kind === "exact" ? { low: fact.value.value, high: fact.value.value } : { low: fact.value.minimum, high: fact.value.maximum };
  const aligned =
    (minimum === null || capacity.high === null || capacity.high >= minimum) &&
    (maximum === null || capacity.low === null || capacity.low <= maximum);
  // Soft preference: a mismatch is reported, never a hard rejection.
  return {
    requirementId: "space.seats",
    status: aligned ? "pass" : "unknown",
    reasonCode: aligned ? "capacity_aligned" : "capacity_mismatch",
    reason: areaEstimate ? `${aligned ? "Estimated capacity overlaps your seat preference." : "Estimated capacity is outside your seat preference."} Planning seats = floor(listing sq ft × 60% dining allocation ÷ 15 sq ft per seat). Layout and legal occupancy require confirmation.` : aligned ? "The supported capacity estimate aligns with the 40–50 seat preference." : "The supported capacity estimate is outside the preferred seat range; this is a preference mismatch, not a rejection.",
    evidenceIds: areaEstimate ? candidate.sourceIds : [fact.id],
    sourceValue: `${areaEstimate ? "About " : ""}${capacitySourceValue(fact.value)}`,
    ...(areaEstimate ? { estimate: { kind: "area_estimate" as const } } : {}),
  };
}

function capacitySourceValue(value: CandidateFact["value"]): string {
  if (value.kind === "exact") return `${value.value} seats`;
  if (value.kind === "range")
    return `${value.minimum ?? "?"}–${value.maximum ?? "?"} seats`;
  return "Unknown seats";
}

function neighborhoodAssessment(
  candidate: SpaceCandidate,
  requirements: SearchRequirements,
  facts: CandidateFact[],
): RequirementAssessment {
  const preference = requirementOf(requirements, "market.neighborhoodPreference");
  const preferred =
    preference?.value.kind === "neighborhood" ? preference.value.preferred : [];
  const fact = facts.find((f) => f.field === "neighborhood");
  if (!fact || fact.value.kind === "unknown" || fact.value.value.trim() === "") {
    return {
      requirementId: "market.neighborhoodPreference",
      status: "unknown",
      reasonCode: "neighborhood_unresolved",
      reason: "This space's neighborhood is unresolved; Heights remains preferred but other Houston neighborhoods stay eligible.",
      evidenceIds: fact ? [fact.id] : [],
      sourceValue: fact ? fact.source.label : "Neighborhood unknown",
    };
  }
  const name = fact.value.value;
  if (preferred.some((p) => p.toLowerCase() === name.toLowerCase())) {
    return {
      requirementId: "market.neighborhoodPreference",
      status: "pass",
      reasonCode: "neighborhood_member",
      reason: `${name} matches a preferred neighborhood (${preferred.join(", ")}).`,
      evidenceIds: [fact.id],
      sourceValue: name,
    };
  }
  return {
    requirementId: "market.neighborhoodPreference",
    status: "unknown",
    reasonCode: "neighborhood_other",
    reason: `${name} is not a preferred neighborhood but remains eligible as another Houston neighborhood.`,
    evidenceIds: [fact.id],
    sourceValue: name,
  };
}

export function evaluateCandidate(
  candidate: SpaceCandidate,
  requirements: SearchRequirements,
  facts: CandidateFact[] = [],
  options: { estimateSeats?: boolean } = {},
): RequirementAssessment[] {
  return applyRequirementPreferences([
    occupancyAssessment(candidate, requirements, facts),
    kitchenAssessment(candidate, facts),
    parkingAssessment(candidate, facts),
    seatsAssessment(candidate, requirements, facts, options.estimateSeats),
    neighborhoodAssessment(candidate, requirements, facts),
  ], requirements);
}

/** Explicit opt-outs are preferences, not missing property evidence. */
export function applyRequirementPreferences(assessments: RequirementAssessment[], requirements: SearchRequirements): RequirementAssessment[] {
  return assessments.map(item => {
    if (!["space.existingKitchen", "space.customerParking"].includes(item.requirementId)) return item;
    const requirement = requirementOf(requirements, item.requirementId);
    if (requirement?.value.kind !== "boolean" || requirement.value.value) return item;
    return { requirementId: item.requirementId, status: "not_applicable", reasonCode: "not_applicable",
      reason: `You selected that ${item.requirementId === "space.existingKitchen" ? "an existing kitchen" : "customer parking"} is not required. This does not affect this place’s fit.`,
      sourceValue: "Not required", evidenceIds: [] };
  });
}

export function groupFor(assessments: RequirementAssessment[]): CandidateGroup {
  const hard = assessments.filter((a) => (HARD_IDS as readonly string[]).includes(a.requirementId));
  if (hard.some((a) => a.status === "fail")) return "does_not_meet";
  if (hard.some((a) => a.status === "unknown")) return "needs_verification";
  return "meets_assessed_requirements";
}

const GROUP_RANK: Record<CandidateGroup, number> = {
  meets_assessed_requirements: 0,
  needs_verification: 1,
  does_not_meet: 2,
};

export function orderCandidates(
  assessed: AssessedCandidate[],
): AssessedCandidate[] {
  const sorted = [...assessed].sort((a, b) => {
    const byGroup = GROUP_RANK[a.group] - GROUP_RANK[b.group];
    if (byGroup) return byGroup;
    const hardVerified = (c: AssessedCandidate) =>
      c.assessments.filter(
        (x) => (HARD_IDS as readonly string[]).includes(x.requirementId) && x.status === "pass",
      ).length;
    const byCompleteness = hardVerified(b) - hardVerified(a);
    if (byCompleteness) return byCompleteness;
    const member = (c: AssessedCandidate) =>
      c.assessments.some(
        (x) => x.requirementId === "market.neighborhoodPreference" && x.status === "pass",
      );
    const byNeighborhood = Number(member(b)) - Number(member(a));
    if (byNeighborhood) return byNeighborhood;
    const knownHigh = (c: AssessedCandidate): number | null => {
      const assessment = c.assessments.find(
        (x) => x.requirementId === "occupancy.monthlyLimit",
      );
      if (!assessment) return null;
      const upper = /upper bound of \$([0-9]+)/.exec(assessment.reason);
      if (upper) return Number(upper[1]);
      return null;
    };
    const aCost = knownHigh(a);
    const bCost = knownHigh(b);
    if (aCost !== null && bCost !== null && aCost !== bCost) return aCost - bCost;
    if (aCost === null && bCost !== null) return 1;
    if (aCost !== null && bCost === null) return -1;
    // A real quoted rent outranks "rent not listed" inside the same group.
    const hasRent = (c: AssessedCandidate) => c.candidate.rent !== null && c.candidate.rent.low !== null;
    const byListedRent = Number(hasRent(b)) - Number(hasRent(a));
    if (byListedRent) return byListedRent;
    return a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0;
  });
  return sorted.map((item, index) => {
    const notes: string[] = [`Assessment group: ${item.group.replaceAll("_", " ")}`];
    const hardVerified = item.assessments.filter(
      (x) => (HARD_IDS as readonly string[]).includes(x.requirementId) && x.status === "pass",
    ).length;
    notes.push(`${hardVerified} of ${HARD_IDS.length} hard requirements verified`);
    const member = item.assessments.some(
      (x) => x.requirementId === "market.neighborhoodPreference" && x.status === "pass",
    );
    notes.push(member ? "Preferred neighborhood" : "Neighborhood preference not confirmed");
    const cost = item.assessments.find(
      (x) => x.requirementId === "occupancy.monthlyLimit",
    );
    notes.push(cost && cost.status !== "unknown" ? cost.reason : "Monthly occupancy unverified");
    notes.push(item.candidate.rent !== null && item.candidate.rent.low !== null ? "Listed rent kept ahead of spaces with no listed rent" : "No listed rent: sorted after spaces with a quoted rent");
    notes.push("Tie-break: stable source space ID");
    return { ...item, rank: index + 1, orderingNotes: notes };
  });
}

export function assessCandidates(
  candidates: SpaceCandidate[],
  requirements: SearchRequirements,
  facts: CandidateFact[] = [],
): AssessmentReport {
  const factsByEntity = new Map<string, CandidateFact[]>();
  for (const fact of facts) {
    const list = factsByEntity.get(fact.entityId) ?? [];
    list.push(fact);
    factsByEntity.set(fact.entityId, list);
  }
  const assessed: AssessedCandidate[] = candidates.map((candidate) => {
    const assessments = evaluateCandidate(
      candidate,
      requirements,
      factsByEntity.get(candidate.id) ?? [],
    );
    return {
      candidate,
      assessments,
      group: groupFor(assessments),
      rank: 0,
      orderingNotes: [],
    };
  });
  const ordered = orderCandidates(assessed);
  return assessmentReportSchema.parse({
    modelVersion: MATCHING_MODEL_VERSION,
    requirements,
    counts: {
      examined: candidates.length,
      meets: ordered.filter((c) => c.group === "meets_assessed_requirements").length,
      needsVerification: ordered.filter((c) => c.group === "needs_verification").length,
      doesNotMeet: ordered.filter((c) => c.group === "does_not_meet").length,
      useUnknown: candidates.filter((c) => c.spaceUseCode === 0 || c.spaceUseCode === null).length,
    },
    candidates: ordered,
  });
}
