import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeRequirements } from "./domain/requirements.ts";
import type { AssessedCandidate, RequirementAssessment, SpaceCandidate } from "./domain/matching.ts";
import { rentEstimateSchema, RENT_ESTIMATE_MODEL_VERSION, type RentEstimate } from "./domain/rent-estimate.ts";
import { formFromRevision } from "./frontend/profile-form.ts";
import { currentProfileRevision } from "./frontend/storage.ts";
import {
  bestMatches, checkQuestion, compareTake, costLabel, costPin, displayOrder, estimateCostLabel, estimatePin, fitForGroup, friendlyReason, makeChoice, monthlyCost, primaryFinding, verdict,
} from "./frontend/sprout/model.ts";
import { effectiveIntake, exampleEnvelope, reviseFromForm } from "./frontend/sprout/profile.ts";
import { MAX_SAVED_PLACES, SEARCH_SESSION_KEY, readSearchSession, writeSearchSession, type SearchSession } from "./frontend/sprout/session.ts";

const requirements = (() => {
  const envelope = exampleEnvelope("2026-11-15T00:00:00.000Z");
  return currentProfileRevision(envelope).requirements;
})();

function space(over: Partial<SpaceCandidate> = {}): SpaceCandidate {
  return {
    id: "costar-space:1", name: "Test Building · Suite A", address: "1 Test Way", suite: "A", cityId: "houston",
    latitude: 29.76, longitude: -95.36, h3Index: null, floorAreaSqFt: 1200, sizeRangeSqFt: { minimum: 1200, maximum: 1200 },
    rent: { low: 2, high: 2, rateBasisCode: 1, currencyCode: 1, measurementCode: 1, serviceTypeCode: 7 },
    spaceUseCode: 5, listingStatusCode: 1, propertyId: "1", sourceIds: ["costar:listing:1"], recordDate: null, datasetDate: null, isDemo: false, ...over,
  };
}
const assessed = (candidate: SpaceCandidate, group: AssessedCandidate["group"], assessments: AssessedCandidate["assessments"], rank = 1): AssessedCandidate =>
  ({ candidate, group, assessments, rank, orderingNotes: [] });
const kitchenUnknown: RequirementAssessment = { requirementId: "space.existingKitchen", status: "unknown", reasonCode: "kitchen_unverified", reason: "r", evidenceIds: [], sourceValue: "No kitchen evidence" };
const costPass: RequirementAssessment = { requirementId: "occupancy.monthlyLimit", status: "pass", reasonCode: "below_cap", reason: "r", evidenceIds: [], sourceValue: "s" };
const costFail: RequirementAssessment = { requirementId: "occupancy.monthlyLimit", status: "fail", reasonCode: "exceeds_cap", reason: "r", evidenceIds: [], sourceValue: "s" };

test("monthly cost labels never treat unknown charges as zero", () => {
  assert.equal(costLabel(monthlyCost(space())), "$2,400/mo");
  assert.equal(costPin(monthlyCost(space())), "$2.4k");
  const open = monthlyCost(space({ rent: { low: 3, high: 3, rateBasisCode: 1, currencyCode: 1, measurementCode: 1, serviceTypeCode: 13 } }));
  assert.equal(open.kind, "open");
  assert.equal(costLabel(open), "$3,600/mo + unknown charges");
  assert.equal(costPin(open), "$3.6k+");
  assert.equal(costLabel(monthlyCost(space({ rent: null }))), "Rent not listed");
});

test("cost questions ask about the missing rent, and about charges only when the rent exists", () => {
  const missingRent: RequirementAssessment = { requirementId: "occupancy.monthlyLimit", status: "unknown", reasonCode: "ambiguous_basis", reason: "No supported asking rent was supplied for this space.", evidenceIds: [], sourceValue: "No asking rent" };
  const missingCharges: RequirementAssessment = { requirementId: "occupancy.monthlyLimit", status: "unknown", reasonCode: "missing_charges", reason: "Base rent is within the cap but additional occupancy charges are unknown.", evidenceIds: [], sourceValue: "s" };
  const crosses: RequirementAssessment = { requirementId: "occupancy.monthlyLimit", status: "unknown", reasonCode: "range_crosses_cap", reason: "r", evidenceIds: [], sourceValue: "s" };
  assert.equal(friendlyReason("ambiguous_basis", requirements), "The asking rent isn’t listed");
  assert.equal(checkQuestion(missingRent), "What is the asking rent? Ask the broker.");
  assert.equal(checkQuestion(missingCharges), "What are the extra building charges (taxes, insurance, upkeep) each month?");
  assert.equal(checkQuestion(crosses), "What are the extra building charges (taxes, insurance, upkeep) each month?");
});

