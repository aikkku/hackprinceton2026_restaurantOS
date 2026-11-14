import assert from "node:assert/strict";
import test from "node:test";
import example from "../../../docs/expansion/examples/restaurant-intake.sample.json" with { type: "json" };
import {
  INTAKE_SCHEMA_VERSION,
  intakeSchema,
  parseIntake,
} from "./domain/intake.ts";
import {
  createProfileRevision,
  normalizeRequirements,
  ProfileValidationError,
  REQUIREMENT_IDS,
  REQUIREMENTS_MODEL_VERSION,
  UnsupportedProfileError,
  validateRequirements,
} from "./domain/requirements.ts";
import {
  decodeProfileDraft,
  LOCAL_STORAGE_KEY,
  MODE_STORAGE_KEY,
  persistProfileDraft,
  PROFILE_DRAFT_STORAGE_KEY,
  profileDraftEnvelopeSchema,
  resetProfileDraft,
  STORAGE_KEY,
  type ProfileDraftEnvelope,
} from "./frontend/storage.ts";

const meta = {
  revisionId: "revision-0",
  revisionNumber: 0,
  createdAt: "2026-11-14T18:00:00.000Z",
};

function revisionStore() {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    },
  };
}

function exampleEnvelope(edits: Parameters<typeof createProfileRevision>[2] = []) {
  const revision = createProfileRevision(
    parseIntake(example),
    {
      ...meta,
      parentRevisionId: null,
      editSummary: "Imported the example restaurant profile.",
    },
    edits,
  );
  return profileDraftEnvelopeSchema.parse({
    schemaVersion: 1,
    updatedAt: meta.createdAt,
    revisions: [revision],
  });
}

// ---------------------------------------------------------------------------
// Intake schema

test("Expansion intake sample round-trips with all nulls and provenance retained", () => {
  const parsed = parseIntake(example);
  assert.deepEqual(parsed, example);
  assert.equal(parsed.schemaVersion, INTAKE_SCHEMA_VERSION);
  assert.equal(parsed.isDemo, true);
  assert.equal(parsed.origin, "simulated");
  assert.equal(parsed.budget.cashReserveToKeep, null);
  assert.equal(parsed.budget.maximumUpfrontSpending, null);
  assert.equal(parsed.expansion.targetOpeningDate, null);
  assert.equal(parsed.space.minimumCustomerParkingSpaces, null);
  assert.equal(parsed.space.ventilationRequirements, null);
  assert.equal(parsed.space.areaSqFt.minimum, null);
  assert.equal(parsed.space.areaSqFt.maximum, null);
  assert.equal(parsed.financialBaseline.origin, "unavailable");
  assert.equal(parsed.financialBaseline.netSales, null);
  assert.equal(parsed.sourceAnswers.length, 7);
  assert.equal(parsed.followUpQuestions.length, 3);
  assert.deepEqual(parsed.budget.sourceAnswerIds, [
    "answer_2",
    "answer_3",
    "answer_6",
  ]);
});

test("Expansion intake rejects dangling and duplicate source answer references", () => {
  const dangling = structuredClone(example) as unknown as ReturnType<typeof parseIntake>;
  dangling.restaurant.sourceAnswerIds = [...dangling.restaurant.sourceAnswerIds, "answer_99"];
  assert.equal(intakeSchema.safeParse(dangling).success, false);
  const duplicate = structuredClone(example) as unknown as ReturnType<typeof parseIntake>;
  duplicate.budget.sourceAnswerIds = ["answer_2", "answer_2"];
  assert.equal(intakeSchema.safeParse(duplicate).success, false);
  const duplicateAnswers = structuredClone(example) as unknown as ReturnType<typeof parseIntake>;
  duplicateAnswers.sourceAnswers = [...duplicateAnswers.sourceAnswers, { ...duplicateAnswers.sourceAnswers[0] }];
  assert.equal(intakeSchema.safeParse(duplicateAnswers).success, false);
});

