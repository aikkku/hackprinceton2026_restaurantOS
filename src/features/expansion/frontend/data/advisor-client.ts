import { advisorRequestSchema, advisorResponseSchema, type AdvisorRequest, type AdvisorResponse } from "../../domain/advisor.ts";

export async function askAdvisor(input: AdvisorRequest, signal?: AbortSignal): Promise<AdvisorResponse> {
  const response = await fetch("/api/expansion/advisor", {
    method: "POST", credentials: "same-origin", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(advisorRequestSchema.parse(input)),
  });
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error("Sprout received an unreadable response. Please retry."); }
  if (!response.ok) {
    const failure = body as { error?: { message?: unknown } } | null;
    throw new Error(typeof failure?.error?.message === "string" ? failure.error.message : "Sprout couldn’t answer. Please retry.");
  }
  const result = advisorResponseSchema.safeParse(body);
  if (!result.success) throw new Error("Sprout received an incomplete response. Please retry.");
  return result.data;
}
