import { createAssistantHandler } from "../../../../features/tactical/backend/assistant/service";
export const runtime = "nodejs";
export const maxDuration = 90;
const handler = createAssistantHandler();
export const GET = handler;
export const POST = handler;
