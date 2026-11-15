import { z } from "zod";
import { investigationNoteSchema, sourceSnapshotSchema } from "./evidence.ts";
import { candidateSchema, monthlyOccupancyRange, type CandidateFact } from "./matching.ts";
import { searchRequirementsSchema } from "./requirements.ts";
import { isOfficialNeighborhoodFact, neighborhoodsMatch } from "./neighborhood.ts";

export const PROPERTY_SCORE_VERSION = "expansion-property-fit-v1";
export const MIN_PROPERTY_SCORE_COVERAGE = 0.25;
export const propertyScoreInputSchema = z.object({
  candidate: candidateSchema, requirements: searchRequirementsSchema,
  sources: sourceSnapshotSchema.optional(), notes: z.array(investigationNoteSchema).default([]),
}).superRefine(({ candidate }, ctx) => {
  const area = candidate.sizeRangeSqFt;
  const rent = candidate.rent;
  if (area.minimum !== null && area.maximum !== null && area.minimum > area.maximum)
    ctx.addIssue({ code: "custom", message: "Offered area range is inverted." });
  if (rent?.low !== null && rent?.low !== undefined && rent.high !== null && rent.low > rent.high)
    ctx.addIssue({ code: "custom", message: "Listed rent range is inverted." });
});
export const propertyScoreFactorSchema = z.object({
  key: z.enum(["rent", "seats", "use", "neighborhood", "kitchen", "parking"]),
  label: z.string(), weight: z.number().nonnegative(), score: z.number().min(1).max(10).nullable(),
  origin: z.enum(["observed", "derived", "unavailable"]),
  explanation: z.string(), evidenceIds: z.array(z.string()),
});
export const propertyScoreSchema = z.object({
  modelVersion: z.literal(PROPERTY_SCORE_VERSION), candidateId: z.string(),
  score: z.number().min(1).max(10).nullable(), coverage: z.number().min(0).max(1),
  includedCount: z.number().int().nonnegative(), activeCount: z.number().int().nonnegative(),
  isDemo: z.boolean(), factors: z.array(propertyScoreFactorSchema),
});
export type PropertyScore = z.infer<typeof propertyScoreSchema>;
type Factor = z.infer<typeof propertyScoreFactorSchema>;
const bound = (value: number) => Math.min(10, Math.max(1, value));

