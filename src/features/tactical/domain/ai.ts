import { z } from "zod";
import { layoutSchema, type Layout } from "./schemas.ts";
import { hasOverlap } from "./layout.ts";
import { layoutLibrarySchema } from "./layout-library.ts";

export const aiError = "Something is wrong";
export const aiTaskSchema = z.enum(["floor", "custom-object", "reviews", "reply", "finance", "job", "advisor"]);
export type AiTask = z.infer<typeof aiTaskSchema>;
export const aiRequestSchema = z.object({
  task: aiTaskSchema,
  restaurantId: z.string().min(1).max(80),
  question: z.string().trim().max(3000).default(""),
  reviewId: z.string().max(120).optional(),
  layout: layoutSchema.optional(),
  layoutVersions: layoutLibrarySchema.optional(),
}).strict();
export type AiRequest = z.infer<typeof aiRequestSchema>;
const text = z.string().min(1).max(2000);
const refs = z.array(z.string().min(1).max(180)).min(1).max(12);
export const aiResultSchema = z.object({
  summary: text,
  limitations: z.array(text).min(1).max(8),
  findings: z.array(z.object({
    title: z.string().min(1).max(160), explanation: text, action: text,
    priority: z.enum(["low", "medium", "high"]), confidence: z.enum(["low", "medium", "high"]),
    evidenceIds: refs, cost: z.string().min(1).max(500),
  }).strict()).max(8),
  classifications: z.array(z.object({
    reviewId: z.string(), sentiment: z.enum(["positive", "neutral", "negative", "mixed"]),
    themes: z.array(z.string().min(1).max(80)).max(8),
    quote: z.string().min(1).max(500), menuItemIds: z.array(z.string()).max(8),
  }).strict()).max(30),
  draft: z.string().max(8000).nullable(),
  customObject: z.object({ name: z.string().min(1).max(120), description: text, category: z.enum(["equipment", "storage", "decoration", "other"]), width: z.number().min(.1).max(20), depth: z.number().min(.1).max(20) }).strict().nullable(),
  moves: z.array(z.object({ objectId: z.string(), x: z.number().min(0), y: z.number().min(0), reason: text }).strict()).max(5),
}).strict();
export type AiResult = z.infer<typeof aiResultSchema>;
export type AiEvidence = { id: string; label: string; detail: string };
export type AiSuccess = { ok: true; result: AiResult; evidence: AiEvidence[]; model: string; generatedAt: string; cached: boolean; inputHash: string };

export function proposedAiLayout(layout: Layout, moves: AiResult["moves"]): Layout {
  if (!moves.length || new Set(moves.map(move => move.objectId)).size !== moves.length) throw new Error(aiError);
  if (moves.some(move => !layout.objects.some(object => object.id === move.objectId))) throw new Error(aiError);
  const proposed = layoutSchema.parse({ ...layout, objects: layout.objects.map(object => {
    const move = moves.find(item => item.objectId === object.id);
    return move ? { ...object, x: move.x, y: move.y } : object;
  }) });
  for (const moved of proposed.objects.filter(object => moves.some(move => move.objectId === object.id))) {
    if (proposed.objects.some(other => other.id !== moved.id && hasOverlap(moved, other))) throw new Error(aiError);
  }
  return proposed;
}

export function validateAiResult(value: unknown, request: AiRequest, evidence: AiEvidence[], layout: Layout) {
  const result = aiResultSchema.parse(value);
  // Finance figures are rendered from canonical code, never model-authored prose.
  // Reject numeric narration instead of displaying plausible but invented calculations.
  if (request.task === "finance") {
    const prose = [result.summary, ...result.limitations, ...result.findings.flatMap(finding => [finding.title, finding.explanation, finding.action, finding.cost])].join(" ");
    if (/[\d$€£%]|\b(?:percent|percentage|dollars?|cents?|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\b/i.test(prose)) throw new Error(aiError);
  }
  const ids = new Set(evidence.map(item => item.id));
  if (result.findings.some(finding => finding.evidenceIds.some(id => !ids.has(id)))) throw new Error(aiError);
  if (new Set(result.classifications.map(item => item.reviewId)).size !== result.classifications.length) throw new Error(aiError);
  for (const row of result.classifications) {
    const source = evidence.find(item => item.id === `review:${row.reviewId}`);
    if (!source || !JSON.parse(source.detail).text.includes(row.quote) || row.menuItemIds.some(id => !ids.has(`menu:${id}`))) throw new Error(aiError);
  }
  if (request.task === "reviews" && result.classifications.length !== evidence.filter(item => item.id.startsWith("review:")).length) throw new Error(aiError);
  if (["reply", "job"].includes(request.task) && !result.draft?.trim()) throw new Error(aiError);
  if (request.task === "custom-object" && !result.customObject) throw new Error(aiError);
  if (request.task !== "custom-object" && result.customObject) throw new Error(aiError);
  if (request.task !== "floor" && result.moves.length) throw new Error(aiError);
  if (result.moves.length) proposedAiLayout(layout, result.moves);
  return result;
}
