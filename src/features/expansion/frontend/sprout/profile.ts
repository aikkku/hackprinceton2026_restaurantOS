import { ZodError } from "zod";
import { INTAKE_SCHEMA_VERSION, PROFILE_DRAFT_SCHEMA_VERSION, intakeSchema, type FollowUpQuestion, type RestaurantIntake } from "../../domain/intake.ts";
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

// ---------------------------------------------------------------------------
// New owner profiles (no example data; stored in the owner's workspace)

export type RestaurantBasics = {
  name: string;
  cuisine: string;
  serviceType: string;
  currentCity: string;
  currentState: string;
  /** Raw money inputs ("100,000"); carried into the needs form. */
  funds: string;
  reserve: string;
};

export const SERVICE_TYPES = [
  { value: "dine_in_and_takeout", label: "Dine-in and takeout" },
  { value: "dine_in", label: "Dine-in only" },
  { value: "takeout_and_delivery", label: "Takeout and delivery" },
  { value: "counter_service", label: "Counter service" },
] as const;

export const emptyBasics = (): RestaurantBasics => ({
  name: "", cuisine: "", serviceType: SERVICE_TYPES[0].value, currentCity: "", currentState: "", funds: "", reserve: "",
});

const amount = (raw: string): number | null => {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
};

/** First problem with the restaurant basics, or null. */
export function basicsIssue(basics: RestaurantBasics): string | null {
  if (!basics.name.trim()) return "Enter your restaurant’s name.";
  if (!basics.cuisine.trim()) return "Enter the kind of food you serve.";
  if (!SERVICE_TYPES.some((item) => item.value === basics.serviceType)) return "Pick how you serve customers.";
  if (!basics.currentCity.trim()) return "Enter the city your restaurant is in now.";
  if (!/^[A-Za-z]{2}$/.test(basics.currentState.trim())) return "Enter the two-letter state, like TX.";
  const funds = amount(basics.funds);
  if (funds === null || Number.isNaN(funds)) return "Enter the money you have for the new location, like 100,000.";
  const reserve = amount(basics.reserve);
  if (Number.isNaN(reserve)) return "The emergency reserve must be an amount, like 20,000, or left blank.";
  if (reserve !== null && reserve > funds) return "The emergency reserve can’t be more than the money you have.";
  return null;
}

/** The needs form a new profile starts from: the owner's money, nothing invented. */
export function blankNeedsForm(basics: RestaurantBasics): FormState {
  const reserve = amount(basics.reserve);
  return {
    occupancy: "", funds: String(amount(basics.funds) ?? ""), reserve: reserve === null || Number.isNaN(reserve) ? "" : String(reserve),
    seatsMin: "", seatsMax: "", kitchen: true, parking: true, neighborhoods: "", othersAcceptable: true,
    market: "US-TX-Houston", ventilation: "", baselineNote: "",
  };
}

const dollars = (value: number) => `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}`;

/**
 * The intake document for an owner-entered profile. Every requirement cites
 * the owner's own answer (recorded verbatim as the question asked and what
 * they entered); unknowns stay null. Assumes the form already validated.
 */
