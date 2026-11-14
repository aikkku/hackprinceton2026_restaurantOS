import { queryLocalDataset } from "../../../../features/expansion/backend/local-dataset.ts";
import { localFailure, localResponse } from "../../../../features/expansion/backend/http.ts";
import { parseLocalQuery, queryResponseSchema } from "../../../../features/expansion/domain/local-data.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let query;
  try { query = parseLocalQuery(new URL(request.url).searchParams); }
  catch { return localResponse({error: {code: "invalid_query", message: "Provide a city, ordered viewport bounds (at most five degrees), valid filters, limit 1–200 and offset 0–10000."}}, 400); }
  try {
    const result = await queryLocalDataset(query);
    // Output schema errors are source failures, not invalid client queries.
    const parsed = queryResponseSchema.safeParse(result);
    if (!parsed.success) return localFailure(new Error("Invalid normalized source"));
    return localResponse(parsed.data);
  } catch (error) { return localFailure(error); }
}