test("Expansion intake rejects reversed ranges, negative money and contradictory reserve/funds", () => {
  const reversedSeats = structuredClone(example) as unknown as ReturnType<typeof parseIntake>;
  reversedSeats.space.preferredSeats = { minimum: 50, maximum: 40, isHardRequirement: false };
  assert.equal(intakeSchema.safeParse(reversedSeats).success, false);

  const negativeFunds = structuredClone(example) as unknown as ReturnType<typeof parseIntake>;
  negativeFunds.budget.totalAvailableFunds = -1;
  assert.equal(intakeSchema.safeParse(negativeFunds).success, false);

  const negativeLimit = structuredClone(example) as unknown as ReturnType<typeof parseIntake>;
  negativeLimit.budget.maximumMonthlyOccupancyCost = -5000;
  assert.equal(intakeSchema.safeParse(negativeLimit).success, false);

  const oversizedReserve = structuredClone(example) as unknown as ReturnType<typeof parseIntake>;
  oversizedReserve.budget.cashReserveToKeep = 150000;
  assert.equal(intakeSchema.safeParse(oversizedReserve).success, false);

  const contradictorySpend = structuredClone(example) as unknown as ReturnType<typeof parseIntake>;
  contradictorySpend.budget.cashReserveToKeep = 60000;
  contradictorySpend.budget.maximumUpfrontSpending = 50000;
  assert.equal(intakeSchema.safeParse(contradictorySpend).success, false);
});

test("Expansion intake rejects reversed seat ranges at the section boundary", () => {
  const reversed = structuredClone(example) as unknown as ReturnType<typeof parseIntake>;
  reversed.space.preferredSeats = { minimum: 60, maximum: 55, isHardRequirement: true };
  assert.equal(intakeSchema.safeParse(reversed).success, false);
});

// ---------------------------------------------------------------------------
// Requirements normalization

test("Expansion normalization produces stable, typed requirements with source references", () => {
  const requirements = normalizeRequirements(parseIntake(example), meta);
  assert.equal(requirements.modelVersion, REQUIREMENTS_MODEL_VERSION);
  assert.equal(requirements.revisionId, meta.revisionId);
  assert.equal(requirements.revisionNumber, 0);
  assert.deepEqual(
    requirements.requirements.map((item) => item.id),
    REQUIREMENT_IDS,
  );
  const byId = new Map(requirements.requirements.map((item) => [item.id, item]));
  const cap = byId.get("occupancy.monthlyLimit")!;
  assert.equal(cap.kind, "hard");
  assert.deepEqual(cap.value, { kind: "number", value: 5000 });
  assert.equal(cap.unit, "USD/month");
  assert.deepEqual(cap.sourceAnswerIds, ["answer_2", "answer_3", "answer_6"]);
  assert.deepEqual(cap.originalSourceAnswerIds, cap.sourceAnswerIds);

  const seats = byId.get("space.seats")!;
  assert.equal(seats.kind, "soft");
  assert.deepEqual(seats.value, { kind: "range", minimum: 40, maximum: 50 });
  assert.equal(seats.unit, "seats");
  assert.deepEqual(seats.sourceAnswerIds, ["answer_4", "answer_5"]);

  const area = byId.get("space.areaSqFt")!;
  assert.deepEqual(area.value, { kind: "unknown" });
  assert.equal(area.state, "unknown");

  const kitchen = byId.get("space.existingKitchen")!;
  assert.equal(kitchen.kind, "hard");
  assert.deepEqual(kitchen.value, { kind: "boolean", value: true });
  const parking = byId.get("space.customerParking")!;
  assert.equal(parking.kind, "hard");
  assert.deepEqual(parking.value, { kind: "boolean", value: true });

  const neighborhood = byId.get("market.neighborhoodPreference")!;
  assert.deepEqual(neighborhood.value, {
    kind: "neighborhood",
    preferred: ["Heights"],
    othersAcceptable: true,
  });

  const market = byId.get("market.target")!;
  assert.deepEqual(market.value, {
    kind: "market",
    market: { city: "Houston", state: "TX", country: "US" },
  });
});

