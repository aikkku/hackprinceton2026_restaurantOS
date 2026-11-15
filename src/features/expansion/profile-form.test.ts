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
import { blankNeedsForm, basicsIssue, emptyBasics, ownerEnvelope, reviseFromForm } from "./frontend/sprout/profile.ts";

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

// --- New owner profiles (stored in the workspace, no example data) ---------

const basics = () => ({ ...emptyBasics(), name: "Lotus Noodle Bar", cuisine: "Vietnamese", currentCity: "Austin", currentState: "tx", funds: "150,000", reserve: "30,000" });
const ownerForm = () => ({ ...blankNeedsForm(basics()), occupancy: "7000", seatsMin: "30", seatsMax: "45", neighborhoods: "Midtown, Montrose", parking: false });

test("a new owner profile is a non-demo revision 0 whose requirements cite the owner's answers", () => {
  const result = ownerEnvelope(basics(), ownerForm(), "2026-11-15T00:00:00.000Z");
  assert.ok(result.ok);
  const revision = result.revision;
  assert.equal(revision.revisionNumber, 0);
  assert.equal(revision.parentRevisionId, null);
  assert.equal(revision.isDemo, false);
  assert.equal(result.envelope.revisions.length, 1);
  const intake = revision.intakeSnapshot;
  assert.equal(intake.origin, "owner_entered");
  assert.equal(intake.restaurant.name, "Lotus Noodle Bar");
  assert.equal(intake.restaurant.currentState, "TX");
  assert.equal(intake.budget.totalAvailableFunds, 150000);
  assert.equal(intake.budget.cashReserveToKeep, 30000);
  assert.equal(intake.space.mustHave.customerParking, false);
  assert.deepEqual(intake.expansion.preferredNeighborhoods, ["Midtown", "Montrose"]);
  assert.ok(!intake.followUpQuestions.some((item) => item.field === "budget.cashReserveToKeep"), "a given reserve is not asked again");
  const answerIds = new Set(intake.sourceAnswers.map((item) => item.id));
  for (const requirement of revision.requirements.requirements) {
    assert.notEqual(requirement.origin, "simulated", `${requirement.id} is never labeled simulated`);
    for (const id of requirement.sourceAnswerIds) assert.ok(answerIds.has(id), `${requirement.id} cites ${id}`);
  }
  const form = formFromRevision(revision);
  assert.equal(form.occupancy, "7000");
  assert.equal(form.seatsMax, "45");
});

test("owner profile edits become new revisions on top of the owner's revision 0", () => {
  const created = ownerEnvelope(basics(), ownerForm(), "2026-11-15T00:00:00.000Z");
  assert.ok(created.ok);
  const revised = reviseFromForm(created.envelope, { ...formFromRevision(created.revision), occupancy: "6500" }, "2026-11-15T00:05:00.000Z");
  assert.ok(revised.ok && revised.changed);
  assert.equal(revised.revision.revisionNumber, 1);
  assert.equal(revised.revision.parentRevisionId, created.revision.revisionId);
  assert.equal(revised.envelope.revisions[0].revisionId, created.revision.revisionId, "the profile id (revision 0) is unchanged");
});

test("new owner profiles reject missing basics, impossible money and unsupported markets", () => {
  assert.match(basicsIssue({ ...basics(), name: " " }) ?? "", /name/);
  assert.match(basicsIssue({ ...basics(), currentState: "Texas" }) ?? "", /two-letter/);
  assert.match(basicsIssue({ ...basics(), funds: "" }) ?? "", /money/);
  assert.match(basicsIssue({ ...basics(), reserve: "200,000" }) ?? "", /reserve/);
  assert.equal(basicsIssue(basics()), null);
  const noSeats = ownerEnvelope(basics(), { ...ownerForm(), seatsMin: "" });
  assert.ok(!noSeats.ok && /seat/.test(noSeats.message));
  const noRent = ownerEnvelope(basics(), { ...ownerForm(), occupancy: "" });
  assert.ok(!noRent.ok && /occupancy/.test(noRent.message));
  const la = ownerEnvelope(basics(), { ...ownerForm(), market: "US-CA-Los Angeles" });
  assert.ok(!la.ok && /not a supported market/.test(la.message));
});

test("buildEdits with no previous revision validates and returns every edit", () => {
  const { edits, issues } = buildEdits(ownerForm(), null);
  assert.deepEqual(issues, []);
  assert.ok(edits.some((edit) => edit.id === "occupancy.monthlyLimit"));
  assert.ok(edits.some((edit) => edit.id === "space.existingKitchen"));
});
