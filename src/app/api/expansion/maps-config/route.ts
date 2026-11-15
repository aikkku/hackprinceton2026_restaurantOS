import { mapsBrowserConfig } from "../../../../features/expansion/backend/maps-config.ts";
import { localResponse } from "../../../../features/expansion/backend/http.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Read at runtime so the browser key can change without a rebuild. */
export function GET() {
  return localResponse(mapsBrowserConfig());
}
