import { z } from "zod";
import { intakeSchema } from "../../../../features/expansion/domain/intake.ts";
import { factSchema } from "../../../../features/expansion/domain/matching.ts";
import {
  createRun,
  runSchema,
} from "../../../../features/expansion/backend/runs.ts";
import { localResponse } from "../../../../features/expansion/backend/http.ts";
import { ownerRoute } from "../../../../features/expansion/backend/api.ts";

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
  return ownerRoute(request, async ({ ownerId: sessionId }) => {
    // body.sessionId is accepted for compatibility and ignored (owner = signed cookie).
    const body = bodySchema.parse(await request.json());
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
  });
}
