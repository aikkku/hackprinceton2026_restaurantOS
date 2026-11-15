import { readFile } from "node:fs/promises";
import { datasetSchema } from "../domain/dataset.ts";

const command = process.argv[2];
try {
  const token = process.env.TACTICAL_API_TOKEN;
  if (!token || token.length < 32) throw new Error("Missing API token");
  const base = new URL(process.env.TACTICAL_API_BASE_URL ?? "http://127.0.0.1:3000");
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))) throw new Error("Use HTTPS for remote APIs");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  let path: string;
  let body: string | undefined;
  let method = "GET";
  if (command === "list") path = "/api/tactical/restaurants";
  else if (command === "get") path = `/api/tactical/restaurants/${encodeURIComponent(process.argv[3] ?? "juniper-table")}/dataset`;
  else if (command === "upload" || command === "validate") {
    const dataset = datasetSchema.parse(JSON.parse(await readFile(process.argv[3] ?? new URL("../frontend/data/demo-restaurant.json", import.meta.url), "utf8")));
    const expectedRevision = Number(process.argv[4] ?? 0);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("Invalid revision");
    body = JSON.stringify({ expectedRevision, dataset });
    if (Buffer.byteLength(body) > 1_048_576) throw new Error("Request too large");
    path = command === "validate" ? "/api/tactical/datasets/validate" : `/api/tactical/restaurants/${dataset.profile.id}/dataset`;
    method = command === "validate" ? "POST" : "PUT";
  } else throw new Error("Use list, get, validate or upload");
  const response = await fetch(new URL(path, base), { method, headers, body, signal: AbortSignal.timeout(15000), redirect: "error" });
  const result = await response.json();
  if (!response.ok) { console.error(`API returned ${response.status}. ${result.error ?? "Request failed"}`); process.exitCode = 1; }
  else console.log(JSON.stringify(result, null, 2));
} catch {
  console.error("API operation failed. Check local configuration, dataset, server URL and connection. Credentials are not logged.");
  process.exitCode = 1;
}
