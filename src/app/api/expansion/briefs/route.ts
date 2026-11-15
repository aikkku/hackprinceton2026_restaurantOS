import { z } from "zod";
import { localResponse } from "../../../../features/expansion/backend/http.ts";
import { ownerRoute } from "../../../../features/expansion/backend/api.ts";
import { requireRepository } from "../../../../features/expansion/backend/store.ts";
import { listBriefs, saveBrief } from "../../../../features/expansion/backend/durable.ts";

export const dynamic = "force-dynamic";

/** The owner's saved decision briefs (newest first, frozen snapshots). */
export async function GET(request: Request) {
  return ownerRoute(request, async ({ ownerId }) => {
    const repo = await requireRepository();
    return localResponse({ briefs: await listBriefs(repo, ownerId), storage: repo.mode });
  });
}

/** Save an immutable brief. Its run snapshot must match the owner's stored run. */
export async function POST(request: Request) {
  return ownerRoute(request, async ({ ownerId }) => {
    const body = z.object({ brief: z.unknown() }).strict().parse(await request.json());
    const repo = await requireRepository();
    const saved = await saveBrief(repo, {}, ownerId, body.brief, "app");
    return localResponse({ ...saved.record, result: saved.result, storage: repo.mode }, saved.result === "inserted" ? 201 : 200);
  }, { issue: false });
}
