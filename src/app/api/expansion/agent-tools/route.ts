import {
  AGENT_BRIDGE_TOOLS,
  toolBridgeRequestSchema,
} from "../../../../features/expansion/domain/agent.ts";
import {
  AgentToolError,
  invokeAgentTool,
  verifyToolToken,
} from "../../../../features/expansion/backend/agent.ts";
import { localResponse } from "../../../../features/expansion/backend/http.ts";
import { RunError } from "../../../../features/expansion/backend/runs.ts";
import { ToolError } from "../../../../features/expansion/domain/tools.ts";
import { ZodError } from "zod";

export const dynamic = "force-dynamic";

/**
 * Authenticated, run-scoped tool bridge for the Python worker.
 * Authorization is a per-run bearer token; every tool is bound to the run's
 * profile revision, dataset snapshot and candidate IDs. Nothing else can be
 * reached through this route.
 */
export async function POST(request: Request) {
  try {
    const body = toolBridgeRequestSchema.parse(await request.json());
    const sessionId = body.sessionId ?? "local";
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(sessionId)) {
      return localResponse({ ok: false, error: { code: "invalid_run", message: "Invalid session identifier." } }, 400);
    }
    const auth = request.headers.get("authorization");
    if (!(AGENT_BRIDGE_TOOLS as readonly string[]).includes(body.tool)) {
      return localResponse(
        { ok: false, error: { code: "unknown_tool", message: `Unknown tool "${body.tool}".` } },
        400,
      );
    }
    if (!verifyToolToken({}, sessionId, body.runId, auth)) {
      return localResponse(
        { ok: false, error: { code: "unauthorized", message: "The tool token is missing or invalid." } },
        401,
      );
    }
    const output = await invokeAgentTool({}, sessionId, body.runId, body.tool, body.input);
    return localResponse({ ok: true, output });
  } catch (error) {
    if (error instanceof AgentToolError) {
      const status =
        error.code === "unauthorized" ? 401
        : error.code === "not_found" ? 404
        : error.code === "conflict" ? 409
        : 400;
      return localResponse({ ok: false, error: { code: error.code, message: error.message } }, status);
    }
    if (error instanceof ToolError) {
      return localResponse({ ok: false, error: { code: error.code, message: error.message } }, 400);
    }
    if (error instanceof RunError) {
      const status = error.code === "not_found" ? 404 : error.code === "conflict" ? 409 : 400;
      return localResponse({ ok: false, error: { code: error.code, message: error.message } }, status);
    }
    if (error instanceof ZodError) {
      return localResponse(
        { ok: false, error: { code: "invalid_input", message: "The tool input failed validation." } },
        400,
      );
    }
    return localResponse(
      { ok: false, error: { code: "source_failure", message: "The tool bridge failed; no source details were exposed." } },
      503,
    );
  }
}
