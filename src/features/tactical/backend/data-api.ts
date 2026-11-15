import { timingSafeEqual } from "node:crypto";
import { reviewProcessor } from "./review-analysis.ts";
import { restaurantIdSchema, uploadSchema, type Dataset } from "../domain/dataset.ts";
import { mongoDatasets, type DatasetRepository } from "./mongodb.ts";

export const maxDatasetBytes = 1_048_576;
class InputError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function authorize(request: Request) {
  const configured = process.env.TACTICAL_API_TOKEN;
  if (!configured || configured.length < 32) return json({ error: "Configure TACTICAL_API_TOKEN with at least 32 characters on the server." }, 503);
  const value = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${configured}`);
  const actual = Buffer.from(value);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return json({ error: "Unauthorized" }, 401);
  return null;
}
export async function readBoundedJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new InputError(415, "Use application/json.");
  if (!request.body) throw new InputError(400, "JSON body required.");
  const reader = request.body.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxDatasetBytes) { await reader.cancel(); throw new InputError(413, "Dataset request exceeds 1 MB."); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new InputError(400, "Invalid JSON."); }
}
export function createDataApi(repository: DatasetRepository, onSaved?: (dataset: Dataset) => Promise<{ pending: number }>) {
  return async function handle(request: Request, id?: string, validateOnly = false) {
    const denied = authorize(request);
    if (denied) return denied;
    if (id !== undefined && !restaurantIdSchema.safeParse(id).success) return json({ error: "Invalid restaurant ID." }, 400);
    try {
      if (request.method === "GET") {
        if (!id) return json({ restaurants: await repository.list(), limit: 100, source: "mongodb" });
        const record = await repository.read(id);
        return record ? json({ ...record, source: "mongodb" }) : json({ error: "Dataset not found. Upload it first." }, 404);
      }
      if (request.method !== "PUT" && !(validateOnly && request.method === "POST")) return json({ error: "Method not allowed." }, 405);
      const parsed = uploadSchema.safeParse(await readBoundedJson(request));
      if (!parsed.success) return json({ error: "Invalid mock dataset.", issues: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) }, 422);
      if (id && parsed.data.dataset.profile.id !== id) return json({ error: "Restaurant ID does not match the URL." }, 422);
      if (validateOnly) return json({ valid: true, restaurantId: parsed.data.dataset.profile.id, datasetVersion: 1, isDemo: true });
      if (!id) return json({ error: "Restaurant ID required." }, 400);
      const record = await repository.save(parsed.data.dataset, parsed.data.expectedRevision);
      let reviewAnalysis: { pending?: number; error?: string } | undefined;
      if (record && onSaved) {
        try { reviewAnalysis = { pending: (await onSaved(record.dataset)).pending }; }
        catch { reviewAnalysis = { error: "Something is wrong" }; }
      }
      return record ? json({ reviewAnalysis, id: record._id, revision: record.revision, updatedAt: record.updatedAt, source: "mongodb", isDemo: true }, parsed.data.expectedRevision === 0 ? 201 : 200) : json({ error: "Revision conflict. Fetch the current dataset and review changes before retrying." }, 409);
    } catch (error) {
      if (error instanceof InputError) return json({ error: error.message }, error.status);
      return json({ error: "Database unavailable or stored data invalid. Check server configuration and database access; no demo fallback was substituted." }, 503);
    }
  };
}
export const handleDatasetRequest = createDataApi(mongoDatasets, dataset => reviewProcessor.process(dataset));