test("plain-language findings and verdicts follow the assessment group", () => {
  assert.equal(fitForGroup("meets_assessed_requirements"), "meets");
  assert.equal(friendlyReason("exceeds_cap", requirements), "Costs more than your $5,000 budget");
  const verify = assessed(space(), "needs_verification", [costPass, kitchenUnknown]);
  assert.deepEqual(primaryFinding(verify, requirements), { fit: "verify", text: "Kitchen isn’t confirmed yet" });
  assert.equal(verdict(verify.assessments, verify.group, requirements), "This place could work, but kitchen isn’t confirmed yet.");
  const fails = assessed(space(), "does_not_meet", [costFail]);
  assert.match(verdict(fails.assessments, fails.group, requirements), /doesn’t fit: costs more than your \$5,000 budget/);
});

test("best matches skip places that miss a must-have when others could work", () => {
  const items = [
    assessed(space({ id: "a" }), "does_not_meet", [costFail], 0),
    assessed(space({ id: "b" }), "needs_verification", [kitchenUnknown], 1),
    assessed(space({ id: "c" }), "needs_verification", [kitchenUnknown], 2),
  ];
  assert.deepEqual(bestMatches(items).map((x) => x.candidate.id), ["b", "c"]);
});

test("Sprout's take only restates checked facts", () => {
  const take = compareTake([
    { name: "A", assessments: [costPass], group: "meets_assessed_requirements", cost: { kind: "exact", low: 4000, high: 4000 } },
    { name: "B", assessments: [costPass, kitchenUnknown], group: "needs_verification", cost: { kind: "open", low: 3000 } },
  ], requirements);
  assert.deepEqual(take, [
    "A meets all your must-haves.",
    "B still needs checking on kitchen.",
    "The full monthly cost of B isn’t known yet.",
    "None of these is confirmed to be in a neighborhood you picked.",
  ]);
});

test("a new choice copies profile funds and keeps an unknown reserve unknown", () => {
  const choice = makeChoice(requirements, assessed(space(), "needs_verification", [costPass, kitchenUnknown]));
  assert.equal(choice.financeInputs.totalFunds, 100000);
  assert.equal(choice.financeInputs.reserve, null);
  assert.equal(choice.financeResults.usableFunds, null);
  assert.equal(choice.assessment.revisionNumber, 0);
});

test("profile revisions are cumulative and an unchanged form adds no revision", () => {
  const envelope = exampleEnvelope("2026-11-15T00:00:00.000Z");
  const form = formFromRevision(currentProfileRevision(envelope));
  const same = reviseFromForm(envelope, form);
  assert.ok(same.ok && !same.changed);

  const first = reviseFromForm(envelope, { ...form, occupancy: "6000" });
  assert.ok(first.ok && first.changed);
  assert.equal(first.revision.revisionNumber, 1);
  assert.match(first.revision.editSummary, /monthly rent budget/);

  // A second edit must keep the first one (edits are diffed against revision 0).
  const second = reviseFromForm(first.envelope, { ...formFromRevision(first.revision), seatsMin: "30", seatsMax: "40" });
  assert.ok(second.ok && second.changed);
  const byId = new Map(second.revision.requirements.requirements.map((r) => [r.id, r.value]));
  assert.deepEqual(byId.get("occupancy.monthlyLimit"), { kind: "number", value: 6000 });
  assert.deepEqual(byId.get("space.seats"), { kind: "range", minimum: 30, maximum: 40 });
  assert.equal(second.revision.parentRevisionId, first.revision.revisionId);

  const invalid = reviseFromForm(envelope, { ...form, neighborhoods: "" });
  assert.equal(invalid.ok, false);
});

