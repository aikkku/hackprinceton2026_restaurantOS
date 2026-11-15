import { z } from "zod";
import { decisionFinanceInputsSchema, decisionFinanceResultSchema } from "./decision-finance.ts";
import { assessmentSchema } from "./matching.ts";
import { requirementSchema } from "./requirements.ts";

export const ADVISOR_VERSION = "expansion-advisor-v1";
export const MAX_QUESTION_LENGTH = 2000;
export const MAX_HISTORY_MESSAGES = 12;
const text = z.string().trim().min(1).max(2000);
const id = z.string().min(1).max(500);

export const advisorPlaceSchema = z.strictObject({
  id, name: text, address: text.nullable(), suite: text.nullable(), fit: text,
  monthlyCost: text, sourceIds: z.array(id).max(100),
  checks: z.array(assessmentSchema).max(30), stillToCheck: z.array(text).max(30),
});
const common = {
  restaurant: text, city: text, profileRevision: z.number().int().nonnegative(),
  needs: z.array(requirementSchema).max(30),
  propertyData: z.strictObject({ datasetId: id.nullable(), datasetDate: text.nullable(), synthetic: z.boolean() }),
};
export const advisorContextSchema = z.discriminatedUnion("topic", [
  z.strictObject({ topic: z.literal("property"), ...common, place: advisorPlaceSchema }),
  z.strictObject({ topic: z.literal("comparison"), ...common, places: z.array(advisorPlaceSchema).min(1).max(10), pick: id.nullable() }),
  z.strictObject({ topic: z.literal("opening_costs"), ...common, place: advisorPlaceSchema,
    costInputs: decisionFinanceInputsSchema, costResults: decisionFinanceResultSchema }),
  z.strictObject({ topic: z.literal("plan"), ...common, pick: advisorPlaceSchema, biggestConcern: text, nextSteps: z.array(text).max(30) }),
]);
export type AdvisorContext = z.infer<typeof advisorContextSchema>;

export const advisorHistoryMessageSchema = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("user"), text: z.string().trim().min(1).max(MAX_QUESTION_LENGTH) }),
  z.strictObject({ role: z.literal("assistant"), text: z.string().trim().min(1).max(12000) }),
]);
export const advisorRequestSchema = z.strictObject({
  question: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
  context: advisorContextSchema,
  history: z.array(advisorHistoryMessageSchema).max(MAX_HISTORY_MESSAGES).default([]),
}).superRefine(({ history }, ctx) => {
  if (history.length % 2 || history.some((m, i) => m.role !== (i % 2 ? "assistant" : "user")))
    ctx.addIssue({ code: "custom", path: ["history"], message: "History must contain complete user/assistant exchanges." });
});
export type AdvisorRequest = z.infer<typeof advisorRequestSchema>;

export const advisorOutputSchema = z.strictObject({
  answer: z.string().trim().min(1).max(12000),
  evidenceIds: z.array(id).max(100),
  limitations: z.array(z.string().trim().min(1).max(1000)).max(5),
});
export const advisorResponseSchema = advisorOutputSchema.extend({
  version: z.literal(ADVISOR_VERSION), model: z.string().min(1).max(120),
  origin: z.literal("assumed"), generatedAt: z.iso.datetime(),
});
export type AdvisorResponse = z.infer<typeof advisorResponseSchema>;

export function advisorEvidenceIds(context: AdvisorContext): string[] {
  const places = context.topic === "comparison" ? context.places : context.topic === "plan" ? [context.pick] : [context.place];
  return [...new Set(places.flatMap(p => [...p.sourceIds, ...p.checks.flatMap(c => c.evidenceIds)]))];
}
