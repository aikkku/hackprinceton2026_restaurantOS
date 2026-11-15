import { z } from "zod";
import { aiError } from "../domain/ai.ts";

export class AiProviderError extends Error {
  readonly reason: string;
  readonly status?: number;
  constructor(reason: string, status?: number) { super(aiError); this.reason = reason; this.status = status; }
}

export const aiModel = () => process.env.TACTICAL_AI_MODEL ?? "gemini-2.5-flash";
// Keep the provider grammar small; the original Zod schema still validates every bound locally.
export function providerSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(providerSchema);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["$schema", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minItems", "maxItems", "format", "pattern"].includes(key)).map(([key, item]) => [key, providerSchema(item)]));
  return value;
}
export async function generateStructured<T>(schema: z.ZodType<T>, system: string, prompt: string, options: { signal?: AbortSignal; photos?: string[]; model?: string } = {}): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  const model = options.model ?? aiModel();
  if (!key || !/^gemini-[a-z0-9.-]+$/.test(model)) throw new Error(aiError);
  const jsonSchema = providerSchema(z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }));
  const signals = [AbortSignal.timeout(60_000), ...(options.signal ? [options.signal] : [])];
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    signal: AbortSignal.any(signals), redirect: "error",
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }, ...(options.photos ?? []).map(photo => {
        const [header, data] = photo.split(",");
        return { inlineData: { mimeType: header.includes("png") ? "image/png" : "image/jpeg", data } };
      })] }],
      generationConfig: { temperature: .2, maxOutputTokens: 8192, responseMimeType: "application/json", responseJsonSchema: jsonSchema },
    }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new AiProviderError("http", response.status); }
  const data = await response.json();
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason !== "STOP") throw new AiProviderError(candidate?.finishReason ?? "no-candidate");
  const raw = candidate.content?.parts?.filter((part: { text?: string; thought?: boolean }) => part.text && !part.thought).map((part: { text: string }) => part.text).join("");
  if (!raw || raw.length > 100_000) throw new Error(aiError);
  return schema.parse(JSON.parse(raw));
}
