import { investigationCandidate } from "../../../../../../features/expansion/backend/investigation.ts";
import { candidateImage } from "../../../../../../features/expansion/backend/investigation-sources.ts";
import { localFailure } from "../../../../../../features/expansion/backend/http.ts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const candidate = investigationCandidate(id, new URL(request.url).searchParams.get("candidateId") ?? "", request.headers.get("x-expansion-session") ?? "local");
    const bytes = await candidateImage(candidate);
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return localFailure(error); }
}
