import assert from "node:assert/strict";
import test from "node:test";
import { latLngToCell } from "h3-js";
import { exampleIntake } from "./frontend/data/intake-example.ts";
import { normalizeRequirements, type SearchRequirements } from "./domain/requirements.ts";
import {
  assessCandidates,
  candidateSchema,
  evaluateCandidate,
  factSchema,
  groupFor,
  MATCHING_MODEL_VERSION,
  monthlyOccupancyRange,
  orderCandidates,
  serviceInclusion,
  type CandidateFact,
  type SpaceCandidate,
} from "./domain/matching.ts";

const requirements: SearchRequirements = normalizeRequirements(exampleIntake(), {
  revisionId: "revision-test",
  revisionNumber: 0,
  createdAt: "2026-11-14T18:00:00.000Z",
});

const base = {
  id: "costar-space:1",
  name: "Synthetic property 1 · Suite A",
  address: "1 Synthetic Street",
  suite: "A",
  cityId: "houston",
  latitude: 29.76,
  longitude: -95.36,
  h3Index: latLngToCell(29.76, -95.36, 8),
  floorAreaSqFt: 1000,
  sizeRangeSqFt: { minimum: 1000, maximum: 1000 },
  rent: {
    low: 4.5,
    high: 4.5,
    rateBasisCode: 1,
    currencyCode: 1,
    measurementCode: 1,
    serviceTypeCode: 13,
  },
  spaceUseCode: 5,
  listingStatusCode: 1,
  propertyId: "1",
  sourceIds: ["costar:property:1"],
  recordDate: null,
  datasetDate: null,
  isDemo: false,
} as const;

const candidate = (over: Record<string, unknown> = {}): SpaceCandidate =>
  candidateSchema.parse({ ...base, ...over });

function fact(
  id: string,
  field: CandidateFact["field"],
  value: CandidateFact["value"],
  entityId = "costar-space:1",
): CandidateFact {
  return factSchema.parse({
    id,
    entityScope: "space",
    entityId,
    field,
    value,
    unit: field === "seatCapacity" ? "seats" : field === "monthlyAdditionalCharges" ? "USD/month" : null,
    origin: "observed",
    source: { label: "Synthetic fixture source", recordId: null, capturedAt: "2026-11-01T00:00:00.000Z" },
    method: "synthetic test fixture",
    limitations: ["fixture only"],
    isDemo: false,
  });
}

const statusOf = (assessed: ReturnType<typeof evaluateCandidate>, requirementId: string) =>
  assessed.find((item) => item.requirementId === requirementId)!.status;

test("service inclusion mapping never guesses and distinguishes gross from net rents", () => {
  assert.equal(serviceInclusion(null), "unknown");
  assert.equal(serviceInclusion(7), "included"); // FullService
  assert.equal(serviceInclusion(9), "included"); // ModifiedGross
  assert.equal(serviceInclusion(13), "not_included"); // TripleNet
  assert.equal(serviceInclusion(10), "not_included"); // Net
  assert.equal(serviceInclusion(0), "unknown");
  assert.equal(serviceInclusion(15), "unknown"); // TenantElectric stays unknown
});

test("$4,500 base with unknown extras is unknown; with $700 extras it fails; $4,000 plus complete $800 extras passes", () => {
  // $4.50/SF/month × 1,000 SF = $4,500 base, triple-net (extras not included).
  const unknown = evaluateCandidate(candidate(), requirements, []);
  assert.equal(statusOf(unknown, "occupancy.monthlyLimit"), "unknown");
  const unknownAssessment = unknown.find((a) => a.requirementId === "occupancy.monthlyLimit")!;
  assert.equal(unknownAssessment.reasonCode, "missing_charges");
  assert.match(unknownAssessment.reason, /additional occupancy charges are unknown/);

  const failed = evaluateCandidate(
    candidate(),
    requirements,
    [fact("f-extras", "monthlyAdditionalCharges", { kind: "exact", value: 700 })],
  );
  assert.equal(statusOf(failed, "occupancy.monthlyLimit"), "fail");
  assert.equal(failed.find((a) => a.requirementId === "occupancy.monthlyLimit")!.reasonCode, "exceeds_cap");

  const passed = evaluateCandidate(
    candidate({ rent: { ...base.rent, low: 4, high: 4 } }),
    requirements,
    [fact("f-extras-2", "monthlyAdditionalCharges", { kind: "exact", value: 800 })],
  );
  assert.equal(statusOf(passed, "occupancy.monthlyLimit"), "pass");
  assert.equal(passed.find((a) => a.requirementId === "occupancy.monthlyLimit")!.reasonCode, "below_cap");
});

