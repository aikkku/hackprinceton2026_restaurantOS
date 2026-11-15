import type { Dataset } from "../domain/dataset.ts";
import { onboardingRequestSchema, summarizeOnboarding } from "../domain/onboarding.ts";
import { boundedJson, sameOrigin } from "./ai-access.ts";

// Read-only: opens the same server-selected mock dataset used by every Tactical page.
// Does not create an account, write a dataset, or accept files/business details.
export function createOnboardingHandler(load: () => Promise<{ dataset: Dataset; source: string; revision: number | null }>) {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  return async (request: Request) => {
    if (!sameOrigin(request)) return reply({ error: "Request not allowed." }, 403);
    try {
      onboardingRequestSchema.parse(await boundedJson(request, 1024));
    } catch {
      return reply({ error: "Select Demo to open the sample restaurant. Document processing is not available yet." }, 422);
    }
    try {
      const { dataset, source, revision } = await load();
      return reply({ ok: true, restaurant: summarizeOnboarding(dataset, source, revision) });
    } catch {
      return reply({ error: "The demo restaurant is unavailable right now. Your selections are still here. Please try again." }, 503);
    }
  };
}
