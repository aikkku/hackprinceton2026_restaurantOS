import { z } from "zod";
import { localResponse } from "../../../../../features/expansion/backend/http.ts";
import { ownerRoute } from "../../../../../features/expansion/backend/api.ts";
import { PersistenceError, requireRepository } from "../../../../../features/expansion/backend/store.ts";
import { loadProfile } from "../../../../../features/expansion/backend/durable.ts";

export const dynamic = "force-dynamic";

const profileIdSchema = z.string().min(1).max(200);

/** One owner profile's envelope, rebuilt from its immutable revisions. */
export async function GET(request: Request, context: { params: Promise<{ profileId: string }> }) {
  return ownerRoute(request, async ({ ownerId }) => {
    const profileId = profileIdSchema.parse((await context.params).profileId);
    const repo = await requireRepository();
    const envelope = await loadProfile(repo, ownerId, profileId);
    if (!envelope) throw new PersistenceError("not_found", "That restaurant profile isn’t in your workspace.");
    return localResponse({ envelope, storage: repo.mode });
  });
}
