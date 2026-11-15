import { localResponse } from "../../../../features/expansion/backend/http.ts";
import { ownerRoute } from "../../../../features/expansion/backend/api.ts";
import { requireRepository } from "../../../../features/expansion/backend/store.ts";
import { importBrowserData } from "../../../../features/expansion/backend/durable.ts";

export const dynamic = "force-dynamic";

/**
 * Explicit import of browser-saved profile drafts and decision briefs into the
 * owner's durable workspace. Per-item results; nothing is deleted anywhere —
 * the browser keeps its originals whether or not an item imports.
 */
export async function POST(request: Request) {
  return ownerRoute(request, async ({ ownerId }) => {
    const repo = await requireRepository();
    const items = await importBrowserData(repo, {}, ownerId, await request.json());
    return localResponse({ items, storage: repo.mode });
  });
}