test("included service charges are never added twice", () => {
  // FullService rent of $4,500 already includes additional charges.
  const fullService = candidate({ rent: { ...base.rent, serviceTypeCode: 7 } });
  const assessed = evaluateCandidate(
    fullService,
    requirements,
    [fact("f-extras", "monthlyAdditionalCharges", { kind: "exact", value: 700 })],
  );
  const occupancy = assessed.find((a) => a.requirementId === "occupancy.monthlyLimit")!;
  assert.equal(occupancy.status, "pass");
  assert.match(occupancy.reason, /upper bound of \$4500/);
});

test("ranged quotes crossing the cap are unknown; supported lower bounds above the cap fail", () => {
  const crossing = candidate({ rent: { ...base.rent, low: 4, high: 6, serviceTypeCode: 7 } });
  const crossAssessment = evaluateCandidate(crossing, requirements, []).find(
    (a) => a.requirementId === "occupancy.monthlyLimit",
  )!;
  assert.equal(crossAssessment.status, "unknown");
  assert.equal(crossAssessment.reasonCode, "range_crosses_cap");

  const tooHigh = candidate({ rent: { ...base.rent, low: 5.5, high: 5.5 } });
  const highAssessment = evaluateCandidate(tooHigh, requirements, []).find(
    (a) => a.requirementId === "occupancy.monthlyLimit",
  )!;
  assert.equal(highAssessment.status, "fail");

  const upperOk = candidate({ rent: { ...base.rent, low: 3, high: 4.5, serviceTypeCode: 7 } });
  const passAssessment = evaluateCandidate(upperOk, requirements, []).find(
    (a) => a.requirementId === "occupancy.monthlyLimit",
  )!;
  assert.equal(passAssessment.status, "pass");
  assert.match(passAssessment.reason, /upper bound of \$4500/);
});

test("unsupported units and unknown rent periods stay unknown rather than coerced", () => {
  const euros = evaluateCandidate(
    candidate({ rent: { ...base.rent, currencyCode: 2 } }),
    requirements,
    [],
  );
  assert.equal(statusOf(euros, "occupancy.monthlyLimit"), "unknown");
  assert.equal(euros.find((a) => a.requirementId === "occupancy.monthlyLimit")!.reasonCode, "unsupported_units");

  const noBasis = evaluateCandidate(
    candidate({ rent: { ...base.rent, rateBasisCode: 0 } }),
    requirements,
    [],
  );
  assert.equal(noBasis.find((a) => a.requirementId === "occupancy.monthlyLimit")!.reasonCode, "ambiguous_basis");

  const noRent = evaluateCandidate(candidate({ rent: null }), requirements, []);
  assert.equal(noRent.find((a) => a.requirementId === "occupancy.monthlyLimit")!.reasonCode, "ambiguous_basis");
});

test("monthly occupancy normalization handles exact areas and ranged sizes", () => {
  const exact = monthlyOccupancyRange(candidate({ rent: { ...base.rent, serviceTypeCode: 7 } }), null, "included");
  assert.ok("known" in exact);
  if ("known" in exact) {
    assert.equal(exact.known.low, 4500);
    assert.equal(exact.known.high, 4500);
  }
  // Unknown nonincluded extras keep the upper bound unknown, never invented.
  const unknownExtras = monthlyOccupancyRange(candidate(), null, "not_included");
  assert.ok("known" in unknownExtras);
  if ("known" in unknownExtras) {
    assert.equal(unknownExtras.known.low, 4500);
    assert.equal(unknownExtras.known.high, null);
  }
  const ranged = monthlyOccupancyRange(
    candidate({
      floorAreaSqFt: null,
      sizeRangeSqFt: { minimum: 800, maximum: 1200 },
      rent: { ...base.rent, low: 2, high: 3, rateBasisCode: 2, serviceTypeCode: 7 },
    }),
    null,
    "included",
  );
  assert.ok("known" in ranged);
  if ("known" in ranged) {
    assert.ok(Math.abs(ranged.known.low - (2 * 800) / 12) < 1e-9);
    assert.ok(Math.abs(ranged.known.high! - (3 * 1200) / 12) < 1e-9);
  }
});

