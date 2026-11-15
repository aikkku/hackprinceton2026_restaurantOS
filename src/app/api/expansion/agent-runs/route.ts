import { z } from "zod";
import { intakeSchema } from "../../../../features/expansion/domain/intake.ts";
import { factSchema } from "../../../../features/expansion/domain/matching.ts";
import {
  agentRunCreateSchema,
  agentRunRecordSchema,
} from "../../../../features/expansion/domain/agent.ts";
import { createAgentRun, findActiveAgentRun, listAgentRuns } from "../../../../features/expansion/backend/agent.ts";
import { localResponse } from "../../../../features/expansion/backend/http.ts";
import { ownerRoute, scheduleRunSync } from "../../../../features/expansion/backend/api.ts";
import { getRepository } from "../../../../features/expansion/backend/store.ts";
import { listDurableRuns } from "../../../../features/expansion/backend/durable.ts";

export const dynamic = "force-dynamic";

const bodySchema = agentRunCreateSchema.extend({
  runId: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  // Accepted for backward compatibility and ignored: the owner comes from the signed cookie.
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
  cityId: z.string().min(1).max(100),
  intake: intakeSchema,
  revisionId: z.string().min(1).max(200),
  revisionNumber: z.number().int().nonnegative(),
  facts: z.array(factSchema).max(10000).optional(),
  executionMode: z.enum(["live", "scripted"]).optional(),
});

export async function POST(request: Request) {
  return ownerRoute(request, async ({ ownerId }) => {
    const body = bodySchema.parse(await request.json());
    const input = {
      cityId: body.cityId,
      intake: body.intake,
      revisionId: body.revisionId,
      revisionNumber: body.revisionNumber,
      facts: body.facts,
      executionMode: body.executionMode,
    };
    // Duplicate submission (double click, retried request with a new id):
    // an active run for the same owner + requirements + mode is returned.
    const active = findActiveAgentRun({}, ownerId, input);
    if (active && active.runId !== body.runId) {
      const response = localResponse(agentRunRecordSchema.parse(active), 200);
      response.headers.set("X-Expansion-Deduplicated", "1");
      return response;
    }
    const result = await createAgentRun({}, { ...input, runId: body.runId, sessionId: ownerId });
    scheduleRunSync(ownerId, body.runId);
    return localResponse(agentRunRecordSchema.parse(result.record), result.created ? 201 : 200);
  });
}

/** The owner's runs: run-directory records, plus durable-only records (e.g. after a host move). */
export async function GET(request: Request) {
  return ownerRoute(request, async ({ ownerId }) => {
    const local = listAgentRuns({}, ownerId);
    const seen = new Set(local.map(run => run.runId));
    let durable: typeof local = [];
    let storage: "ok" | "unavailable" | "off" = "off";
    const repo = await getRepository();
    if (repo) {
      try { durable = (await listDurableRuns(repo, ownerId)).filter(run => !seen.has(run.runId)); storage = "ok"; }
      catch { storage = "unavailable"; }
    }
    const runs = [...local, ...durable].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
    return localResponse({ runs, storage });
  });
}
