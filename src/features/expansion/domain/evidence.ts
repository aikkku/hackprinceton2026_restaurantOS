import { z } from "zod";
import { applyRequirementPreferences, assessmentSchema, candidateSchema, evaluateCandidate, factSchema, groupFor, type AssessedCandidate, type CandidateFact } from "./matching.ts";
import { searchRequirementsSchema, type SearchRequirements } from "./requirements.ts";
import { applyPropertyInference, PROPERTY_INFERENCE_VERSION, propertyInferenceSchema } from "./property-inference.ts";
import { isOfficialNeighborhoodFact } from "./neighborhood.ts";

export const EVIDENCE_VERSION = "expansion-investigation-evidence-v1";
export const providerNames = ["matterport", "vexcel", "neighborhood", "acs", "competition"] as const;
export const providerStatusSchema = z.object({
  provider: z.enum(providerNames), status: z.enum(["configured", "verified", "denied", "outside_coverage", "unavailable"]),
  mode: z.enum(["live", "synthetic", "unavailable"]), checkedAt: z.iso.datetime(),
  capabilities: z.array(z.string()), reason: z.string().min(1),
});
export const sourceObservationSchema = z.object({
  id: z.string().min(1), provider: z.enum(providerNames), candidateId: z.string().min(1),
  scope: z.enum(["suite", "property", "site", "tract"]), sourceRecordId: z.string().min(1),
  sourceDate: z.string().nullable(), retrievedAt: z.iso.datetime(),
  origin: z.enum(["observed", "derived", "simulated"]), isSynthetic: z.boolean(),
  label: z.string().min(1), details: z.array(z.string()), limitations: z.array(z.string()),
  referenceUrl: z.url().nullable(), viewerUrl: z.url().nullable(), imageUrl: z.string().startsWith("/api/expansion/investigations/").nullable().default(null),
  facts: z.array(factSchema), exportAllowed: z.boolean(),
});
export type SourceObservation = z.infer<typeof sourceObservationSchema>;
export const sourceSnapshotSchema = z.object({
  version: z.literal(EVIDENCE_VERSION), candidateId: z.string().min(1), refreshedAt: z.iso.datetime(),
  statuses: z.array(providerStatusSchema), observations: z.array(sourceObservationSchema), gaps: z.array(z.string()),
  propertyInference: propertyInferenceSchema.optional(),
}).superRefine((snapshot, ctx) => {
  if (snapshot.propertyInference && snapshot.propertyInference.candidateId !== snapshot.candidateId) ctx.addIssue({ code: "custom", message: "Property inference must belong to this candidate." });
  const ids = snapshot.observations.map(x => x.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Duplicate evidence IDs." });
  for (const item of snapshot.observations) {
    if (item.candidateId !== snapshot.candidateId || item.facts.some(f => f.entityId !== snapshot.candidateId || f.isDemo !== item.isSynthetic))
      ctx.addIssue({ code: "custom", message: "Evidence belongs to another candidate or source mode." });
    if (item.isSynthetic !== (item.origin === "simulated")) ctx.addIssue({ code: "custom", message: "Synthetic evidence must be labeled simulated." });
    if (item.scope !== "suite" && item.facts.some(f => ["existingKitchen", "customerParking", "monthlyAdditionalCharges", "seatCapacity"].includes(f.field)))
      ctx.addIssue({ code: "custom", message: "Property/site metadata cannot supply suite facts." });
    if (item.viewerUrl && !/^https:\/\/my\.matterport\.com\/show\/\?m=[A-Za-z0-9_-]+$/.test(item.viewerUrl))
      ctx.addIssue({ code: "custom", message: "Unapproved viewer URL." });
  }
});
export type SourceSnapshot = z.infer<typeof sourceSnapshotSchema>;

/** A verification is the user's dated attestation, not an independent provider certification. */
export const investigationNoteSchema = z.object({
  id: z.string().min(1), category: z.enum(["assumption", "verification"]), createdAt: z.iso.datetime(),
  text: z.string().trim().min(1).max(2000), fact: factSchema,
}).superRefine((note, ctx) => {
  if (note.fact.origin !== (note.category === "verification" ? "observed" : "assumed"))
    ctx.addIssue({ code: "custom", message: "Notes must preserve assumed versus observed origin." });
  if (note.category === "verification" && (!note.fact.source.capturedAt || !note.fact.source.recordId || !note.fact.method))
    ctx.addIssue({ code: "custom", message: "Verification requires a dated source reference and method." });
});
export type InvestigationNote = z.infer<typeof investigationNoteSchema>;
export const assessmentRevisionSchema = z.object({
  version: z.literal(EVIDENCE_VERSION), id: z.string().min(1), parentId: z.string().nullable(),
  revisionNumber: z.number().int().nonnegative(), evaluatedAt: z.iso.datetime(), profileRevisionId: z.string().min(1),
  candidate: candidateSchema, notes: z.array(investigationNoteSchema), sources: sourceSnapshotSchema,
  assessments: z.array(assessmentSchema), group: z.enum(["meets_assessed_requirements", "needs_verification", "does_not_meet"]),
  conflicts: z.array(z.string()),
  propertyAssessmentVersion: z.literal(PROPERTY_INFERENCE_VERSION).optional(),
});
export type AssessmentRevision = z.infer<typeof assessmentRevisionSchema>;

export function reassessCandidate(base: AssessedCandidate, rawRequirements: SearchRequirements, rawNotes: InvestigationNote[], rawSources: SourceSnapshot, metadata: Pick<AssessmentRevision, "id" | "parentId" | "revisionNumber" | "evaluatedAt" | "propertyAssessmentVersion">): AssessmentRevision {
  const requirements = searchRequirementsSchema.parse(rawRequirements);
  const notes = z.array(investigationNoteSchema).parse(rawNotes);
  const sources = sourceSnapshotSchema.parse(rawSources);
  const candidate = candidateSchema.parse(base.candidate);
  if (sources.candidateId !== candidate.id || notes.some(n => n.fact.entityId !== candidate.id)) throw new Error("Evidence belongs to a different candidate.");
  if (sources.propertyInference?.evidenceIds.some(id => !candidate.sourceIds.includes(id) && !sources.observations.some(o => o.id === id))) throw new Error("Property inference references unknown evidence.");
  const allFacts = [...sources.observations.flatMap(x => x.facts), ...notes.map(x => x.fact)];
  // The Phase 2 evaluator consumes trusted facts. This adapter enforces origin,
  // suite association, source date and conflict policy before invoking it.
  const eligible = allFacts.filter(f => (f.origin === "observed" || isOfficialNeighborhoodFact(f)) && (!f.isDemo || candidate.isDemo) && f.source.capturedAt && f.source.recordId);
  const fields = ["existingKitchen", "customerParking", "seatCapacity", "neighborhood", "monthlyAdditionalCharges"] as const;
  const conflicts = fields.filter(field => new Set(eligible.filter(f => f.field === field && f.value.kind !== "unknown").map(f => JSON.stringify(f.value))).size > 1);
  const safeFacts: CandidateFact[] = eligible.filter(f => !conflicts.includes(f.field));
  // Frozen older plans retain their original capacity method on recomputation.
  let assessments = evaluateCandidate(candidate, requirements, safeFacts, { estimateSeats: metadata.propertyAssessmentVersion === PROPERTY_INFERENCE_VERSION });
  const requirementFor = { existingKitchen: "space.existingKitchen", customerParking: "space.customerParking", seatCapacity: "space.seats", neighborhood: "market.neighborhoodPreference", monthlyAdditionalCharges: "occupancy.monthlyLimit" };
  for (const field of conflicts) {
    const item = assessments.find(a => a.requirementId === requirementFor[field]);
    if (item) Object.assign(item, { status: "unknown", reasonCode: "unknown_value", reason: "Conflicting dated observations are retained; resolve them before treating this requirement as verified.", evidenceIds: eligible.filter(f => f.field === field).map(f => f.id), sourceValue: "Conflicting observations" });
  }
  if (sources.propertyInference && !candidate.isDemo) assessments = applyPropertyInference(assessments, sources.propertyInference);
  assessments = applyRequirementPreferences(assessments, requirements);
  return assessmentRevisionSchema.parse({ ...metadata, version: EVIDENCE_VERSION, profileRevisionId: requirements.revisionId, candidate, notes, sources, assessments, group: groupFor(assessments), conflicts });
}
