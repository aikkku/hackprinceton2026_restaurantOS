import { ZodError } from "zod";
import { localFailure, localResponse } from "./http.ts";
import { OwnerError, ownerFailure, resolveOwner, withOwnerCookie, type OwnerContext } from "./owner.ts";
import { getRepository, PersistenceError, type ExpansionRepository } from "./store.ts";
import { syncAgentRun } from "./durable.ts";

/**
 * Owner-scoped route wrapper. Every Expansion route that reads or writes a
 * profile, run, candidate, event, evidence snapshot or brief goes through it:
 * the owner comes only from the signed cookie (never a header, body field,
 * run id or restaurant id), and failures map to redacted envelopes.
 */
export async function ownerRoute(
  request: Request,
  handler: (owner: OwnerContext) => Promise<Response> | Response,
  options: { issue?: boolean } = {},
): Promise<Response> {
  let owner: OwnerContext;
  try {
    owner = resolveOwner(request, options);
  } catch (error) {
    if (error instanceof OwnerError) return ownerFailure(error);
    return localFailure(error);
  }
  try {
    return withOwnerCookie(await handler(owner), owner);
  } catch (error) {
    return withOwnerCookie(failure(error), owner);
  }
}

/**
 * Matches by name and code, not only `instanceof`: the repository is cached on
 * globalThis, so after a dev hot reload it throws errors built from an older
 * copy of the PersistenceError class.
 */
function isPersistenceError(error: unknown): error is PersistenceError {
  if (error instanceof PersistenceError) return true;
  return error instanceof Error && error.name === "PersistenceError" && "code" in error
    && ["persistence_unavailable", "conflict", "invalid", "not_found"].includes(String((error as { code: unknown }).code));
}

export function failure(error: unknown): Response {
  if (error instanceof OwnerError) return ownerFailure(error);
  if (isPersistenceError(error)) {
    const status = error.code === "persistence_unavailable" ? 503 : error.code === "conflict" ? 409 : error.code === "not_found" ? 404 : 400;
    return localResponse({ error: { code: error.code, message: error.message } }, status);
  }
  if (error instanceof ZodError) return localResponse({ error: { code: "invalid_query", message: "The request failed validation." } }, 400);
  return localFailure(error);
}

/** Best-effort, non-blocking mirror of a run into durable storage. */
export function scheduleRunSync(ownerId: string, runId: string): void {
  void getRepository()
    .then((repo: ExpansionRepository | null) => (repo ? syncAgentRun(repo, {}, ownerId, runId) : null))
    .catch(() => {
      /* durable mirroring never breaks the live run path; health reports storage state */
    });
}

export const isNotFound = (error: unknown) =>
  !!error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === "not_found";
