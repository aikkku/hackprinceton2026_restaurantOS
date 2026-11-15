import { z } from "zod";
import { originSchema } from "./schemas.ts";
import {
  INTAKE_SCHEMA_VERSION,
  intakeSchema,
  type RestaurantIntake,
} from "./intake.ts";

/**
 * Normalized search requirements and immutable profile revisions (Rain-owned).
 *
 * Normalization turns the interview intake into stable, typed requirements
 * that Phase 2 search and Phase 3 specialist tools consume. Requirement IDs
 * are public contract surface: do not rename them without a migration.
 *
 * Rules preserved by this module:
 * - $5,000 is the hard TOTAL monthly occupancy limit (base rent alone does
 *   not establish affordability).
 * - $100,000 is total funds; the unspecified emergency reserve stays
 *   unknown, never zero.
 * - 40–50 seats is a soft preference, never converted into square footage.
 * - Existing kitchen and customer parking are hard; missing evidence is
 *   unknown, not pass/fail.
 * - Houston is required; Heights is preferred, other Houston neighborhoods
 *   stay eligible.
 * - Original interview answers are never rewritten by edits.
 */

export const REQUIREMENTS_MODEL_VERSION = "expansion-requirements-v1";

export const REQUIREMENT_IDS = [
  "market.target",
  "market.neighborhoodPreference",
  "occupancy.monthlyLimit",
  "occupancy.scope",
  "funds.totalAvailable",
  "funds.emergencyReserve",
  "space.seats",
  "space.areaSqFt",
  "space.existingKitchen",
  "space.customerParking",
  "space.parkingSpacesMinimum",
  "space.ventilation",
  "timeline.openingDate",
  "finance.baseline",
] as const;
export type RequirementId = (typeof REQUIREMENT_IDS)[number];

const id = z.string().min(1);
const nonnegative = z.number().finite().nonnegative();
const nullableNonnegative = nonnegative.nullable();

export const supportedMarketSchema = z.object({
  city: z.string().min(1),
  state: z.string().min(1),
  country: z.string().min(1),
});
export type SupportedMarket = z.infer<typeof supportedMarketSchema>;

export const SUPPORTED_CURRENCIES = ["USD"] as const;
export const SUPPORTED_MARKETS: readonly SupportedMarket[] = [
  { city: "Houston", state: "TX", country: "US" },
];

export const requirementValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("number"), value: nonnegative }),
  z.object({
    kind: z.literal("range"),
    minimum: nullableNonnegative,
    maximum: nullableNonnegative,
  }),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }),
  z.object({
    kind: z.literal("market"),
    market: supportedMarketSchema,
  }),
  z.object({
    kind: z.literal("neighborhood"),
    preferred: z.array(z.string().min(1)).min(1),
    othersAcceptable: z.boolean(),
  }),
  z.object({ kind: z.literal("text"), value: z.string().min(1).nullable() }),
  z.object({ kind: z.literal("unknown") }),
]);
export type RequirementValue = z.infer<typeof requirementValueSchema>;

export const requirementSchema = z
  .object({
    id: z.enum(REQUIREMENT_IDS),
    kind: z.enum(["hard", "soft"]),
    label: z.string().min(1),
    value: requirementValueSchema,
    unit: z.string().nullable(),
    /** Provenance of the CURRENT value: interview intake or owner edit. */
    origin: originSchema,
    /** Known means the value is usable; unknown means explicitly missing. */
    state: z.enum(["known", "unknown"]),
    /** Interview answers backing the current value; empty for owner edits. */
    sourceAnswerIds: z.array(id),
    /** Interview answers that originally backed this requirement. Never rewritten. */
    originalSourceAnswerIds: z.array(id),
    editedAt: z.iso.datetime().nullable(),
    note: z.string(),
  })
  .superRefine((item, ctx) => {
    if (
      item.value.kind === "range" &&
      item.value.minimum !== null &&
      item.value.maximum !== null &&
      item.value.minimum > item.value.maximum
    ) {
      ctx.addIssue({
        code: "custom",
        message: "The range minimum cannot exceed its maximum.",
        path: ["value"],
      });
    }
    if (
      item.state === "unknown" &&
      item.value.kind !== "unknown" &&
      !(
        item.value.kind === "text" &&
        item.value.value === null
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "A known value cannot be labeled unknown.",
        path: ["state"],
      });
    }
  });