test("kitchen evidence: verified pass, verified absent fail, building note and nothing are unknown", () => {
  assert.equal(
    statusOf(evaluateCandidate(candidate(), requirements, [fact("f-k", "existingKitchen", { kind: "exact", value: "verified_present" })]), "space.existingKitchen"),
    "pass",
  );
  assert.equal(
    statusOf(evaluateCandidate(candidate(), requirements, [fact("f-k", "existingKitchen", { kind: "exact", value: "verified_absent" })]), "space.existingKitchen"),
    "fail",
  );
  for (const value of ["building_note", null]) {
    const facts = value ? [fact("f-k", "existingKitchen", { kind: "exact", value } as CandidateFact["value"])] : [];
    assert.equal(statusOf(evaluateCandidate(candidate(), requirements, facts), "space.existingKitchen"), "unknown");
  }
});

test("parking rights: verified pass, verified absent fail, nearby visible stalls stay unknown", () => {
  assert.equal(
    statusOf(evaluateCandidate(candidate(), requirements, [fact("f-p", "customerParking", { kind: "exact", value: "verified_customer_parking" })]), "space.customerParking"),
    "pass",
  );
  assert.equal(
    statusOf(evaluateCandidate(candidate(), requirements, [fact("f-p", "customerParking", { kind: "exact", value: "verified_absent" })]), "space.customerParking"),
    "fail",
  );
  assert.equal(statusOf(evaluateCandidate(candidate(), requirements, []), "space.customerParking"), "unknown");
});

test("seat capacity is a soft preference: aligned passes, mismatch is reported, never a hard rejection", () => {
  const aligned = evaluateCandidate(
    candidate(),
    requirements,
    [fact("f-s", "seatCapacity", { kind: "exact", value: 45 })],
  );
  assert.equal(statusOf(aligned, "space.seats"), "pass");
  assert.equal(aligned.find((a) => a.requirementId === "space.seats")!.reasonCode, "capacity_aligned");

  const mismatched = evaluateCandidate(
    candidate(),
    requirements,
    [fact("f-s", "seatCapacity", { kind: "exact", value: 12 })],
  );
  const seatAssessment = mismatched.find((a) => a.requirementId === "space.seats")!;
  assert.equal(seatAssessment.status, "unknown");
  assert.equal(seatAssessment.reasonCode, "capacity_mismatch");
  // A capacity mismatch must not change the hard group by itself.
  const withPasses = evaluateCandidate(
    candidate({ rent: { ...base.rent, serviceTypeCode: 7 } }),
    requirements,
    [
      fact("f-k", "existingKitchen", { kind: "exact", value: "verified_present" }),
      fact("f-p", "customerParking", { kind: "exact", value: "verified_customer_parking" }),
      fact("f-s", "seatCapacity", { kind: "exact", value: 12 }),
    ],
  );
  assert.equal(groupFor(withPasses), "meets_assessed_requirements");
});

test("neighborhood preference stays soft: Heights passes, other Houston stays eligible, unknown is unresolved", () => {
  assert.equal(
    statusOf(evaluateCandidate(candidate(), requirements, [fact("f-n", "neighborhood", { kind: "exact", value: "Heights" })]), "market.neighborhoodPreference"),
    "pass",
  );
  const other = evaluateCandidate(
    candidate(),
    requirements,
    [fact("f-n", "neighborhood", { kind: "exact", value: "Montrose" })],
  );
  const otherAssessment = other.find((a) => a.requirementId === "market.neighborhoodPreference")!;
  assert.equal(otherAssessment.status, "unknown");
  assert.equal(otherAssessment.reasonCode, "neighborhood_other");
  assert.match(otherAssessment.reason, /remains eligible/);
  assert.equal(statusOf(evaluateCandidate(candidate(), requirements, []), "market.neighborhoodPreference"), "unknown");
});

test("grouping: any hard failure rejects, any hard unknown needs verification, otherwise meets", () => {
  const verifiedPass = evaluateCandidate(
    candidate({ rent: { ...base.rent, serviceTypeCode: 7 } }),
    requirements,
    [
      fact("f-k", "existingKitchen", { kind: "exact", value: "verified_present" }),
      fact("f-p", "customerParking", { kind: "exact", value: "verified_customer_parking" }),
    ],
  );
  assert.equal(groupFor(verifiedPass), "meets_assessed_requirements");

  const noFacts = evaluateCandidate(candidate(), requirements, []);
  assert.equal(groupFor(noFacts), "needs_verification");

  const kitchenAbsent = evaluateCandidate(
    candidate(),
    requirements,
    [fact("f-k", "existingKitchen", { kind: "exact", value: "verified_absent" })],
  );
  assert.equal(groupFor(kitchenAbsent), "does_not_meet");
});

