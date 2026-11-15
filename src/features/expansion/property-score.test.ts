import assert from "node:assert/strict";
import test from "node:test";
import { candidateSchema, factSchema } from "./domain/matching.ts";
import { calculatePropertyScore, propertyScoreLabel } from "./domain/property-score.ts";
import { normalizeRequirements } from "./domain/requirements.ts";
import { investigationNoteSchema, EVIDENCE_VERSION } from "./domain/evidence.ts";
import { exampleIntake } from "./frontend/data/intake-example.ts";
import { PROPERTY_INFERENCE_VERSION } from "./domain/property-inference.ts";

const now = "2026-11-15T10:00:00.000Z";
const requirements = normalizeRequirements(exampleIntake(), { revisionId: "score-test", revisionNumber: 0, createdAt: now });
const candidate = candidateSchema.parse({ id: "space-1", name: "Test suite", address: null, suite: null, cityId: "houston", latitude: null, longitude: null, h3Index: null,
  floorAreaSqFt: 1125, sizeRangeSqFt: { minimum: 1125, maximum: 1125 },
  rent: { low: 24, high: 24, rateBasisCode: 2, currencyCode: 1, measurementCode: 1, serviceTypeCode: 13 },
  spaceUseCode: 5, listingStatusCode: 1, propertyId: "property-1", sourceIds: ["listing-1"], recordDate: null, datasetDate: null, isDemo: false });
const note = (field: "existingKitchen" | "customerParking", value: string, origin = "observed") => investigationNoteSchema.parse({
  id: `${field}-${value}`, category: origin === "observed" ? "verification" : "assumption", createdAt: now, text: "Owner inspection",
  fact: factSchema.parse({ id: `${field}-${value}`, entityScope: "space", entityId: candidate.id, field, value: { kind: "exact", value }, unit: null, origin,
    source: { label: "Owner inspection", recordId: "visit-1", capturedAt: now }, method: "Dated site visit", limitations: [], isDemo: false }),
});

test("score is deterministic, decimal, bounded, and based on available factors only", () => {
  const input = { candidate, requirements };
  const result = calculatePropertyScore(input);
  assert.deepEqual(result, calculatePropertyScore(input));
  assert.equal(result.score, 10);
  assert.equal(result.includedCount, 3);
  assert.equal(result.coverage, .75);
  assert.equal(propertyScoreLabel(result), "10.0/10");
  const moreExpensive = calculatePropertyScore({ ...input, candidate: { ...candidate, rent: { ...candidate.rent!, low: 60, high: 60 } } });
  assert.ok(moreExpensive.score! < result.score!);
  assert.ok(moreExpensive.score! >= 1 && moreExpensive.score! <= 10);
  assert.equal(moreExpensive.score! * 10, Math.round(moreExpensive.score! * 10));
});

test("AI kitchen probability and parking photo never change the score or coverage", () => {
  const result = calculatePropertyScore({ candidate, requirements });
  const ai = calculatePropertyScore({ candidate, requirements, sources: {
    version: EVIDENCE_VERSION, candidateId: candidate.id, refreshedAt: now, observations: [], statuses: [], gaps: [],
    propertyInference: { version: PROPERTY_INFERENCE_VERSION, candidateId: candidate.id, model: "test-model", origin: "assumed", assessedAt: now, photoUsed: true, evidenceIds: ["listing-1"],
      kitchen: { probability: .99, reason: "AI guess" }, parking: { probability: .99, lotVisible: true, reason: "AI photo interpretation" } },
  } });
  assert.deepEqual(ai, result);
});

test("verified required kitchen affects score, assumptions do not, opt-out ignores either result", () => {
  const absent = note("existingKitchen", "verified_absent");
  const present = note("existingKitchen", "verified_present");
  const base = calculatePropertyScore({ candidate, requirements });
  assert.ok(calculatePropertyScore({ candidate, requirements, notes: [absent] }).score! < base.score!);
  assert.equal(calculatePropertyScore({ candidate, requirements, notes: [present] }).factors.find(f => f.key === "kitchen")?.score, 10);
  assert.equal(calculatePropertyScore({ candidate, requirements, notes: [note("existingKitchen", "verified_absent", "assumed")] }).score, base.score);
  const optional = structuredClone(requirements);
  optional.requirements.find(r => r.id === "space.existingKitchen")!.value = { kind: "boolean", value: false };
  const withoutKitchen = calculatePropertyScore({ candidate, requirements: optional });
  assert.deepEqual(calculatePropertyScore({ candidate, requirements: optional, notes: [absent] }).factors.find(f => f.key === "kitchen")?.score, null);
  assert.equal(calculatePropertyScore({ candidate, requirements: optional, notes: [absent] }).score, withoutKitchen.score);
  assert.equal(calculatePropertyScore({ candidate, requirements: optional, notes: [present] }).coverage, withoutKitchen.coverage);
  assert.equal(withoutKitchen.activeCount, 5);
});

test("conflicting verification is excluded and wrong-property evidence is rejected", () => {
  const result = calculatePropertyScore({ candidate, requirements, notes: [note("customerParking", "verified_customer_parking"), note("customerParking", "verified_absent")] });
  assert.equal(result.factors.find(f => f.key === "parking")?.score, null);
  const wrong = note("existingKitchen", "verified_present");
  wrong.fact.entityId = "another-suite";
  assert.throws(() => calculatePropertyScore({ candidate, requirements, notes: [wrong] }), /another property/);
});

test("missing data stays unscored, and rent/area ranges use conservative upper bounds", () => {
  const missing = { ...candidate, rent: null, floorAreaSqFt: null, sizeRangeSqFt: { minimum: null, maximum: null }, spaceUseCode: null };
  assert.equal(calculatePropertyScore({ candidate: missing, requirements }).score, null);
  assert.equal(propertyScoreLabel(calculatePropertyScore({ candidate: missing, requirements })), "Not scored");
  const range = calculatePropertyScore({ candidate: { ...candidate, floorAreaSqFt: null, sizeRangeSqFt: { minimum: 1125, maximum: 3000 } }, requirements });
  assert.ok(range.factors.find(f => f.key === "seats")!.score! < 10);
  assert.ok(range.factors.find(f => f.key === "rent")!.score! < 10);
  assert.throws(() => calculatePropertyScore({ candidate: { ...candidate, floorAreaSqFt: Number.NaN }, requirements }));
  assert.throws(() => calculatePropertyScore({ candidate: { ...candidate, sizeRangeSqFt: { minimum: 3000, maximum: 1000 } }, requirements }), /inverted/);
  assert.throws(() => calculatePropertyScore({ candidate: { ...candidate, rent: { ...candidate.rent!, low: 60, high: 24 } }, requirements }), /inverted/);
});