test("the effective intake carries owner edits so a search uses them", () => {
  const envelope = exampleEnvelope("2026-11-15T00:00:00.000Z");
  const base = currentProfileRevision(envelope);
  assert.deepEqual(effectiveIntake(base), base.intakeSnapshot);

  const edited = reviseFromForm(envelope, { ...formFromRevision(base), occupancy: "6500", kitchen: false, neighborhoods: "Heights, Montrose" });
  assert.ok(edited.ok);
  const intake = effectiveIntake(edited.revision);
  assert.equal(intake.budget.maximumMonthlyOccupancyCost, 6500);
  assert.equal(intake.space.mustHave.existingKitchen, false);
  assert.deepEqual(intake.expansion.preferredNeighborhoods, ["Heights", "Montrose"]);
  assert.deepEqual(intake.budget.sourceAnswerIds, []);
  assert.deepEqual(intake.restaurant.sourceAnswerIds, base.intakeSnapshot.restaurant.sourceAnswerIds);
  assert.match(intake.matchingNotes.at(-1) ?? "", /profile revision 1/);
  // The interview record itself is untouched.
  assert.equal(edited.revision.intakeSnapshot.budget.maximumMonthlyOccupancyCost, 5000);
  // What the search service will normalize matches the owner's revision.
  const normalized = normalizeRequirements(intake, { revisionId: "x", revisionNumber: 1, createdAt: "2026-11-15T00:00:00.000Z" });
  const values = (list: typeof normalized.requirements) => Object.fromEntries(list.map((r) => [r.id, r.value]));
  assert.deepEqual(values(normalized.requirements), values(edited.revision.requirements.requirements));
});

test("search session storage is validated and tolerant of bad data", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  const session: SearchSession = { version: 1, source: "agent", runId: "run-1", cityLabel: "Houston", placesFound: 30, profileRevisionId: "rev", saved: ["a", "b"], pick: "a", choices: [], updatedAt: "2026-11-15T00:00:00.000Z" };
  assert.equal(writeSearchSession(storage, session), true);
  assert.deepEqual(readSearchSession(storage), session);
  assert.equal(writeSearchSession(storage, { ...session, saved: Array.from({ length: MAX_SAVED_PLACES + 1 }, (_, i) => `p${i}`) }), false);
  store.set(SEARCH_SESSION_KEY, "{not json");
  assert.equal(readSearchSession(storage), null);
});

// ---------------------------------------------------------------------------
// Derived rent estimates (display only; never a matching result)

const estimate = (over: Partial<RentEstimate> = {}): RentEstimate =>
  rentEstimateSchema.parse({
    modelVersion: RENT_ESTIMATE_MODEL_VERSION, method: "nearest_neighbors", comparableCount: 8, radiusKm: 5,
    medianAnnualPerSqFt: 30, p25AnnualPerSqFt: 24, p75AnnualPerSqFt: 36,
    monthly: { low: 2000, high: 3000 }, sizeBasis: "exact", sourceIds: ["costar-space:1"],
    datasetId: "synthetic-test", datasetDate: null, origin: "derived",
    generatedAt: "2026-11-15T00:00:00.000Z", notes: ["a", "b"], ...over,
  });

test("estimate labels are honest copy and null-safe without a size", () => {
  assert.equal(estimateCostLabel(estimate()), "≈ $2,000–$3,000/mo + building charges");
  assert.equal(estimateCostLabel(estimate({ monthly: { low: 2300, high: 3400 } }), true), "≈ $2.3k–$3.4k/mo + building charges");
  assert.equal(estimatePin(estimate()), "≈ $2k–$3k");
  const noSize = estimate({ monthly: null, sizeBasis: "unknown" });
  assert.equal(estimateCostLabel(noSize), "≈ $30/sq ft/yr (no size to price)");
  assert.equal(estimatePin(noSize), "≈ $30/sq ft");
});

test("displayOrder: listed rent stays ahead, estimates sort within no-rent, groups never cross", () => {
  const listed = assessed(space({ id: "listed-a" }), "needs_verification", [kitchenUnknown], 3);
  const noRentUnder = assessed(space({ id: "no-rent-under", rent: null }), "needs_verification", [kitchenUnknown], 1);
  const noRentOver = assessed(space({ id: "no-rent-over", rent: null }), "needs_verification", [kitchenUnknown], 2);
  const meets = assessed(space({ id: "meets-a" }), "meets_assessed_requirements", [costPass], 4);
  const fails = assessed(space({ id: "fails-a", rent: null }), "does_not_meet", [costFail], 5);
  const estimates = new Map<string, RentEstimate>([
    ["no-rent-under", estimate({ monthly: { low: 1000, high: 2000 } })],
    ["no-rent-over", estimate({ monthly: { low: 6000, high: 7000 } })],
  ]);
  const ordered = displayOrder([noRentOver, fails, listed, meets, noRentUnder], estimates, 5000);
  assert.deepEqual(ordered.map((x) => x.candidate.id), ["meets-a", "listed-a", "no-rent-under", "no-rent-over", "fails-a"]);
  // Friendly behavior for no-rent candidates is unchanged: still "Needs checking".
  assert.equal(friendlyReason("ambiguous_basis", requirements), "The asking rent isn’t listed");
  assert.equal(costLabel(monthlyCost(space({ id: "x", rent: null }))), "Rent not listed");
});