/** Pure numeric interpretation of the run's structured listing and inspection evidence. */
export function calculatePropertyScore(raw: z.input<typeof propertyScoreInputSchema>): PropertyScore {
  const { candidate, requirements, sources, notes } = propertyScoreInputSchema.parse(raw);
  if (sources && sources.candidateId !== candidate.id) throw new Error("Score evidence belongs to another property.");
  if (notes.some(n => n.fact.entityId !== candidate.id)) throw new Error("Score notes belong to another property.");
  const value = (id: string) => requirements.requirements.find(r => r.id === id)?.value;
  const allFacts = [...(sources?.observations.flatMap(o => o.facts) ?? []), ...notes.map(n => n.fact)]
    .filter(f => f.entityId === candidate.id && (f.origin === "observed" || isOfficialNeighborhoodFact(f)) && f.source.recordId && f.source.capturedAt && (!f.isDemo || candidate.isDemo) && f.value.kind !== "unknown");
  const verified = (field: CandidateFact["field"]) => {
    const facts = allFacts.filter(f => f.field === field);
    return new Set(facts.map(f => JSON.stringify(f.value))).size === 1 ? facts[0] : undefined;
  };
  const factors: Factor[] = [];
  const add = (key: Factor["key"], label: string, weight: number, score: number | null, explanation: string, evidenceIds: string[] = [], origin: Factor["origin"] = "derived") => {
    factors.push({ key, label, weight, score, explanation, evidenceIds, origin: score === null ? "unavailable" : origin });
  };

  const budget = value("occupancy.monthlyLimit");
  const base = monthlyOccupancyRange(candidate, 0, "not_included");
  const rentHigh = "known" in base ? base.known.high : null;
  const rentScore = budget?.kind === "number" && budget.value > 0 && rentHigh !== null ? bound(13 - 6 * rentHigh / budget.value) : null;
  add("rent", "Base-rent fit", 35, rentScore, rentScore === null ? "A listed rent, bounded offered area and rent budget are needed. Market rent estimates are excluded." : `Upper listed base rent $${Math.round(rentHigh!)}/mo vs $${budget?.kind === "number" ? budget.value : ""}/mo budget. 50% of budget = 10; 100% = 7; 200% = 1. Extra charges are excluded.`, candidate.sourceIds);

  const target = value("space.seats");
  const seatFact = verified("seatCapacity");
  const measured = seatFact?.value;
  const areaLow = candidate.floorAreaSqFt ?? candidate.sizeRangeSqFt.minimum;
  const areaHigh = candidate.floorAreaSqFt ?? candidate.sizeRangeSqFt.maximum;
  const seats = measured?.kind === "exact" && typeof measured.value === "number" ? [measured.value, measured.value]
    : measured?.kind === "range" ? [measured.minimum, measured.maximum]
    : [areaLow === null ? null : Math.floor(areaLow * 0.6 / 15), areaHigh === null ? null : Math.floor(areaHigh * 0.6 / 15)];
  const hasTarget = target?.kind === "range" && (target.minimum !== null || target.maximum !== null);
  const seatFit = (n: number) => !hasTarget ? 10 : bound(10 * Math.min(1, target.minimum && n < target.minimum ? n / target.minimum : 1, target.maximum !== null && n > target.maximum ? target.maximum / n : 1));
  const seatScore = hasTarget && seats[0] !== null && seats[1] !== null ? Math.min(...seats.map(n => seatFit(n!))) : null;
  add("seats", "Seating fit", hasTarget ? 25 : 0, seatScore, !hasTarget ? "No seating preference; excluded." : seatScore === null ? "Offered floor area or verified capacity is missing." : `${seats[0]}–${seats[1]} seats vs ${target.minimum ?? "any"}–${target.maximum ?? "any"} preferred. Score uses the less favorable range endpoint. ${seatFact ? "Dated capacity evidence." : "Planning estimate: 60% dining area / 15 sq ft per seat; not legal occupancy."}`, seatFact ? [seatFact.id] : candidate.sourceIds);

  const use = candidate.spaceUseCode;
  const useScore = use === 3 || use === 5 ? 10 : use !== null && [1, 2, 4, 7].includes(use) ? 1 : null;
  add("use", "Listed space use", 15, useScore, useScore === null ? "Unknown or Flex use does not establish restaurant compatibility; excluded." : useScore === 10 ? "Listed Retail or Office/Retail use; restaurant permission still requires confirmation." : "Listed use is incompatible with the restaurant search.", candidate.sourceIds, "observed");

  const neighborhood = value("market.neighborhoodPreference");
  const neighborhoodFact = verified("neighborhood");
  const name = neighborhoodFact?.value.kind === "exact" ? String(neighborhoodFact.value.value) : null;
  const wanted = neighborhood?.kind === "neighborhood" && neighborhood.preferred.length > 0;
  const neighborhoodScore = wanted && name ? (neighborhood.preferred.some(n => neighborhoodsMatch(n, name)) ? 10 : 5) : null;
  add("neighborhood", "Neighborhood preference", wanted ? 10 : 0, neighborhoodScore, !wanted ? "No neighborhood preference; excluded." : name ? `${name}: preferred = 10; another eligible neighborhood = 5.` : "No dated neighborhood evidence; excluded.", neighborhoodFact ? [neighborhoodFact.id] : []);

  for (const [key, requirement, field, label, present, weight] of [
    ["kitchen", "space.existingKitchen", "existingKitchen", "Existing kitchen", "verified_present", 10],
    ["parking", "space.customerParking", "customerParking", "Customer parking", "verified_customer_parking", 5],
  ] as const) {
    const need = value(requirement);
    const required = need?.kind === "boolean" && need.value;
    const fact = verified(field);
    const factValue = fact?.value.kind === "exact" ? fact.value.value : null;
    const score = required && factValue === present ? 10 : required && factValue === "verified_absent" ? 1 : null;
    add(key, label, required ? weight : 0, score, !required ? "Not required; no effect on score or coverage." : score === null ? "No dated, verified suite evidence. AI photo interpretations and kitchen probabilities are excluded." : score === 10 ? "Dated suite evidence confirms this requirement." : "Dated suite evidence confirms this requirement is not met.", fact ? [fact.id] : [], "observed");
  }
  const active = factors.filter(f => f.weight > 0);
  const included = active.filter(f => f.score !== null);
  const totalWeight = active.reduce((sum, f) => sum + f.weight, 0);
  const includedWeight = included.reduce((sum, f) => sum + f.weight, 0);
  const coverage = totalWeight > 0 ? includedWeight / totalWeight : 0;
  const score = includedWeight > 0 && coverage >= MIN_PROPERTY_SCORE_COVERAGE
    ? Math.round(included.reduce((sum, f) => sum + f.score! * f.weight, 0) / includedWeight * 10) / 10 : null;
  return propertyScoreSchema.parse({ modelVersion: PROPERTY_SCORE_VERSION, candidateId: candidate.id, score, coverage,
    includedCount: included.length, activeCount: active.length, isDemo: candidate.isDemo, factors });
}

export const propertyScoreLabel = (score: PropertyScore) => score.score === null ? "Not scored" : `${score.score.toFixed(1)}/10`;
