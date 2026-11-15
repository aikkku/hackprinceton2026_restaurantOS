import { ZodError } from "zod";

const headers = { "Cache-Control": "private, no-store" };
export function localResponse(value: unknown, status = 200) {
  return Response.json(value, { status, headers });
}

/** Never return SQLite errors, local paths or source payloads to clients. */
export function localFailure(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "not_configured") return localResponse({error: {code, message: "Local dataset is not configured. Set EXPANSION_DB_PATH and run the local import command on this computer."}}, 503);
  if (code === "not_found") return localResponse({error: {code, message: "The requested run does not exist in the current session."}}, 404);
  if (code === "conflict") return localResponse({error: {code, message: "The run is in a terminal state, has no candidates yet, or its identifier is already in use with different requirements."}}, 409);
  if (code === "invalid_run") return localResponse({error: {code, message: "The run identifier or request is invalid."}}, 400);
  if (error instanceof ZodError || code === "invalid_query") return localResponse({error: {code: "invalid_query", message: "Choose a supported city and valid bounded query, filters and pagination."}}, 400);
  return localResponse({error: {code: "source_failure", message: "The local dataset could not be read. Check its configuration or rebuild the cache, then retry."}}, 503);
}