test("Expansion normalization keeps unknown values unknown instead of inventing numbers", () => {
  const byId = new Map(
    normalizeRequirements(parseIntake(example), meta).requirements.map(
      (item) => [item.id, item],
    ),
  );
  assert.deepEqual(byId.get("funds.emergencyReserve")!.value, { kind: "unknown" });
  assert.deepEqual(byId.get("space.parkingSpacesMinimum")!.value, { kind: "unknown" });
  assert.deepEqual(byId.get("space.ventilation")!.value, { kind: "unknown" });
  assert.deepEqual(byId.get("timeline.openingDate")!.value, { kind: "unknown" });
  assert.deepEqual(byId.get("finance.baseline")!.value, { kind: "unknown" });
  // Seats stay seats; no square-footage bound is derived.
  const area = byId.get("space.areaSqFt")!;
  assert.equal(area.value.kind, "unknown");
  assert.equal(area.note.includes("square-footage"), true);
  // Parking stays a yes/no must-have; no numeric minimum appears.
  assert.deepEqual(byId.get("space.customerParking")!.value, { kind: "boolean", value: true });
  assert.equal(
    byId.get("space.customerParking")!.note.includes("numeric"),
    false,
  );
});

test("Expansion normalization rejects unsupported currencies and markets explicitly", () => {
  const euros = structuredClone(example) as unknown as ReturnType<typeof parseIntake>;
  euros.budget.currency = "EUR";
  assert.throws(
    () => normalizeRequirements(euros, meta),
    (error: unknown) =>
      error instanceof UnsupportedProfileError &&
      error.code === "unsupported_currency" &&
      error.message.includes("EUR"),
  );
  const austin = structuredClone(example) as unknown as ReturnType<typeof parseIntake>;
  austin.expansion.targetCity = "Austin";
  assert.throws(
    () => normalizeRequirements(austin, meta),
    (error: unknown) =>
      error instanceof UnsupportedProfileError &&
      error.code === "unsupported_market" &&
      error.message.includes("Austin"),
  );
});

// ---------------------------------------------------------------------------
// Revisions

test("Expansion edits create a new immutable revision and preserve the original interview", () => {
  const original = createProfileRevision(
    parseIntake(example),
    { ...meta, parentRevisionId: null, editSummary: "Imported the example restaurant profile." },
    [],
  );
  const snapshotBefore = structuredClone(original);
  const edited = createProfileRevision(
    original.intakeSnapshot,
    {
      revisionId: "revision-1",
      revisionNumber: 1,
      createdAt: "2026-11-14T19:00:00.000Z",
      parentRevisionId: original.revisionId,
      editSummary: "Owner edit: Total monthly occupancy limit, Preferred seats.",
    },
    [
      { id: "occupancy.monthlyLimit", value: 6500 },
      { id: "space.seats", value: { minimum: 35, maximum: 45 } },
    ],
  );
  assert.equal(edited.revisionNumber, 1);
  assert.equal(edited.parentRevisionId, original.revisionId);
  assert.equal(Object.isFrozen(edited), true);
  // Old revision and its answers are unchanged.
  assert.deepEqual(original, snapshotBefore);
  assert.deepEqual(edited.intakeSnapshot, original.intakeSnapshot);
  assert.equal(
    edited.intakeSnapshot.sourceAnswers[0].answer,
    original.intakeSnapshot.sourceAnswers[0].answer,
  );
  const byId = new Map(
    edited.requirements.requirements.map((item) => [item.id, item]),
  );
  const cap = byId.get("occupancy.monthlyLimit")!;
  assert.deepEqual(cap.value, { kind: "number", value: 6500 });
  assert.equal(cap.origin, "assumed");
  assert.deepEqual(cap.sourceAnswerIds, []);
  assert.deepEqual(cap.originalSourceAnswerIds, ["answer_2", "answer_3", "answer_6"]);
  assert.equal(cap.editedAt, "2026-11-14T19:00:00.000Z");
  const seats = byId.get("space.seats")!;
  assert.deepEqual(seats.value, { kind: "range", minimum: 35, maximum: 45 });
  assert.equal(seats.origin, "assumed");
  // Untouched requirements keep their interview origin.
  assert.equal(byId.get("space.existingKitchen")!.origin, "simulated");
});

