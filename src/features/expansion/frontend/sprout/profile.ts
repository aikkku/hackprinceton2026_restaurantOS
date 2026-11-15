import { PROFILE_DRAFT_SCHEMA_VERSION, intakeSchema, type RestaurantIntake } from "../../domain/intake.ts";
import { ProfileValidationError, UnsupportedProfileError, createProfileRevision, type ProfileRevision, type Requirement } from "../../domain/requirements.ts";
import { exampleIntake } from "../data/intake-example.ts";
import { buildEdits, type FormState } from "../profile-form.ts";
import { currentProfileRevision, profileDraftEnvelopeSchema, type ProfileDraftEnvelope } from "../storage.ts";

/**
 * Profile helpers for the sprout needs flow (pure; no React, no storage).
 *
 * Edits are always computed against revision 0 — the untouched interview
 * normalization — so a later change never silently drops an earlier one.
 */

export function exampleEnvelope(now = new Date().toISOString()): ProfileDraftEnvelope {
  const revision = createProfileRevision(exampleIntake(), {
    revisionId: crypto.randomUUID(), revisionNumber: 0, createdAt: now, parentRevisionId: null,
    editSummary: "Started from the example restaurant profile.",
  });
  return profileDraftEnvelopeSchema.parse({ schemaVersion: PROFILE_DRAFT_SCHEMA_VERSION, updatedAt: now, revisions: [revision] });
}

const comparable = (requirements: Requirement[]) =>
  JSON.stringify([...requirements].sort((a, b) => a.id.localeCompare(b.id)).map((item) => [item.id, item.value, item.state]));

const LABELS: Partial<Record<Requirement["id"], string>> = {
  "market.neighborhoodPreference": "neighborhoods",
  "occupancy.monthlyLimit": "monthly rent budget",
  "funds.totalAvailable": "money available",
  "funds.emergencyReserve": "reserve",
  "space.seats": "seats",
  "space.existingKitchen": "kitchen",
  "space.customerParking": "parking",
  "market.target": "city",
  "space.ventilation": "cooking needs",
};

export type ReviseResult =
  | { ok: true; envelope: ProfileDraftEnvelope; revision: ProfileRevision; changed: boolean }
  | { ok: false; message: string };

export function reviseFromForm(envelope: ProfileDraftEnvelope, form: FormState, now = new Date().toISOString()): ReviseResult {
  const base = [...envelope.revisions].sort((a, b) => a.revisionNumber - b.revisionNumber)[0];
  const current = currentProfileRevision(envelope);
  const { edits, issues } = buildEdits(form, base);
  if (issues.length) return { ok: false, message: issues[0].message };
  try {
    const candidate = createProfileRevision(base.intakeSnapshot, {
      revisionId: crypto.randomUUID(), revisionNumber: current.revisionNumber + 1, createdAt: now,
      parentRevisionId: current.revisionId, editSummary: "",
    }, edits, current.followUpAnswers);
    if (comparable(candidate.requirements.requirements) === comparable(current.requirements.requirements))
      return { ok: true, envelope, revision: current, changed: false };
    const before = new Map(current.requirements.requirements.map((item) => [item.id, JSON.stringify(item.value)]));
    const changed = candidate.requirements.requirements.filter((item) => before.get(item.id) !== JSON.stringify(item.value)).map((item) => LABELS[item.id] ?? item.label);
    const revision = createProfileRevision(base.intakeSnapshot, {
      revisionId: candidate.revisionId, revisionNumber: candidate.revisionNumber, createdAt: now,
      parentRevisionId: current.revisionId, editSummary: `Changed ${changed.join(", ")}.`,
    }, edits, current.followUpAnswers);
    const next = profileDraftEnvelopeSchema.parse({ ...envelope, updatedAt: now, revisions: [...envelope.revisions, revision] });
    return { ok: true, envelope: next, revision, changed: true };
  } catch (error) {
    if (error instanceof ProfileValidationError) return { ok: false, message: error.issues[0]?.message ?? "Those needs aren’t valid." };
    if (error instanceof UnsupportedProfileError) return { ok: false, message: error.message };
    return { ok: false, message: error instanceof Error ? error.message : "Those needs couldn’t be saved." };
  }
}

/**
 * The search service normalizes requirements from the intake it receives,
 * so owner edits must travel inside it. The revision's own intake snapshot
 * (the interview record) is never changed; this returns a new document
 * whose edited sections no longer cite interview answers, plus a note.
 */
export function effectiveIntake(revision: ProfileRevision): RestaurantIntake {
  const intake = structuredClone(revision.intakeSnapshot) as RestaurantIntake;
  const find = (id: Requirement["id"]) => revision.requirements.requirements.find((item) => item.id === id)?.value;
  const touched = new Set<"expansion" | "budget" | "space">();
  const set = <T,>(section: "expansion" | "budget" | "space", current: T, next: T, apply: () => void) => {
    if (JSON.stringify(current) !== JSON.stringify(next)) { apply(); touched.add(section); }
  };
  const neighborhood = find("market.neighborhoodPreference");
  if (neighborhood?.kind === "neighborhood") {
    set("expansion", intake.expansion.preferredNeighborhoods, neighborhood.preferred, () => { intake.expansion.preferredNeighborhoods = [...neighborhood.preferred]; });
    set("expansion", intake.expansion.otherNeighborhoodsAcceptable, neighborhood.othersAcceptable, () => { intake.expansion.otherNeighborhoodsAcceptable = neighborhood.othersAcceptable; });
  }
  const cap = find("occupancy.monthlyLimit");
  if (cap?.kind === "number") set("budget", intake.budget.maximumMonthlyOccupancyCost, cap.value, () => { intake.budget.maximumMonthlyOccupancyCost = cap.value; });
  const funds = find("funds.totalAvailable");
  if (funds?.kind === "number") set("budget", intake.budget.totalAvailableFunds, funds.value, () => { intake.budget.totalAvailableFunds = funds.value; });
  const reserve = find("funds.emergencyReserve");
  const reserveValue = reserve?.kind === "number" ? reserve.value : null;
  set("budget", intake.budget.cashReserveToKeep, reserveValue, () => { intake.budget.cashReserveToKeep = reserveValue; });
  const seats = find("space.seats");
  if (seats?.kind === "range" && seats.minimum !== null && seats.maximum !== null) {
    set("space", [intake.space.preferredSeats.minimum, intake.space.preferredSeats.maximum], [seats.minimum, seats.maximum], () => {
      intake.space.preferredSeats = { ...intake.space.preferredSeats, minimum: seats.minimum!, maximum: seats.maximum! };
    });
  }
  const kitchen = find("space.existingKitchen");
  if (kitchen?.kind === "boolean") set("space", intake.space.mustHave.existingKitchen, kitchen.value, () => { intake.space.mustHave.existingKitchen = kitchen.value; });
  const parking = find("space.customerParking");
  if (parking?.kind === "boolean") set("space", intake.space.mustHave.customerParking, parking.value, () => { intake.space.mustHave.customerParking = parking.value; });
  if (!touched.size) return intake;
  for (const section of touched) intake[section].sourceAnswerIds = [];
  intake.matchingNotes = [...intake.matchingNotes, `Owner edits from profile revision ${revision.revisionNumber} replace the interview answers for: ${[...touched].join(", ")}. ${revision.editSummary}`.trim()];
  return intakeSchema.parse(intake);
}
