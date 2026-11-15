import { z } from "zod";
import { localResponse } from "../../../../features/expansion/backend/http.ts";
import { ownerRoute } from "../../../../features/expansion/backend/api.ts";
import { requireRepository } from "../../../../features/expansion/backend/store.ts";
import { listProfiles, saveProfileEnvelope } from "../../../../features/expansion/backend/durable.ts";

export const dynamic = "force-dynamic";

/** The owner's restaurant profiles (summaries, most recently updated first). */
export async function GET(request: Request) {
  return ownerRoute(request, async ({ ownerId }) => {
    const repo = await requireRepository();
    return localResponse({ profiles: await listProfiles(repo, ownerId), storage: repo.mode });
  });
}

/**
 * Create a profile or append revisions to one (insert-only; an existing
 * revision id with other content is a 409). A profile's id is its revision 0 id.
 */
export async function POST(request: Request) {
  return ownerRoute(request, async ({ ownerId }) => {
    const body = z.object({ envelope: z.unknown() }).strict().parse(await request.json());
    const repo = await requireRepository();
    const report = await saveProfileEnvelope(repo, ownerId, body.envelope, "app");
    return localResponse({ ...report, storage: repo.mode });
  });
}