test("Expansion revisions reject contradictory cross-field edits at the same boundary", () => {
  const original = createProfileRevision(parseIntake(example), { ...meta, parentRevisionId: null, editSummary: "seed" }, []);
  assert.throws(
    () =>
      createProfileRevision(
        original.intakeSnapshot,
        {
          revisionId: "revision-bad",
          revisionNumber: 1,
          createdAt: meta.createdAt,
          parentRevisionId: original.revisionId,
          editSummary: "bad edit",
        },
        [{ id: "funds.emergencyReserve", value: 150000 }],
      ),
    (error: unknown) =>
      error instanceof ProfileValidationError &&
      error.issues.some((issue) => issue.requirementId === "funds.emergencyReserve"),
  );
  assert.throws(() =>
    createProfileRevision(
      original.intakeSnapshot,
      {
        revisionId: "revision-bad-2",
        revisionNumber: 1,
        createdAt: meta.createdAt,
        parentRevisionId: original.revisionId,
        editSummary: "bad seats",
      },
      [{ id: "space.seats", value: { minimum: 60, maximum: 40 } }],
    ),
  );
  assert.throws(
    () =>
      createProfileRevision(
        original.intakeSnapshot,
        {
          revisionId: "revision-bad-3",
          revisionNumber: 1,
          createdAt: meta.createdAt,
          parentRevisionId: original.revisionId,
          editSummary: "unsupported market",
        },
        [
          {
            id: "market.target",
            value: { city: "Los Angeles", state: "CA", country: "US" },
          },
        ],
      ),
    (error: unknown) =>
      error instanceof ProfileValidationError &&
      error.issues.some((issue) => issue.requirementId === "market.target"),
  );
});

test("Expansion validateRequirements reports cross-field issues without throwing", () => {
  const revision = createProfileRevision(parseIntake(example), { ...meta, parentRevisionId: null, editSummary: "seed" }, []);
  const requirements = revision.requirements.requirements.map((item) =>
    item.id === "funds.emergencyReserve"
      ? { ...item, value: { kind: "number" as const, value: 999999 } }
      : item,
  );
  const issues = validateRequirements(requirements);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].requirementId, "funds.emergencyReserve");
  assert.ok(issues[0].message.includes("exceed"));
});

// ---------------------------------------------------------------------------
// Storage

test("Expansion profile drafts round-trip through storage and restore the current revision", () => {
  const { map, storage } = revisionStore();
  const envelope = exampleEnvelope();
  persistProfileDraft(storage, envelope);
  assert.deepEqual([...map.keys()], [PROFILE_DRAFT_STORAGE_KEY]);
  const decoded = decodeProfileDraft(storage.getItem(PROFILE_DRAFT_STORAGE_KEY));
  assert.equal(decoded.status, "ok");
  if (decoded.status !== "ok") return;
  assert.deepEqual(decoded.envelope, envelope);
  assert.equal(decoded.envelope.revisions[0].revisionNumber, 0);
});

