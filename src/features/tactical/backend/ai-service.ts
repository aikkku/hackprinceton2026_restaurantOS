import { createHash } from "node:crypto";
import type { Dataset } from "../domain/dataset.ts";
import { aiRequestSchema, aiResultSchema, validateAiResult, type AiSuccess } from "../domain/ai.ts";
import { buildAiContext, aiPromptVersion, aiSystemPrompt } from "./ai-context.ts";
import { generateStructured, aiModel } from "./gemini.ts";
import { authorizedAi, sameOrigin, boundedJson, aiFailure, takeAiBudget } from "./ai-access.ts";

type Dependencies = { load: () => Promise<Dataset>; generate?: typeof generateStructured; authorize?: typeof authorizedAi; budget?: typeof takeAiBudget };
export function createAiHandler({ load, generate = generateStructured, authorize = authorizedAi, budget = takeAiBudget }: Dependencies) {
  const cache = new Map<string, { expires: number; value: AiSuccess }>();
  let running = 0;
  return async (request: Request) => {
    if (!sameOrigin(request)) return aiFailure(403);
    if (!authorize(request)) return aiFailure(401);
    try {
      const input = aiRequestSchema.parse(await boundedJson(request, 1024 * 1024));
      const dataset = await load();
      const { layout, evidence } = buildAiContext(dataset, input);
      const model = aiModel();
      const prompt = JSON.stringify({ task: input.task, question: input.question, selectedReviewId: input.reviewId, evidence });
      if (prompt.length > 120_000) return aiFailure(413);
      const key = createHash("sha256").update(JSON.stringify({ model, aiPromptVersion, prompt })).digest("hex");
      const existing = cache.get(key);
      if (existing && existing.expires > Date.now()) return Response.json({ ...existing.value, cached: true }, { headers: { "Cache-Control": "no-store" } });
      if (running >= 2 || !budget("generate")) return aiFailure(429);
      running++;
      try {
        const generated = await generate(aiResultSchema, aiSystemPrompt, prompt, { signal: request.signal });
        const result = validateAiResult(generated, input, evidence, layout);
        const value: AiSuccess = { ok: true, result, evidence, model, generatedAt: new Date().toISOString(), cached: false, inputHash: key };
        if (cache.size >= 50) cache.delete(cache.keys().next().value!);
        cache.set(key, { expires: Date.now() + 10 * 60_000, value });
        return Response.json(value, { headers: { "Cache-Control": "no-store" } });
      } finally { running--; }
    } catch { return aiFailure(); }
  };
}
