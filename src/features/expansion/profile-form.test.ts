import assert from "node:assert/strict";
import test from "node:test";
import { exampleIntake } from "./frontend/data/intake-example.ts";
import { createProfileRevision } from "./domain/requirements.ts";
import {
  buildEdits,
  changedSummary,
  formFromRevision,
  requirementToField,
} from "./frontend/profile-form.ts";

const seed = () =>
  createProfileRevision(
    exampleIntake(),
    {
      revisionId: "form-revision-0",
      revisionNumber: 0,
      createdAt: "2026-11-14T18:00:00.000Z",
      parentRevisionId: null,
      editSummary: "Imported the example restaurant profile.",
    },
    [],
  );

test("profile form derives example values from a revision without inventing unknowns", () => {
  const form = formFromRevision(seed());
  assert.equal(form.occupancy, "5000");
  assert.equal(form.funds, "100000");
  assert.equal(form.reserve, "");
  assert.equal(form.seatsMin, "40");
  assert.equal(form.seatsMax, "50");
  assert.equal(form.kitchen, true);
  assert.equal(form.parking, true);
  assert.equal(form.neighborhoods, "Heights");
  assert.equal(form.othersAcceptable, true);
  assert.equal(form.market, "US-TX-Houston");
  assert.equal(form.ventilation, "");
  assert.equal(form.baselineNote, "");
});

test("profile form restores edited values including follow-up answers", () => {
  const base = seed();
  const edited = createProfileRevision(
    base.intakeSnapshot,
    {
      revisionId: "form-revision-1",
      revisionNumber: 1,
      createdAt: "2026-11-14T19:00:00.000Z",
      parentRevisionId: base.revisionId,
      editSummary: "Owner edit.",
    },
    [
      { id: "occupancy.monthlyLimit", value: 4300 },
      { id: "funds.emergencyReserve", value: 20000 },
      { id: "space.seats", value: { minimum: 35, maximum: 45 } },
      { id: "space.ventilation", value: "gas range and hood" },
      { id: "market.neighborhoodPreference", value: { preferred: ["Heights", "Montrose"], othersAcceptable: false } },
    ],
    {
      cashReserveToKeep: 20000,
      ventilationRequirements: "gas range and hood",
      financialBaselineNote: "shared April 2026 sales report",
    },
  );
  const form = formFromRevision(edited);
  assert.equal(form.occupancy, "4300");
  assert.equal(form.reserve, "20000");
  assert.equal(form.seatsMin, "35");
  assert.equal(form.seatsMax, "45");
  assert.equal(form.neighborhoods, "Heights, Montrose");
  assert.equal(form.othersAcceptable, false);
  assert.equal(form.ventilation, "gas range and hood");
  assert.equal(form.baselineNote, "shared April 2026 sales report");
});

test("profile form builds complete requirement edits at the schema boundary", () => {
  const base = seed();
  const { edits, issues } = buildEdits(
    {
      occupancy: "4500",
      funds: "100000",
      reserve: "",
      seatsMin: "40",
      seatsMax: "50",
      kitchen: true,
      parking: false,
      neighborhoods: "Heights, Montrose",
      othersAcceptable: true,
      market: "US-TX-Houston",
      ventilation: "",
      baselineNote: "",
    },
    base,
  );
  assert.deepEqual(issues, []);
  const byId = new Map(edits.map((edit) => [edit.id, edit.value]));
  assert.equal(byId.get("occupancy.monthlyLimit"), 4500);
  assert.equal(byId.get("funds.totalAvailable"), undefined);
  assert.equal(byId.get("funds.emergencyReserve"), undefined);
  assert.equal(byId.get("space.seats"), undefined);
  assert.equal(byId.get("space.existingKitchen"), undefined);
  assert.equal(byId.get("space.customerParking"), false);
  assert.deepEqual(byId.get("market.neighborhoodPreference"), {
    preferred: ["Heights", "Montrose"],
    othersAcceptable: true,
  });
  assert.equal(byId.get("market.target"), undefined);
  assert.equal(byId.get("space.ventilation"), undefined);
});

test("profile form emits no edits when nothing changed", () => {
  const base = seed();
  const { edits, issues } = buildEdits(formFromRevision(base), base);
  assert.deepEqual(edits, []);
  assert.deepEqual(issues, []);
});

test("profile form surfaces field-level issues for invalid input", () => {
  const base = seed();
  const { edits, issues } = buildEdits(
    {
      occupancy: "",
      funds: "-100",
      reserve: "abc",
      seatsMin: "60",
      seatsMax: "40",
      kitchen: true,
      parking: true,
      neighborhoods: "  ",
      othersAcceptable: true,
      market: "US-CA-Los Angeles",
      ventilation: "",
      baselineNote: "",
    },
    base,
  );
  const fields = new Map(issues.map((issue) => [issue.field, issue.message]));
  assert.match(fields.get("occupancy")!, /Enter a monthly occupancy limit/);
  assert.match(fields.get("funds")!, /nonnegative/);
  assert.match(fields.get("reserve")!, /nonnegative/);
  assert.match(fields.get("seatsMin")!, /cannot exceed/);
  assert.match(fields.get("neighborhoods")!, /at least one preferred neighborhood/);
  assert.ok(!edits.some((edit) => edit.id === "occupancy.monthlyLimit"));
  assert.ok(!edits.some((edit) => edit.id === "funds.totalAvailable"));
  assert.ok(!edits.some((edit) => edit.id === "space.seats"));
  // The unsupported market is a valid edit shape; the revision boundary rejects it.
  const marketEdit = edits.find((edit) => edit.id === "market.target");
  assert.deepEqual(marketEdit, {
    id: "market.target",
    value: { city: "Los Angeles", state: "CA", country: "US" },
  });
});

test("profile form maps requirement ids to fields and summarizes changes", () => {
  assert.equal(requirementToField("occupancy.monthlyLimit"), "occupancy");
  assert.equal(requirementToField("funds.totalAvailable"), "funds");
  assert.equal(requirementToField("funds.emergencyReserve"), "reserve");
  assert.equal(requirementToField("space.seats"), "seatsMin");
  assert.equal(requirementToField("market.neighborhoodPreference"), "neighborhoods");
  assert.equal(requirementToField("market.target"), "market");
  assert.equal(requirementToField("space.ventilation"), "ventilation");
  const base = seed();
  assert.equal(
    changedSummary([{ id: "occupancy.monthlyLimit", value: 4300 }], base),
    "Owner edit: Total monthly occupancy limit.",
  );
  assert.equal(changedSummary([], base), "Owner edit (no requirement changes).");
});
