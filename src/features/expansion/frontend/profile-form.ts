import {
  requirementEditSchema,
  type ProfileRevision,
  type Requirement,
  type RequirementEdit,
} from "../domain/requirements.ts";

/**
 * Pure profile-edit form helpers (Rain-owned frontend, no React).
 * Kept in a .ts module so the Node test runner can exercise the exact
 * conversion and validation logic the profile screen uses.
 */

export type FormState = {
  occupancy: string;
  funds: string;
  reserve: string;
  seatsMin: string;
  seatsMax: string;
  kitchen: boolean;
  parking: boolean;
  neighborhoods: string;
  othersAcceptable: boolean;
  market: string;
  ventilation: string;
  baselineNote: string;
};

export type FieldIssue = { field: keyof FormState; message: string };

export const MARKET_OPTIONS = [
  { value: "US-TX-Houston", label: "Houston, TX (supported)" },
  { value: "US-CA-Los Angeles", label: "Los Angeles, CA (not supported yet)" },
] as const;

export const FORM_LABELS: Record<keyof FormState, string> = {
  occupancy: "Total monthly occupancy limit",
  funds: "Total available funds",
  reserve: "Emergency reserve",
  seatsMin: "Preferred seats",
  seatsMax: "Preferred seats maximum",
  kitchen: "Existing kitchen",
  parking: "Customer parking",
  neighborhoods: "Preferred neighborhoods",
  othersAcceptable: "Other neighborhoods acceptable",
  market: "Target market",
  ventilation: "Cooking / ventilation needs",
  baselineNote: "Financial baseline note",
};

export function formFromRevision(revision: ProfileRevision): FormState {
  const find = (id: Requirement["id"]) =>
    revision.requirements.requirements.find((item) => item.id === id);
  const occupancy = find("occupancy.monthlyLimit");
  const funds = find("funds.totalAvailable");
  const reserve = find("funds.emergencyReserve");
  const seats = find("space.seats");
  const kitchen = find("space.existingKitchen");
  const parking = find("space.customerParking");
  const neighborhood = find("market.neighborhoodPreference");
  const market = find("market.target");
  return {
    occupancy:
      occupancy?.value.kind === "number" ? String(occupancy.value.value) : "",
    funds: funds?.value.kind === "number" ? String(funds.value.value) : "",
    reserve: reserve?.value.kind === "number" ? String(reserve.value.value) : "",
    seatsMin:
      seats?.value.kind === "range" && seats.value.minimum !== null
        ? String(seats.value.minimum)
        : "",
    seatsMax:
      seats?.value.kind === "range" && seats.value.maximum !== null
        ? String(seats.value.maximum)
        : "",
    kitchen: kitchen?.value.kind === "boolean" ? kitchen.value.value : true,
    parking: parking?.value.kind === "boolean" ? parking.value.value : true,
    neighborhoods:
      neighborhood?.value.kind === "neighborhood"
        ? neighborhood.value.preferred.join(", ")
        : "",
    othersAcceptable:
      neighborhood?.value.kind === "neighborhood"
        ? neighborhood.value.othersAcceptable
        : true,
    market:
      market?.value.kind === "market" &&
      market.value.market.city === "Houston" &&
      market.value.market.state === "TX" &&
      market.value.market.country === "US"
        ? "US-TX-Houston"
        : "US-CA-Los Angeles",
    ventilation: revision.followUpAnswers.ventilationRequirements ?? "",
    baselineNote: revision.followUpAnswers.financialBaselineNote ?? "",
  };
}