export type Requirement = z.infer<typeof requirementSchema>;

export const searchRequirementsSchema = z
  .object({
    modelVersion: z.literal(REQUIREMENTS_MODEL_VERSION),
    revisionId: id,
    revisionNumber: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    requirements: z.array(requirementSchema),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const requirement of value.requirements) {
      if (seen.has(requirement.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate requirement id ${requirement.id}.`,
          path: ["requirements"],
        });
      }
      seen.add(requirement.id);
    }
  });
export type SearchRequirements = z.infer<typeof searchRequirementsSchema>;

export const followUpAnswersSchema = z.object({
  cashReserveToKeep: nullableNonnegative,
  ventilationRequirements: z.string().nullable(),
  financialBaselineNote: z.string().nullable(),
});
export type FollowUpAnswers = z.infer<typeof followUpAnswersSchema>;

export const profileRevisionSchema = z
  .object({
    revisionId: id,
    revisionNumber: z.number().int().nonnegative(),
    createdAt: z.iso.datetime(),
    parentRevisionId: id.nullable(),
    intakeSchemaVersion: z.literal(INTAKE_SCHEMA_VERSION),
    /** The original interview intake, preserved verbatim. */
    intakeSnapshot: intakeSchema,
    requirements: searchRequirementsSchema,
    followUpAnswers: followUpAnswersSchema,
    editSummary: z.string(),
    isDemo: z.boolean(),
  })
  .superRefine((revision, ctx) => {
    if (revision.requirements.revisionId !== revision.revisionId) {
      ctx.addIssue({
        code: "custom",
        message: "Requirements revision id does not match the profile revision.",
        path: ["requirements", "revisionId"],
      });
    }
    if (revision.requirements.revisionNumber !== revision.revisionNumber) {
      ctx.addIssue({
        code: "custom",
        message:
          "Requirements revision number does not match the profile revision.",
        path: ["requirements", "revisionNumber"],
      });
    }
    if (
      revision.isDemo !== revision.intakeSnapshot.isDemo
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Profile and intake demo provenance disagree.",
        path: ["isDemo"],
      });
    }
    if (
      revision.intakeSnapshot.budget.cashReserveToKeep !== null &&
      revision.followUpAnswers.cashReserveToKeep !== null &&
      revision.intakeSnapshot.budget.cashReserveToKeep !==
        revision.followUpAnswers.cashReserveToKeep
    ) {
      // The follow-up answer refines or confirms; the intake value is not rewritten.
      // A different follow-up value is allowed (it is an explicit owner edit),
      // so no rejection here.
    }
  });

export type ProfileRevision = z.infer<typeof profileRevisionSchema>;

export class ProfileValidationError extends Error {
  readonly issues: RequirementIssue[];
  constructor(issues: RequirementIssue[]) {
    super("The profile requirements are invalid.");
    this.name = "ProfileValidationError";
    this.issues = issues;
  }
}

export class UnsupportedProfileError extends Error {
  readonly code: "unsupported_market" | "unsupported_currency";
  constructor(code: "unsupported_market" | "unsupported_currency", message: string) {
    super(message);
    this.name = "UnsupportedProfileError";
    this.code = code;
  }
}

export type RequirementIssue = {
  requirementId: RequirementId;
  message: string;
};

function assertSupportedIntake(intake: RestaurantIntake): void {
  if (
    intake.budget.currency !== "USD" ||
    !SUPPORTED_CURRENCIES.includes(intake.budget.currency as (typeof SUPPORTED_CURRENCIES)[number])
  ) {
    throw new UnsupportedProfileError(
      "unsupported_currency",
      `Currency "${intake.budget.currency}" is not supported yet. The intake was not re-interpreted as USD.`,
    );
  }
  const market = intake.expansion;
  const supported = SUPPORTED_MARKETS.some(
    (candidate) =>
      candidate.city === market.targetCity &&
      candidate.state === market.targetState &&
      candidate.country === market.targetCountry,
  );
  if (!supported) {
    throw new UnsupportedProfileError(
      "unsupported_market",
      `${market.targetCity}, ${market.targetState}, ${market.targetCountry} is not a supported market yet. The intake was not re-interpreted as Houston.`,
    );
  }
}

const stateForValue = (value: RequirementValue): "known" | "unknown" =>
  value.kind === "unknown" ||
  (value.kind === "text" && value.value === null)
    ? "unknown"
    : "known";

const requirement = (value: {
  id: RequirementId;
  kind: "hard" | "soft";
  label: string;
  value: RequirementValue;
  unit: string | null;
  origin: Requirement["origin"];
  sourceAnswerIds: string[];
  note: string;
  state?: "known" | "unknown";
}): Requirement =>
  requirementSchema.parse({
    ...value,
    state: value.state ?? stateForValue(value.value),
    originalSourceAnswerIds: [...value.sourceAnswerIds],
    editedAt: null,
  });

/**
 * Normalize an intake document into stable search requirements.
 * Throws UnsupportedProfileError for unsupported currency/market so those
 * values are never silently re-interpreted.
 */
export function normalizeRequirements(
  intake: RestaurantIntake,
  meta: { revisionId: string; revisionNumber: number; createdAt: string },
): SearchRequirements {
  assertSupportedIntake(intake);
  // The fictional example is simulated; an owner's own answers are their stated assumptions.
  const stated: Requirement["origin"] = intake.isDemo ? "simulated" : "assumed";
  const budget = intake.budget;
  const space = intake.space;
  return searchRequirementsSchema.parse({
    modelVersion: REQUIREMENTS_MODEL_VERSION,
    revisionId: meta.revisionId,
    revisionNumber: meta.revisionNumber,
    createdAt: meta.createdAt,
    requirements: [
      requirement({
        id: "market.target",
        kind: "hard",
        label: "Target market",
        value: {
          kind: "market",
          market: {
            city: intake.expansion.targetCity,
            state: intake.expansion.targetState,
            country: intake.expansion.targetCountry,
          },
        },
        unit: null,
        origin: stated,
        sourceAnswerIds: intake.expansion.sourceAnswerIds,
        note: "Search market. Unsupported markets are rejected explicitly, never re-interpreted.",
      }),
      requirement({
        id: "market.neighborhoodPreference",
        kind: "soft",
        label: "Neighborhood preference",
        value: {
          kind: "neighborhood",
          preferred: [...intake.expansion.preferredNeighborhoods],
          othersAcceptable: intake.expansion.otherNeighborhoodsAcceptable,
        },
        unit: null,
        origin: stated,
        sourceAnswerIds: intake.expansion.sourceAnswerIds,
        note: "Owner-selected neighborhoods are preferences; other Houston areas remain eligible. Membership uses sourced boundaries.",
      }),
      requirement({
        id: "occupancy.monthlyLimit",
        kind: "hard",
        label: "Total monthly occupancy limit",
        value: { kind: "number", value: budget.maximumMonthlyOccupancyCost },
        unit: "USD/month",
        origin: stated,
        sourceAnswerIds: budget.sourceAnswerIds,
        note: "Hard TOTAL monthly occupancy cap. Base rent alone does not establish affordability.",
      }),
      requirement({
        id: "occupancy.scope",
        kind: "hard",
        label: "What the occupancy limit covers",
        value: { kind: "text", value: budget.monthlyOccupancyCostIncludes },
        unit: null,
        origin: stated,
        sourceAnswerIds: budget.sourceAnswerIds,
        note: "The $5,000 limit covers base rent and additional building charges.",
      }),
      requirement({
        id: "funds.totalAvailable",
        kind: "hard",
        label: "Total available funds",
        value: { kind: "number", value: budget.totalAvailableFunds },
        unit: "USD",
        origin: stated,
        sourceAnswerIds: budget.sourceAnswerIds,
        note: "$100,000 total funds is not the available opening spend; the emergency reserve is unspecified.",
      }),
      requirement({
        id: "funds.emergencyReserve",
        kind: "soft",
        label: "Emergency reserve to keep",
        value:
          budget.cashReserveToKeep === null
            ? { kind: "unknown" }
            : { kind: "number", value: budget.cashReserveToKeep },
        unit: "USD",
        origin: stated,
        sourceAnswerIds: budget.sourceAnswerIds,
        note: "The unspecified reserve stays unknown; it is not zero.",
      }),
      requirement({
        id: "space.seats",
        kind: "soft",
        label: "Preferred seats",
        value: {
          kind: "range",
          minimum: space.preferredSeats.minimum,
          maximum: space.preferredSeats.maximum,
        },
        unit: "seats",
        origin: stated,
        sourceAnswerIds: space.sourceAnswerIds,
        note: "Preference, not a hard square-footage filter. Seats are never converted into an area bound.",
      }),
      requirement({
        id: "space.areaSqFt",
        kind: "soft",
        label: "Space area",
        value: { kind: "unknown" },
        unit: "sq ft",
        origin: "unavailable",
        sourceAnswerIds: [],
        note: "No square-footage requirement was supplied and none is derived from the seat preference.",
      }),
      requirement({
        id: "space.existingKitchen",
        kind: "hard",
        label: "Existing kitchen",
        value: { kind: "boolean", value: space.mustHave.existingKitchen },
        unit: null,
        origin: stated,
        sourceAnswerIds: space.sourceAnswerIds,
        note: "Mandatory. Missing evidence means verification is needed; it does not establish presence or absence.",
      }),
      requirement({
        id: "space.customerParking",
        kind: "hard",
        label: "Customer parking",
        value: { kind: "boolean", value: space.mustHave.customerParking },
        unit: null,
        origin: stated,
        sourceAnswerIds: space.sourceAnswerIds,
        note: "Mandatory. Missing evidence means verification is needed.",
      }),
      requirement({
        id: "space.parkingSpacesMinimum",
        kind: "soft",
        label: "Minimum customer parking spaces",
        value:
          space.minimumCustomerParkingSpaces === null
            ? { kind: "unknown" }
            : { kind: "number", value: space.minimumCustomerParkingSpaces },
        unit: "spaces",
        origin: stated,
        sourceAnswerIds: space.sourceAnswerIds,
        note: "No numeric parking minimum was supplied; none is inferred.",
      }),
      requirement({
        id: "space.ventilation",
        kind: "soft",
        label: "Cooking / ventilation needs",
        value:
          space.ventilationRequirements === null
            ? { kind: "unknown" }
            : { kind: "text", value: space.ventilationRequirements },
        unit: null,
        origin: stated,
        sourceAnswerIds: space.sourceAnswerIds,
        note: "Optional follow-up question; the initial search does not require it.",
      }),
      requirement({
        id: "timeline.openingDate",
        kind: "soft",
        label: "Target opening date",
        value: { kind: "unknown" },
        unit: null,
        origin: "unavailable",
        sourceAnswerIds: [],
        note: "No opening date was supplied.",
      }),
      requirement({
        id: "finance.baseline",
        kind: "soft",
        label: "Financial baseline",
        value: { kind: "unknown" },
        unit: null,
        origin: "unavailable",
        sourceAnswerIds: [],
        note: "Financial baseline is unavailable; profit and payback cannot be estimated from this intake alone.",
      }),
    ],
  });
}

/** Editable requirement payloads, validated at the same boundary as the intake. */
export const requirementEditSchema = z.discriminatedUnion("id", [
  z.object({
    id: z.literal("market.target"),
    value: supportedMarketSchema,
  }),
  z.object({
    id: z.literal("market.neighborhoodPreference"),
    value: z.object({
      preferred: z.array(z.string().min(1)).min(1),
      othersAcceptable: z.boolean(),
    }),
  }),
  z.object({
    id: z.literal("occupancy.monthlyLimit"),
    value: nonnegative,
  }),
  z.object({
    id: z.literal("funds.totalAvailable"),
    value: nonnegative,
  }),
  z.object({
    id: z.literal("funds.emergencyReserve"),
    value: nullableNonnegative,
  }),
  z.object({
    id: z.literal("space.seats"),
    value: z
      .object({ minimum: nonnegative.int(), maximum: nonnegative.int() })
      .refine(
        (range) => range.minimum <= range.maximum,
        "The seat range minimum cannot exceed its maximum.",
      ),
  }),
  z.object({
    id: z.literal("space.existingKitchen"),
    value: z.boolean(),
  }),
  z.object({
    id: z.literal("space.customerParking"),
    value: z.boolean(),
  }),
  z.object({
    id: z.literal("space.ventilation"),
    value: z.string().min(1).nullable(),
  }),
  z.object({
    id: z.literal("space.parkingSpacesMinimum"),
    value: nullableNonnegative,
  }),
]);
export type RequirementEdit = z.infer<typeof requirementEditSchema>;

function valueToKind(
  edit: RequirementEdit,
): RequirementValue {
  switch (edit.id) {
    case "market.target":
      return { kind: "market", market: edit.value };
    case "market.neighborhoodPreference":
      return {
        kind: "neighborhood",
        preferred: [...edit.value.preferred],
        othersAcceptable: edit.value.othersAcceptable,
      };
    case "occupancy.monthlyLimit":
    case "funds.totalAvailable":
      return { kind: "number", value: edit.value };
    case "funds.emergencyReserve":
      return edit.value === null
        ? { kind: "unknown" }
        : { kind: "number", value: edit.value };
    case "space.seats":
      return {
        kind: "range",
        minimum: edit.value.minimum,
        maximum: edit.value.maximum,
      };
    case "space.existingKitchen":
    case "space.customerParking":
      return { kind: "boolean", value: edit.value };
    case "space.ventilation":
      return edit.value === null
        ? { kind: "unknown" }
        : { kind: "text", value: edit.value };
    case "space.parkingSpacesMinimum":
      return edit.value === null
        ? { kind: "unknown" }
        : { kind: "number", value: edit.value };
  }
}

/** Cross-field consistency rules applied to every saved revision. */
export function validateRequirements(
  requirements: Requirement[],
): RequirementIssue[] {
  const issues: RequirementIssue[] = [];
  const byId = new Map(requirements.map((item) => [item.id, item]));
  const funds = byId.get("funds.totalAvailable");
  const reserve = byId.get("funds.emergencyReserve");
  if (
    funds?.value.kind === "number" &&
    reserve?.value.kind === "number" &&
    reserve.value.value > funds.value.value
  ) {
    issues.push({
      requirementId: "funds.emergencyReserve",
      message:
        "The emergency reserve cannot exceed the total available funds.",
    });
  }
  const occupancy = byId.get("occupancy.monthlyLimit");
  if (occupancy && occupancy.value.kind !== "number") {
    issues.push({
      requirementId: "occupancy.monthlyLimit",
      message: "The occupancy limit must be a nonnegative amount.",
    });
  }
  const marketValue = byId.get("market.target")?.value;
  if (marketValue?.kind === "market") {
    const supported = SUPPORTED_MARKETS.some(
      (candidate) =>
        candidate.city === marketValue.market.city &&
        candidate.state === marketValue.market.state &&
        candidate.country === marketValue.market.country,
    );
    if (!supported) {
      issues.push({
        requirementId: "market.target",
        message: `${marketValue.market.city}, ${marketValue.market.state}, ${marketValue.market.country} is not a supported market yet. Choose Houston, TX.`,
      });
    }
  }
  return issues;
}

export type CreateRevisionOptions = {
  revisionId: string;
  revisionNumber: number;
  createdAt: string;
  parentRevisionId: string | null;
  editSummary: string;
};

/**
 * Create a new immutable profile revision by normalizing the intake and
 * applying zero or more owner edits. The returned revision is deeply frozen;
 * the intake snapshot and prior revisions are never mutated.
 */
export function createProfileRevision(
  intake: RestaurantIntake,
  options: CreateRevisionOptions,
  edits: RequirementEdit[] = [],
  followUpAnswers?: Partial<FollowUpAnswers>,
): ProfileRevision {
  assertSupportedIntake(intake);
  const normalized = normalizeRequirements(intake, {
    revisionId: options.revisionId,
    revisionNumber: options.revisionNumber,
    createdAt: options.createdAt,
  });
  const requirements = new Map(
    normalized.requirements.map((item) => [item.id, item]),
  );
  const editedAt = options.createdAt;
  for (const edit of edits) {
    // Validate every owner edit at the same boundary as the intake.
    const parsedEdit = requirementEditSchema.parse(edit);
    const previous = requirements.get(parsedEdit.id);
    if (!previous) continue;
    const nextValue = valueToKind(parsedEdit);
    requirements.set(parsedEdit.id, {
      ...previous,
      value: nextValue,
      origin: "assumed",
      state: stateForValue(nextValue),
      sourceAnswerIds: [],
      editedAt,
    });
  }
  const nextRequirements = [...requirements.values()];
  const issues = validateRequirements(nextRequirements);
  if (issues.length) throw new ProfileValidationError(issues);
  const revision = profileRevisionSchema.parse({
    revisionId: options.revisionId,
    revisionNumber: options.revisionNumber,
    createdAt: options.createdAt,
    parentRevisionId: options.parentRevisionId,
    intakeSchemaVersion: INTAKE_SCHEMA_VERSION,
    intakeSnapshot: intake,
    requirements: {
      modelVersion: REQUIREMENTS_MODEL_VERSION,
      revisionId: options.revisionId,
      revisionNumber: options.revisionNumber,
      createdAt: options.createdAt,
      requirements: nextRequirements,
    },
    followUpAnswers: {
      cashReserveToKeep: followUpAnswers?.cashReserveToKeep ?? null,
      ventilationRequirements: followUpAnswers?.ventilationRequirements ?? null,
      financialBaselineNote: followUpAnswers?.financialBaselineNote ?? null,
    },
    editSummary: options.editSummary,
    isDemo: intake.isDemo,
  });
  return Object.freeze(revision);
}

export function requirementDisplayValue(requirement: Requirement): string {
  switch (requirement.value.kind) {
    case "unknown":
      return "Unknown";
    case "number":
      return new Intl.NumberFormat("en-US").format(requirement.value.value);
    case "boolean":
      return requirement.value.value ? "Required" : "Not required";
    case "range": {
      const { minimum, maximum } = requirement.value;
      if (minimum === null && maximum === null) return "Unknown";
      if (minimum === null) return `Up to ${maximum}`;
      if (maximum === null) return `At least ${minimum}`;
      return `${minimum}–${maximum}`;
    }
    case "market":
      return `${requirement.value.market.city}, ${requirement.value.market.state} (${requirement.value.market.country})`;
    case "neighborhood": {
      const base = requirement.value.preferred.join(", ");
      return requirement.value.othersAcceptable
        ? `${base} preferred · others acceptable`
        : `${base} only`;
    }
    case "text":
      return requirement.value.value ?? "Unknown";
  }
}
