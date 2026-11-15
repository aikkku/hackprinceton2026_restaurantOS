import { z } from "zod";
import { localResponse } from "../../../../features/expansion/backend/http.ts";
import { ownerRoute } from "../../../../features/expansion/backend/api.ts";
import {
  accessCodeRequired,
  checkAccessCode,
  clearOwnerCookieHeader,
  newOwnerId,
  OwnerError,
  ownerFailure,
  OWNER_COOKIE,
  readCookie,
  setOwnerCookieHeader,
  verifyOwnerCookie,
} from "../../../../features/expansion/backend/owner.ts";
import { getRepository, persistenceMode } from "../../../../features/expansion/backend/store.ts";

export const dynamic = "force-dynamic";

async function storage() {
  const repo = await getRepository().catch(() => null);
  return { mode: repo?.mode ?? persistenceMode(), configured: repo !== null };
}

/** Ensure a private owner session (issues the signed cookie when allowed). */
export async function GET(request: Request) {
  if (accessCodeRequired() && !verifyOwnerCookie(readCookie(request, OWNER_COOKIE))) {
    return localResponse({ authenticated: false, accessCodeRequired: true, storage: await storage() });
  }
  return ownerRoute(request, async (owner) => localResponse({
    authenticated: true,
    issued: owner.issued,
    accessCodeRequired: accessCodeRequired(),
    ownerHint: owner.ownerId.slice(0, 6),
    storage: await storage(),
  }));
}

/** Unlock with the deployment access code (only when EXPANSION_ACCESS_CODE is set). */
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== (request.headers.get("host") ?? new URL(request.url).host)) {
      return ownerFailure(new OwnerError("forbidden", "Cross-origin session requests are rejected."));
    }
    const body = z.object({ accessCode: z.string().max(256) }).strict().parse(await request.json());
    if (!accessCodeRequired()) return GET(request);
    if (!checkAccessCode(body.accessCode)) return ownerFailure(new OwnerError("unauthenticated", "The access code is incorrect."));
    const existing = verifyOwnerCookie(readCookie(request, OWNER_COOKIE));
    const ownerId = existing ?? newOwnerId();
    const response = localResponse({ authenticated: true, issued: !existing, accessCodeRequired: true, ownerHint: ownerId.slice(0, 6), storage: await storage() });
    response.headers.append("Set-Cookie", setOwnerCookieHeader(request, ownerId));
    return response;
  } catch (error) {
    if (error instanceof OwnerError) return ownerFailure(error);
    return localResponse({ error: { code: "invalid_query", message: "Send a JSON body with an accessCode string." } }, 400);
  }
}

/** Sign out of this browser's owner session (server data is kept). */
export async function DELETE() {
  const response = localResponse({ authenticated: false });
  response.headers.append("Set-Cookie", clearOwnerCookieHeader());
  return response;
}
