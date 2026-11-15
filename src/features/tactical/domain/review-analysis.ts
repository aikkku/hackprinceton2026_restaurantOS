import { z } from "zod";
import type { Fixture } from "./schemas.ts";

export const reviewAnalysisVersion = "review-triage-v1";
export const reviewTopics = ["Seating", "Wait time", "Service", "Food quality", "Menu & dietary", "Value", "Ambience", "Cleanliness", "Takeaway & delivery", "Other"] as const;
export const reviewClassificationSchema = z.object({
  reviewId: z.string().min(1).max(120),
  themes: z.array(z.enum(reviewTopics)).min(1).max(4),
  sentiment: z.enum(["positive", "neutral", "negative", "mixed"]),
  highPriority: z.boolean(),
  reason: z.string().trim().min(1).max(600),
}).strict();
export const reviewBatchSchema = z.object({ classifications: z.array(reviewClassificationSchema).min(1).max(10) }).strict();
export const analyzedReviewSchema = z.object({
  restaurantId: z.string(),
  source: z.object({ id: z.string(), text: z.string(), rating: z.number(), date: z.string() }).strict(),
  classification: reviewClassificationSchema,
  model: z.string().min(1),
  processedAt: z.iso.datetime(),
  pipelineVersion: z.literal(reviewAnalysisVersion),
}).strict();
export const reviewAnalysisResponseSchema = z.object({
  ok: z.literal(true),
  records: z.array(analyzedReviewSchema),
  total: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  storage: z.enum(["mongodb", "unavailable"]),
  busy: z.boolean(),
});
export type Review = Fixture["reviews"][number];
export type AnalyzedReview = z.infer<typeof analyzedReviewSchema>;
export type ReviewAnalysisResponse = z.infer<typeof reviewAnalysisResponseSchema>;
export function reviewSource(review: Review) {
  return { id: review.id, text: review.text, rating: review.rating, date: review.date };
}
export function matchesReview(record: AnalyzedReview, restaurantId: string, review: Review) {
  const source = record.source;
  return record.restaurantId === restaurantId && record.pipelineVersion === reviewAnalysisVersion
    && record.classification.reviewId === review.id && source.id === review.id
    && source.text === review.text && source.rating === review.rating && source.date === review.date;
}
export function validateReviewBatch(raw: unknown, reviews: readonly Review[]) {
  const { classifications } = reviewBatchSchema.parse(raw);
  const ids = new Set(classifications.map(row => row.reviewId));
  if (ids.size !== reviews.length || classifications.length !== reviews.length || reviews.some(review => !ids.has(review.id))) throw new Error("Invalid review coverage");
  return classifications.map(row => ({ ...row, themes: [...new Set(row.themes)] }));
}
