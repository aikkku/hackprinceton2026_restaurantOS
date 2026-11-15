import { handleAdvisorRequest } from "../../../../features/expansion/backend/advisor.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleAdvisorRequest(request);
}
