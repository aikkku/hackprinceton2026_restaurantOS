import { agentCapabilities } from "../../../../features/expansion/backend/agent.ts";
import { localResponse } from "../../../../features/expansion/backend/http.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  return localResponse(agentCapabilities({}));
}