test("Expansion profile storage preserves corrupt and unsupported content until explicit reset", () => {
  const { map, storage } = revisionStore();
  map.set(PROFILE_DRAFT_STORAGE_KEY, "{bad");
  let decoded = decodeProfileDraft(storage.getItem(PROFILE_DRAFT_STORAGE_KEY));
  assert.deepEqual(
    { status: decoded.status, raw: decoded.status === "corrupt" ? decoded.raw : null },
    { status: "corrupt", raw: "{bad" },
  );
  assert.equal(storage.getItem(PROFILE_DRAFT_STORAGE_KEY), "{bad");

  map.set(PROFILE_DRAFT_STORAGE_KEY, JSON.stringify({ schemaVersion: 2, revisions: [] }));
  decoded = decodeProfileDraft(storage.getItem(PROFILE_DRAFT_STORAGE_KEY));
  assert.equal(decoded.status, "unsupported");
  if (decoded.status !== "unsupported") return;
  assert.equal(decoded.schemaVersion, 2);
  assert.equal(storage.getItem(PROFILE_DRAFT_STORAGE_KEY), JSON.stringify({ schemaVersion: 2, revisions: [] }));

  map.set(PROFILE_DRAFT_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, revisions: [] }));
  decoded = decodeProfileDraft(storage.getItem(PROFILE_DRAFT_STORAGE_KEY));
  assert.equal(decoded.status, "corrupt");

  resetProfileDraft(storage);
  assert.equal(storage.getItem(PROFILE_DRAFT_STORAGE_KEY), null);
  assert.equal(decodeProfileDraft(null).status, "empty");
});

test("Expansion profile envelope rejects broken revision chains and duplicate content", () => {
  const envelope = exampleEnvelope();
  const broken = {
    ...envelope,
    revisions: [
      { ...envelope.revisions[0], revisionNumber: 0 },
      { ...envelope.revisions[0], revisionNumber: 2 },
    ],
  };
  assert.equal(profileDraftEnvelopeSchema.safeParse(broken).success, false);
  const brokenParent = {
    ...envelope,
    revisions: [
      envelope.revisions[0],
      { ...envelope.revisions[0], revisionNumber: 1, parentRevisionId: "not-the-previous" },
    ],
  };
  assert.equal(profileDraftEnvelopeSchema.safeParse(brokenParent).success, false);
  assert.equal(decodeProfileDraft(JSON.stringify(broken)).status, "corrupt");
});

test("Expansion profile storage propagates write failures and keeps scenario keys untouched", () => {
  const written: string[] = [];
  const storage = {
    setItem: (key: string) => {
      written.push(key);
      if (key === PROFILE_DRAFT_STORAGE_KEY) throw new Error("Quota exceeded");
    },
  };
  assert.throws(
    () => persistProfileDraft(storage as unknown as Storage, exampleEnvelope()),
    /Quota exceeded/,
  );
  assert.deepEqual(written, [PROFILE_DRAFT_STORAGE_KEY]);
  assert.throws(
    () => resetProfileDraft({ removeItem: () => { throw new Error("blocked"); } }),
    /blocked/,
  );
  assert.notEqual(PROFILE_DRAFT_STORAGE_KEY, STORAGE_KEY);
  assert.notEqual(PROFILE_DRAFT_STORAGE_KEY, LOCAL_STORAGE_KEY);
  assert.notEqual(PROFILE_DRAFT_STORAGE_KEY, MODE_STORAGE_KEY);
});

test("Expansion profile storage never writes the scenario or mode keys", () => {
  const { map, storage } = revisionStore();
  map.set(STORAGE_KEY, "keep");
  map.set(MODE_STORAGE_KEY, "demo");
  persistProfileDraft(storage, exampleEnvelope());
  assert.equal(map.get(STORAGE_KEY), "keep");
  assert.equal(map.get(MODE_STORAGE_KEY), "demo");
  assert.ok(map.has(PROFILE_DRAFT_STORAGE_KEY));
});

test("Expansion profile drafts survive a JSON round-trip without mutation", () => {
  const envelope = exampleEnvelope();
  const before = structuredClone(envelope);
  const { map, storage } = revisionStore();
  persistProfileDraft(storage, envelope);
  const decoded = decodeProfileDraft(map.get(PROFILE_DRAFT_STORAGE_KEY)!);
  assert.equal(decoded.status, "ok");
  if (decoded.status !== "ok") return;
  assert.deepEqual(decoded.envelope, before);
  assert.deepEqual(envelope, before);
});

// Backward-compatibility guard for the draft type used by the UI.
const _envelopeType: ProfileDraftEnvelope = exampleEnvelope();
void _envelopeType;