test("deterministic ordering follows group, evidence completeness, neighborhood, cost and stable id", () => {
  const verified = (id: string, rentLow: number) =>
    candidate({
      id: `costar-space:${id}`,
      h3Index: latLngToCell(29.76 + Number(id) * 0.001, -95.36, 8),
      latitude: 29.76 + Number(id) * 0.001,
      rent: { ...base.rent, low: rentLow, high: rentLow, serviceTypeCode: 7 },
    });
  const passFacts = (entityId: string, neighborhood?: string) => [
    fact(`k-${entityId}`, "existingKitchen", { kind: "exact", value: "verified_present" }, entityId),
    fact(`p-${entityId}`, "customerParking", { kind: "exact", value: "verified_customer_parking" }, entityId),
    ...(neighborhood ? [fact(`n-${entityId}`, "neighborhood", { kind: "exact", value: neighborhood }, entityId)] : []),
  ];
  const a = verified("10", 4);
  const b = verified("20", 3); // cheaper, but no neighborhood preference
  const c = verified("30", 2);
  const d = verified("40", 5);
  const report = assessCandidates(
    [c, a, d, b],
    requirements,
    [
      ...passFacts(c.id),
      ...passFacts(a.id, "Heights"),
      ...passFacts(d.id),
      ...passFacts(b.id),
    ],
  );
  const ids = report.candidates.map((item) => item.candidate.id);
  // All meet; Heights first, then known cost ascending, stable id tie-break.
  assert.deepEqual(ids, ["costar-space:10", "costar-space:30", "costar-space:20", "costar-space:40"]);
  assert.equal(report.counts.meets, 4);
  assert.equal(report.modelVersion, MATCHING_MODEL_VERSION);
  assert.ok(report.candidates.every((item) => item.rank > 0));
  assert.ok(report.candidates.every((item) => item.orderingNotes.length >= 3));
  // Deterministic: the same input produces the same output.
  const again = assessCandidates(
    [c, a, d, b],
    requirements,
    [...passFacts(c.id), ...passFacts(a.id, "Heights"), ...passFacts(d.id), ...passFacts(b.id)],
  );
  assert.deepEqual(again, report);
});

test("ordering separates groups before any other signal", () => {
  const needs = evaluateCandidate(candidate(), requirements, []);
  const rejected = evaluateCandidate(
    candidate({ id: "costar-space:2" }),
    requirements,
    [fact("f-k2", "existingKitchen", { kind: "exact", value: "verified_absent" }, "costar-space:2")],
  );
  const meets = evaluateCandidate(
    candidate({ id: "costar-space:3", rent: { ...base.rent, low: 4.8, high: 4.8, serviceTypeCode: 7 } }),
    requirements,
    [
      fact("f-k3", "existingKitchen", { kind: "exact", value: "verified_present" }, "costar-space:3"),
      fact("f-p3", "customerParking", { kind: "exact", value: "verified_customer_parking" }, "costar-space:3"),
    ],
  );
  const ordered = orderCandidates([
    { candidate: candidateSchema.parse(candidate({ id: "costar-space:1" })), assessments: needs, group: groupFor(needs), rank: 0, orderingNotes: [] },
    { candidate: candidateSchema.parse(candidate({ id: "costar-space:2" })), assessments: rejected, group: groupFor(rejected), rank: 0, orderingNotes: [] },
    { candidate: candidateSchema.parse(candidate({ id: "costar-space:3" })), assessments: meets, group: groupFor(meets), rank: 0, orderingNotes: [] },
  ]);
  assert.deepEqual(
    ordered.map((item) => item.group),
    ["meets_assessed_requirements", "needs_verification", "does_not_meet"],
  );
});

test("assessCandidates counts unknown-use candidates separately and preserves soft seats mismatch", () => {
  const report = assessCandidates(
    [candidate({ spaceUseCode: 0 }), candidate({ id: "costar-space:2", spaceUseCode: null })],
    requirements,
    [],
  );
  assert.equal(report.counts.useUnknown, 2);
  assert.equal(report.counts.examined, 2);
  assert.equal(report.counts.needsVerification, 2);
});
