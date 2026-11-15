import { z } from "zod";
import { investigationRunSchema, type InvestigationRun } from "../../domain/decision-brief.ts";
import { sourceSnapshotSchema } from "../../domain/evidence.ts";

async function read(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 404 ? "Run or evidence not found in this session." : "Investigation could not load. Retry without changing saved evidence.");
  return response.json();
}
/** Read-only adapter for the existing Phase 3 v1 APIs. No alternate run system. */
export async function loadInvestigationRun(runId: string, signal?: AbortSignal): Promise<InvestigationRun> {
  z.string().regex(/^[a-zA-Z0-9-]{1,64}$/).parse(runId);
  const root = `/api/expansion/agent-runs/${encodeURIComponent(runId)}`;
  const names = ["profile", "candidates", "summary", "market", "inspection", "finance"] as const;
  const [run, ...artifacts] = await Promise.all([read(root, signal), ...names.map(name => read(`${root}/artifacts/${name}`, signal).catch(error => {
    if (["market", "inspection", "finance"].includes(name) && !signal?.aborted) return null;
    throw error;
  }))]);
  return investigationRunSchema.parse({ run, profile: artifacts[0], search: artifacts[1], summary: artifacts[2], market: artifacts[3], inspection: artifacts[4], finance: artifacts[5] });
}
export async function refreshCandidateSources(runId: string, candidateId: string, options: { currentAddress: string | null; priceLevel: number | null; sourceMode?: "live" | "synthetic" }, signal?: AbortSignal) {
  const params = new URLSearchParams({ candidateId });
  if (options.sourceMode === "synthetic") params.set("sourceMode", "synthetic");
  if (options.currentAddress) params.set("currentAddress", options.currentAddress);
  if (options.priceLevel !== null) params.set("priceLevel", String(options.priceLevel));
  return sourceSnapshotSchema.parse(await read(`/api/expansion/investigations/${encodeURIComponent(runId)}?${params}`, signal));
}
