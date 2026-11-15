import { z } from "zod";
import type { RequirementAssessment } from "./matching.ts";

export const PROPERTY_INFERENCE_VERSION = "expansion-property-inference-v1";
export const propertyInferenceOutputSchema = z.object({
  parking: z.object({
    lotVisible: z.boolean().nullable(),
    probability: z.number().finite().min(0).max(1),
    reason: z.string().min(1).max(1200),
  }),
  kitchen: z.object({
    probability: z.number().finite().min(0).max(1),
    reason: z.string().min(1).max(1200),
  }),
});
export const propertyInferenceSchema = propertyInferenceOutputSchema.extend({
  version: z.literal(PROPERTY_INFERENCE_VERSION),
  candidateId: z.string().min(1),
  model: z.string().min(1),
  origin: z.literal("assumed"),
  assessedAt: z.iso.datetime(),
  photoUsed: z.boolean(),
  evidenceIds: z.array(z.string().min(1)).min(1),
});
export type PropertyInference = z.infer<typeof propertyInferenceSchema>;

/** Estimates fill evidence gaps; dated observations and conflicts retain priority. */
export function applyPropertyInference(assessments: RequirementAssessment[], inference: PropertyInference): RequirementAssessment[] {
  return assessments.map(item => {
    if (item.status !== "unknown" || item.reasonCode === "unknown_value") return item;
    if (item.requirementId === "space.existingKitchen") {
      const likely = inference.kitchen.probability > 0.6;
      return { ...item, status: likely ? "pass" : "unknown", reasonCode: likely ? "kitchen_likely" : "kitchen_unlikely",
        reason: `${inference.kitchen.reason} AI probability is an estimate, not an inspection. A green check requires more than 60%.`,
        sourceValue: `${Math.round(inference.kitchen.probability * 100)}% estimated chance of an existing kitchen`,
        evidenceIds: inference.evidenceIds, estimate: { kind: "ai_estimate", probability: inference.kitchen.probability } };
    }
    if (item.requirementId === "space.customerParking") {
      const visible = inference.photoUsed && inference.parking.lotVisible === true;
      return { ...item, status: visible ? "pass" : "unknown", reasonCode: visible ? "parking_visible" : "parking_unlikely",
        reason: `${inference.parking.reason} Photo interpretation does not establish customer parking allocation or lease rights.`,
        sourceValue: visible ? "Parking lot visible in the property photo" : inference.photoUsed ? "AI did not identify a clear parking lot in the photo" : "AI assessed parking; no property photo available",
        evidenceIds: inference.evidenceIds, estimate: { kind: "ai_estimate", probability: inference.parking.probability } };
    }
    return item;
  });
}