export function ownerIntake(basics: RestaurantBasics, form: FormState): RestaurantIntake {
  const funds = Number(form.funds);
  const reserve = form.reserve.trim() === "" ? null : Number(form.reserve);
  const occupancy = Number(form.occupancy);
  const seats = { minimum: Number(form.seatsMin), maximum: Number(form.seatsMax) };
  const preferred = form.neighborhoods.split(",").map((item) => item.trim()).filter(Boolean);
  const [targetCity, targetState] = form.market === "US-TX-Houston" ? ["Houston", "TX"] : ["Los Angeles", "CA"];
  const name = basics.name.trim();
  const cuisine = basics.cuisine.trim();
  const currentCity = basics.currentCity.trim();
  const currentState = basics.currentState.trim().toUpperCase();
  const service = SERVICE_TYPES.find((item) => item.value === basics.serviceType)?.label ?? basics.serviceType;
  const ventilation = form.ventilation.trim() || null;
  const yesNo = (value: boolean) => (value ? "required" : "not required");
  const followUpQuestions: FollowUpQuestion[] = [
    ...(reserve === null ? [{ field: "budget.cashReserveToKeep" as const, question: `How much of the ${dollars(funds)} would you like to keep for emergencies?`, blocksInitialSearch: false, neededFor: "upfront_affordability_comparison" }] : []),
    ...(ventilation === null ? [{ field: "space.ventilationRequirements" as const, question: "What kind of cooking equipment will the new kitchen need?", blocksInitialSearch: false, neededFor: "kitchen_suitability_verification" }] : []),
    { field: "financialBaseline", question: "Would you like to share a recent sales and expense report so we can check what each location would need to sell?", blocksInitialSearch: false, neededFor: "financial_scenarios" },
  ];
  return intakeSchema.parse({
    schemaVersion: INTAKE_SCHEMA_VERSION,
    recordType: "expansion_intake",
    isDemo: false,
    origin: "owner_entered",
    description: `Restaurant profile entered by the owner of ${name} in RestaurantOS. Values are the owner's stated needs, not verified records.`,
    restaurant: { name, cuisine, serviceType: basics.serviceType, currentCity, currentState, currentCountry: "US", sourceAnswerIds: ["owner_0"] },
    expansion: {
      goal: "second_location", targetCity, targetState, targetCountry: "US", preferredNeighborhoods: preferred,
      otherNeighborhoodsAcceptable: form.othersAcceptable, targetOpeningDate: null, sourceAnswerIds: ["owner_1"],
    },
    budget: {
      currency: "USD", totalAvailableFunds: funds, cashReserveToKeep: reserve, maximumUpfrontSpending: null,
      maximumMonthlyOccupancyCost: occupancy, monthlyOccupancyCostIncludes: "base_rent_and_additional_occupancy_charges",
      monthlyOccupancyLimitIsHard: true, sourceAnswerIds: ["owner_2", "owner_3"],
    },
    space: {
      preferredSeats: { ...seats, isHardRequirement: false }, areaSqFt: { minimum: null, maximum: null },
      mustHave: { existingKitchen: form.kitchen, customerParking: form.parking }, minimumCustomerParkingSpaces: null,
      ventilationRequirements: ventilation, sourceAnswerIds: ["owner_4", "owner_5"],
    },
    financialBaseline: {
      origin: "unavailable", currency: "USD", periodStart: null, periodEnd: null, netSales: null, guestsServed: null,
      averageSpendPerGuest: null, operatingDays: null, variableCosts: null, fixedLaborCosts: null,
      otherFixedCostsExcludingOccupancy: null, sourceAnswerIds: [],
    },
    sourceAnswers: [
      { id: "owner_0", question: "Tell us about your restaurant.", answer: `${name}: ${cuisine}, ${service.toLowerCase()}, in ${currentCity}, ${currentState}.` },
      { id: "owner_1", question: "Where would you like your next restaurant?", answer: `${targetCity}, ${targetState}. Favorite neighborhoods: ${preferred.join(", ")}. Other neighborhoods ${form.othersAcceptable ? "still count" : "do not count"}.` },
      { id: "owner_2", question: "How much money do you have for the new location?", answer: `${dollars(funds)} total.${reserve === null ? " Emergency reserve not given." : ` Keep ${dollars(reserve)} for emergencies.`}` },
      { id: "owner_3", question: "What’s your monthly rent budget, including extra building charges?", answer: `${dollars(occupancy)} per month.` },
      { id: "owner_4", question: "How many seats do you need?", answer: `${seats.minimum} to ${seats.maximum} seats (a preference).` },
      { id: "owner_5", question: "What does the space absolutely need?", answer: `Existing kitchen: ${yesNo(form.kitchen)}. Customer parking: ${yesNo(form.parking)}.` },
    ],
    followUpQuestions,
    matchingNotes: [
      `Use ${targetCity} as the search market; favorite neighborhoods are a preference${form.othersAcceptable ? ", not an exclusion of other neighborhoods" : ""}.`,
      `The ${dollars(occupancy)} limit applies to total monthly occupancy cost, not just quoted base rent. If additional charges are unknown, mark affordability as unverified.`,
      ...(reserve === null ? [`The ${dollars(funds)} may include an unspecified emergency reserve. Do not treat the entire amount as available for construction, equipment, and deposits.`] : []),
      "The seat range is a preference, not a square-footage requirement.",
      "Missing evidence for a must-have means verification is needed; it does not establish that a feature is present or absent.",
      "Do not estimate profitability or payback from this intake alone; financial baseline and candidate-specific costs are missing.",
    ],
  });
}

/** Revision 0 of a new owner profile (its id is the profile id). Nothing is stored here. */
export function ownerEnvelope(basics: RestaurantBasics, form: FormState, now = new Date().toISOString()): ReviseResult {
  const issue = basicsIssue(basics) ?? buildEdits(form, null).issues[0]?.message ?? null;
  if (issue) return { ok: false, message: issue };
  try {
    const intake = ownerIntake(basics, form);
    const revision = createProfileRevision(intake, {
      revisionId: crypto.randomUUID(), revisionNumber: 0, createdAt: now, parentRevisionId: null,
      editSummary: `Created the ${intake.restaurant.name} profile.`,
    });
    const envelope = profileDraftEnvelopeSchema.parse({ schemaVersion: PROFILE_DRAFT_SCHEMA_VERSION, updatedAt: now, revisions: [revision] });
    return { ok: true, envelope, revision, changed: true };
  } catch (error) {
    return { ok: false, message: profileErrorMessage(error) };
  }
}

function profileErrorMessage(error: unknown): string {
  if (error instanceof ProfileValidationError) return error.issues[0]?.message ?? "Those needs aren’t valid.";
  if (error instanceof UnsupportedProfileError) return error.message;
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Those needs aren’t valid.";
  return error instanceof Error ? error.message : "Those needs couldn’t be saved.";
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
    return { ok: false, message: profileErrorMessage(error) };
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
