import { investigationCandidate } from "../../../../../../features/expansion/backend/investigation.ts";
import { candidateImage } from "../../../../../../features/expansion/backend/investigation-sources.ts";
import { ownerRoute } from "../../../../../../features/expansion/backend/api.ts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return ownerRoute(request, async ({ ownerId }) => {
    const { id } = await context.params;
    const candidate = investigationCandidate(id, new URL(request.url).searchParams.get("candidateId") ?? "", ownerId);
    const bytes = await candidateImage(candidate);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }, { issue: false });
}