export function buildEdits(
  form: FormState,
  previous: ProfileRevision,
): {
  edits: RequirementEdit[];
  issues: FieldIssue[];
} {
  const issues: FieldIssue[] = [];
  const edits: RequirementEdit[] = [];
  const number = (
    raw: string,
    field: keyof FormState,
    label: string,
  ): number | null => {
    if (raw.trim() === "") {
      issues.push({ field, message: `Enter a ${label}.` });
      return null;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      issues.push({ field, message: `${label} must be a nonnegative number.` });
      return null;
    }
    return value;
  };
  const occupancy = number(form.occupancy, "occupancy", "monthly occupancy limit");
  if (occupancy !== null)
    edits.push({ id: "occupancy.monthlyLimit", value: occupancy });
  const funds = number(form.funds, "funds", "total available funds");
  if (funds !== null) edits.push({ id: "funds.totalAvailable", value: funds });
  const reserve =
    form.reserve.trim() === ""
      ? null
      : number(form.reserve, "reserve", "nonnegative reserve");
  if (form.reserve.trim() === "" || reserve !== null)
    edits.push({ id: "funds.emergencyReserve", value: reserve });
  const seatsMinRaw = form.seatsMin.trim();
  const seatsMaxRaw = form.seatsMax.trim();
  if (seatsMinRaw === "" || seatsMaxRaw === "") {
    issues.push({
      field: "seatsMin",
      message: "Enter both a minimum and a maximum seat count.",
    });
  } else {
    const minimum = Number(seatsMinRaw);
    const maximum = Number(seatsMaxRaw);
    const rangeCheck = requirementEditSchema.safeParse({
      id: "space.seats",
      value: { minimum, maximum },
    });
    if (!rangeCheck.success) {
      issues.push({
        field: "seatsMin",
        message: rangeCheck.error.issues[0]?.message ?? "Invalid seat range.",
      });
    } else {
      edits.push({ id: "space.seats", value: { minimum, maximum } });
    }
  }
  edits.push({ id: "space.existingKitchen", value: form.kitchen });
  edits.push({ id: "space.customerParking", value: form.parking });
  const preferred = form.neighborhoods
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!preferred.length) {
    issues.push({
      field: "neighborhoods",
      message: "Enter at least one preferred neighborhood.",
    });
  } else {
    edits.push({
      id: "market.neighborhoodPreference",
      value: { preferred, othersAcceptable: form.othersAcceptable },
    });
  }
  if (form.market === "US-TX-Houston") {
    edits.push({
      id: "market.target",
      value: { city: "Houston", state: "TX", country: "US" },
    });
  } else {
    edits.push({
      id: "market.target",
      value: { city: "Los Angeles", state: "CA", country: "US" },
    });
  }
  edits.push({
    id: "space.ventilation",
    value: form.ventilation.trim() === "" ? null : form.ventilation.trim(),
  });
  // Only emit edits that actually differ from the previous revision, so a
  // no-change save never rewrites requirement provenance as "edited".
  const previousById = new Map(
    previous.requirements.requirements.map((item) => [item.id, item]),
  );
  return {
    edits: edits.filter(
      (edit) =>
        !previousById.has(edit.id) ||
        !editMatches(edit, previousById.get(edit.id)!),
    ),
    issues,
  };
}

function editMatches(edit: RequirementEdit, previous: Requirement): boolean {
  switch (edit.id) {
    case "occupancy.monthlyLimit":
    case "funds.totalAvailable":
      return (
        previous.value.kind === "number" &&
        previous.value.value === edit.value
      );
    case "funds.emergencyReserve": {
      if (edit.value === null) return previous.value.kind === "unknown";
      return (
        previous.value.kind === "number" &&
        previous.value.value === edit.value
      );
    }
    case "space.seats":
      return (
        previous.value.kind === "range" &&
        previous.value.minimum === edit.value.minimum &&
        previous.value.maximum === edit.value.maximum
      );
    case "space.existingKitchen":
    case "space.customerParking":
      return (
        previous.value.kind === "boolean" &&
        previous.value.value === edit.value
      );
    case "market.neighborhoodPreference":
      return (
        previous.value.kind === "neighborhood" &&
        previous.value.othersAcceptable === edit.value.othersAcceptable &&
        previous.value.preferred.length === edit.value.preferred.length &&
        previous.value.preferred.every(
          (item, index) => item === edit.value.preferred[index],
        )
      );
    case "market.target":
      return (
        previous.value.kind === "market" &&
        previous.value.market.city === edit.value.city &&
        previous.value.market.state === edit.value.state &&
        previous.value.market.country === edit.value.country
      );
    case "space.ventilation": {
      if (edit.value === null) return previous.value.kind === "unknown";
      return (
        previous.value.kind === "text" &&
        previous.value.value === edit.value
      );
    }
    case "space.parkingSpacesMinimum": {
      if (edit.value === null) return previous.value.kind === "unknown";
      return (
        previous.value.kind === "number" &&
        previous.value.value === edit.value
      );
    }
  }
}

export function requirementToField(
  requirementId: Requirement["id"],
): keyof FormState {
  switch (requirementId) {
    case "occupancy.monthlyLimit":
      return "occupancy";
    case "funds.totalAvailable":
      return "funds";
    case "funds.emergencyReserve":
      return "reserve";
    case "space.seats":
      return "seatsMin";
    case "market.neighborhoodPreference":
      return "neighborhoods";
    case "market.target":
      return "market";
    case "space.ventilation":
      return "ventilation";
    default:
      return "occupancy";
  }
}

export function changedSummary(
  edits: RequirementEdit[],
  previous: ProfileRevision,
): string {
  const previousById = new Map(
    previous.requirements.requirements.map((item) => [item.id, item]),
  );
  const changed = edits
    .filter((edit) => previousById.has(edit.id))
    .map((edit) => previousById.get(edit.id)!.label);
  return changed.length
    ? `Owner edit: ${changed.join(", ")}.`
    : "Owner edit (no requirement changes).";
}
