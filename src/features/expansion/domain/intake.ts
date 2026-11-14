import { z } from "zod";

/**
 * Expansion-local intake and profile-draft contracts (Rain-owned).
 *
 * The intake document is the structured output of a short owner interview,
 * modeled on docs/expansion/examples/restaurant-intake.sample.json. The
 * interview answers are preserved verbatim: user edits to requirements must
 * never rewrite this historical record. Missing values stay `null`/unknown
 * rather than being replaced with defaults.
 */

export const INTAKE_SCHEMA_VERSION = "1.0";
export const PROFILE_DRAFT_SCHEMA_VERSION = 1;

const id = z.string().min(1);
const nonnegative = z.number().finite().nonnegative();
const nullableNonnegative = nonnegative.nullable();

export const sourceAnswerSchema = z.object({
  id,
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const followUpQuestionSchema = z.object({
  field: z.enum([
    "budget.cashReserveToKeep",
    "space.ventilationRequirements",
    "financialBaseline",
  ]),
  question: z.string().min(1),
  blocksInitialSearch: z.boolean(),
  neededFor: z.string().min(1),
});

export const restaurantSectionSchema = z.object({
  name: z.string().min(1),
  cuisine: z.string().min(1),
  serviceType: z.string().min(1),
  currentCity: z.string().min(1),
  currentState: z.string().min(1),
  currentCountry: z.string().min(1),
  sourceAnswerIds: z.array(id),
});

export const expansionSectionSchema = z.object({
  goal: z.string().min(1),
  targetCity: z.string().min(1),
  targetState: z.string().min(1),
  targetCountry: z.string().min(1),
  preferredNeighborhoods: z.array(z.string().min(1)),
  otherNeighborhoodsAcceptable: z.boolean(),
  targetOpeningDate: z.iso.date().nullable(),
  sourceAnswerIds: z.array(id),
});

export const occupancyScopeValues = [
  "base_rent_and_additional_occupancy_charges",
  "base_rent_only",
] as const;

export const budgetSectionSchema = z
  .object({
    currency: z.string().min(3).max(3),
    totalAvailableFunds: nonnegative,
    cashReserveToKeep: nullableNonnegative,
    maximumUpfrontSpending: nullableNonnegative,
    maximumMonthlyOccupancyCost: nonnegative,
    monthlyOccupancyCostIncludes: z.enum(occupancyScopeValues),
    monthlyOccupancyLimitIsHard: z.boolean(),
    sourceAnswerIds: z.array(id),
  })
  .superRefine((budget, ctx) => {
    if (
      budget.cashReserveToKeep !== null &&
      budget.cashReserveToKeep > budget.totalAvailableFunds
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "The emergency reserve cannot exceed the total available funds.",
        path: ["cashReserveToKeep"],
      });
    }
    if (
      budget.maximumUpfrontSpending !== null &&
      budget.maximumUpfrontSpending > budget.totalAvailableFunds
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Maximum upfront spending cannot exceed the total available funds.",
        path: ["maximumUpfrontSpending"],
      });
    }
    if (
      budget.cashReserveToKeep !== null &&
      budget.maximumUpfrontSpending !== null &&
      budget.cashReserveToKeep + budget.maximumUpfrontSpending >
        budget.totalAvailableFunds
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "The emergency reserve plus maximum upfront spending exceeds the total available funds.",
        path: ["maximumUpfrontSpending"],
      });
    }
  });

const seatRangeSchema = z
  .object({
    minimum: nonnegative.int(),
    maximum: nonnegative.int(),
    isHardRequirement: z.boolean(),
  })
  .refine(
    (range) => range.minimum <= range.maximum,
    "The seat range minimum cannot exceed its maximum.",
  );

export const areaRangeSchema = z
  .object({
    minimum: nullableNonnegative,
    maximum: nullableNonnegative,
  })
  .superRefine((range, ctx) => {
    if (
      range.minimum !== null &&
      range.maximum !== null &&
      range.minimum > range.maximum
    ) {
      ctx.addIssue({
        code: "custom",
        message: "The area range minimum cannot exceed its maximum.",
      });
    }
  });

export const spaceSectionSchema = z.object({
  preferredSeats: seatRangeSchema,
  areaSqFt: areaRangeSchema,
  mustHave: z.object({
    existingKitchen: z.boolean(),
    customerParking: z.boolean(),
  }),
  minimumCustomerParkingSpaces: nonnegative.int().nullable(),
  ventilationRequirements: z.string().nullable(),
  sourceAnswerIds: z.array(id),
});

export const financialBaselineSchema = z.object({
  origin: z.enum(["observed", "unavailable"]),
  currency: z.string().min(3).max(3),
  periodStart: z.iso.date().nullable(),
  periodEnd: z.iso.date().nullable(),
  netSales: nullableNonnegative,
  guestsServed: nullableNonnegative,
  averageSpendPerGuest: nullableNonnegative,
  operatingDays: nullableNonnegative,
  variableCosts: nullableNonnegative,
  fixedLaborCosts: nullableNonnegative,
  otherFixedCostsExcludingOccupancy: nullableNonnegative,
  sourceAnswerIds: z.array(id),
});

export const intakeSchema = z
  .object({
    schemaVersion: z.literal(INTAKE_SCHEMA_VERSION),
    recordType: z.literal("expansion_intake"),
    isDemo: z.boolean(),
    origin: z.string().min(1),
    description: z.string(),
    restaurant: restaurantSectionSchema,
    expansion: expansionSectionSchema,
    budget: budgetSectionSchema,
    space: spaceSectionSchema,
    financialBaseline: financialBaselineSchema,
    sourceAnswers: z.array(sourceAnswerSchema),
    followUpQuestions: z.array(followUpQuestionSchema),
    matchingNotes: z.array(z.string()),
  })
  .superRefine((data, ctx) => {
    const answerIds = new Set(data.sourceAnswers.map((answer) => answer.id));
    if (answerIds.size !== data.sourceAnswers.length) {
      ctx.addIssue({
        code: "custom",
        message: "Duplicate source answer IDs are not allowed.",
        path: ["sourceAnswers"],
      });
    }
    for (const [section, references] of [
      ["restaurant", data.restaurant.sourceAnswerIds],
      ["expansion", data.expansion.sourceAnswerIds],
      ["budget", data.budget.sourceAnswerIds],
      ["space", data.space.sourceAnswerIds],
      ["financialBaseline", data.financialBaseline.sourceAnswerIds],
    ] as const) {
      if (new Set(references).size !== references.length) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate source answer references in ${section}.`,
          path: [section, "sourceAnswerIds"],
        });
      }
      for (const reference of references) {
        if (!answerIds.has(reference)) {
          ctx.addIssue({
            code: "custom",
            message: `Unknown source answer "${reference}" referenced by ${section}.`,
            path: [section, "sourceAnswerIds"],
          });
        }
      }
    }
  });

export function parseIntake(value: unknown): RestaurantIntake {
  return intakeSchema.parse(value);
}

export type SourceAnswer = z.infer<typeof sourceAnswerSchema>;
export type FollowUpQuestion = z.infer<typeof followUpQuestionSchema>;
export type RestaurantSection = z.infer<typeof restaurantSectionSchema>;
export type ExpansionSection = z.infer<typeof expansionSectionSchema>;
export type BudgetSection = z.infer<typeof budgetSectionSchema>;
export type SpaceSection = z.infer<typeof spaceSectionSchema>;
export type FinancialBaseline = z.infer<typeof financialBaselineSchema>;
export type RestaurantIntake = z.infer<typeof intakeSchema>;
