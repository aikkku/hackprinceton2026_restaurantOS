import { z } from "zod";
import { intakeSchema } from "../../../../features/expansion/domain/intake.ts";
import { factSchema } from "../../../../features/expansion/domain/matching.ts";
import {
  createRun,
  runSchema,
} from "../../../../features/expansion/backend/runs.ts";
import { localFailure, localResponse } from "../../../../features/expansion/backend/http.ts";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  runId: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
  cityId: z.string().min(1).max(100),
  intake: intakeSchema,
  revisionId: z.string().min(1).max(200),
  revisionNumber: z.number().int().nonnegative(),
  facts: z.array(factSchema).max(10000).optional(),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const sessionId = request.headers.get("x-expansion-session") ?? body.sessionId ?? "local";
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(sessionId)) {
      return localResponse({ error: { code: "invalid_run", message: "Invalid session identifier." } }, 400);
    }
    const result = await createRun({}, {
      runId: body.runId,
      sessionId,
      cityId: body.cityId,
      intake: body.intake,
      revisionId: body.revisionId,
      revisionNumber: body.revisionNumber,
      facts: body.facts,
    });
    return localResponse(runSchema.parse(result.record), result.created ? 201 : 200);
  } catch (error) {
    return localFailure(error);
  }
}
