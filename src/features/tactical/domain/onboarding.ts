import { z } from "zod";
import type { Dataset } from "./dataset.ts";

export const onboardingDraftSchema = z.object({
  version: z.literal(1),
  step: z.enum(["restaurant", "uploads"]),
  name: z.string().max(120),
  location: z.string().max(240),
  goal: z.enum(["improve", "expand", "both"]),
  demo: z.boolean(),
});
export type OnboardingDraft = z.infer<typeof onboardingDraftSchema>;
export const initialOnboardingDraft: OnboardingDraft = {
  version: 1, step: "restaurant", name: "", location: "", goal: "improve", demo: true,
};

// Upload contents and entered business details must never reach demo setup.
export const onboardingRequestSchema = z.object({ demo: z.literal(true) }).strict();
export const onboardingSummarySchema = z.object({
  id: z.string(), name: z.string(), cuisine: z.string(), location: z.string(),
  source: z.string(), revision: z.number().int().nonnegative().nullable(),
  counts: z.object({ menu: z.number().int().nonnegative(), reviews: z.number().int().nonnegative(), team: z.number().int().nonnegative(), inventory: z.number().int().nonnegative() }),
});
export type OnboardingSummary = z.infer<typeof onboardingSummarySchema>;

export function summarizeOnboarding(dataset: Dataset, source: string, revision: number | null): OnboardingSummary {
  if (!dataset.isDemo || dataset.provenance.origin !== "synthetic") throw new Error("Demo data required");
  return onboardingSummarySchema.parse({
    id: dataset.profile.id, name: dataset.profile.name, cuisine: dataset.profile.cuisine,
    location: dataset.profile.location, source, revision,
    counts: { menu: dataset.operations.menu.length, reviews: dataset.reviews.length, team: dataset.operations.employees.length, inventory: dataset.operations.inventory.length },
  });
}
