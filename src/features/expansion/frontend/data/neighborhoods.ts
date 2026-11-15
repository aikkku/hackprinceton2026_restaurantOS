import { z } from "zod";
import { neighborhoodCatalogSchema } from "../../domain/neighborhood.ts";
import { sourceSnapshotSchema, type SourceSnapshot } from "../../domain/evidence.ts";
import { ensureSession } from "./account-client.ts";

export async function loadNeighborhoodCatalog(signal?: AbortSignal) {
  await ensureSession();
  const response = await fetch("/api/expansion/neighborhoods", { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Official neighborhood catalog is unavailable.");
  return neighborhoodCatalogSchema.parse(await response.json());
}

export async function loadRunNeighborhoods(runId: string, source: "agent" | "deterministic", signal?: AbortSignal) {
  await ensureSession();
  const response = await fetch("/api/expansion/neighborhoods", { method: "POST", signal, cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, source }) });
  if (!response.ok) throw new Error("Official neighborhood assignment is unavailable.");
  return z.object({ catalog: neighborhoodCatalogSchema, snapshots: z.array(sourceSnapshotSchema) }).parse(await response.json());
}

export function mergeOfficialNeighborhood(existing: SourceSnapshot | undefined, incoming: SourceSnapshot): SourceSnapshot {
  if (!existing) return incoming;
  const replacedIds = new Set(existing.observations.filter(o => o.provider === "neighborhood").map(o => o.id));
  return sourceSnapshotSchema.parse({ ...existing,
    refreshedAt: incoming.refreshedAt,
    observations: [...existing.observations.filter(o => o.provider !== "neighborhood"), ...incoming.observations.filter(o => o.provider === "neighborhood")],
    statuses: [...existing.statuses.filter(s => s.provider !== "neighborhood"), ...incoming.statuses.filter(s => s.provider === "neighborhood")],
    gaps: [...existing.gaps.filter(g => !g.startsWith("neighborhood:")), ...incoming.gaps],
    ...(existing.propertyInference ? { propertyInference: { ...existing.propertyInference, evidenceIds: existing.propertyInference.evidenceIds.filter(id => !replacedIds.has(id)) } } : {}),
  });
}
