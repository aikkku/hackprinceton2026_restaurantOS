import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { NEIGHBORHOOD_LABEL, NEIGHBORHOOD_LIMITATION, NEIGHBORHOOD_METHOD, NEIGHBORHOOD_SOURCE, NEIGHBORHOOD_VERSION, locateNeighborhood, neighborhoodCatalog, neighborhoodCatalogSchema, neighborhoodCollectionSchema, neighborhoodDatasetSchema, type NeighborhoodDataset } from "../domain/neighborhood.ts";
import { openDatabase } from "./local-dataset.ts";
import { EVIDENCE_VERSION, sourceObservationSchema, sourceSnapshotSchema, type SourceObservation, type SourceSnapshot } from "../domain/evidence.ts";
import type { SpaceCandidate } from "../domain/matching.ts";

const cacheFile = () => resolve("src/features/expansion/data/data/official-neighborhoods.json");
let pending: Promise<NeighborhoodDataset> | null = null;
const fresh = (data: NeighborhoodDataset) => Date.now() - Date.parse(data.retrievedAt) < 86_400_000;

/** Public City GIS only. Cache contains real polygons and their actual retrieval date. */
export async function loadOfficialNeighborhoods(fetcher: typeof fetch = fetch): Promise<NeighborhoodDataset> {
  const load = async () => {
    try {
      if (fetcher !== fetch) throw new Error("Injected source: use injected response, not local cache.");
      const data = neighborhoodDatasetSchema.parse(JSON.parse(await readFile(cacheFile(), "utf8")));
      if (fresh(data)) return data;
    } catch { /* Cache missing/malformed/expired: fetch the real source, never a fixture. */ }
    if (process.env.EXPANSION_SOURCE_NETWORK === "0") throw new Error("Official neighborhood network lookup is disabled.");
    const query = new URLSearchParams({ where: "1=1", outFields: "POLYID,SNBNAME,OBJECTID,SnbrInfoURL", returnGeometry: "true", outSR: "4326", f: "geojson" });
    const response = await fetcher(`${NEIGHBORHOOD_SOURCE}/query?${query}`, { signal: AbortSignal.timeout(20_000), redirect: "error", cache: "no-store", headers: { "User-Agent": "RestaurantOS/0.1 (public neighborhood boundary lookup)" } });
    if (!response.ok) throw new Error("City neighborhood source unavailable.");
    const raw = await response.text();
    if (raw.length > 8_000_000) throw new Error("City neighborhood response exceeds limit.");
    const collection = neighborhoodCollectionSchema.parse(JSON.parse(raw));
    // The official catalog has 88 polygons; incomplete queries must not look complete.
    if (new Set(collection.features.map(f => f.properties.POLYID)).size !== 88) throw new Error("City neighborhood boundary query is incomplete.");
    const data = neighborhoodDatasetSchema.parse({ version: NEIGHBORHOOD_VERSION, sourceUrl: NEIGHBORHOOD_SOURCE,
      sourceDate: null, retrievedAt: new Date().toISOString(), collection });
    try {
      if (fetcher !== fetch) return data;
      await mkdir(dirname(cacheFile()), { recursive: true });
      const temporary = `${cacheFile()}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(data));
      await rename(temporary, cacheFile());
    } catch { /* Read-only hosts can still serve the just-retrieved real data. */ }
    return data;
  };
  if (fetcher !== fetch) return load();
  if (pending) return pending;
  pending = load();
  try { return await pending; } finally { pending = null; }
}

export function officialNeighborhoodObservation(candidate: SpaceCandidate, dataset: NeighborhoodDataset, now = new Date().toISOString()): SourceObservation | null {
  if (candidate.isDemo || candidate.cityId.toLowerCase() !== "houston" || candidate.longitude === null || candidate.latitude === null) return null;
  const match = locateNeighborhood(dataset, candidate.longitude, candidate.latitude);
  if (!match) return null;
  const recordId = `${NEIGHBORHOOD_VERSION}:${match.POLYID}`;
  return sourceObservationSchema.parse({
    id: `official-neighborhood:${candidate.id}:${match.POLYID}`, provider: "neighborhood", candidateId: candidate.id,
    scope: "site", sourceRecordId: recordId, sourceDate: dataset.sourceDate, retrievedAt: dataset.retrievedAt,
    origin: "derived", isSynthetic: false, label: NEIGHBORHOOD_LABEL,
    details: [`${match.SNBNAME} · Super Neighborhood ${match.POLYID}`, `Property coordinates ${candidate.latitude}, ${candidate.longitude} fall inside the City boundary polygon.`, `City GIS boundaries retrieved ${dataset.retrievedAt}.`],
    limitations: [NEIGHBORHOOD_LIMITATION], referenceUrl: NEIGHBORHOOD_SOURCE, viewerUrl: null, exportAllowed: true,
    facts: [{ id: `official-neighborhood-fact:${candidate.id}`, entityScope: "space", entityId: candidate.id,
      field: "neighborhood", value: { kind: "exact", value: match.SNBNAME }, unit: null, origin: "derived",
      source: { label: NEIGHBORHOOD_LABEL, recordId, capturedAt: now }, method: NEIGHBORHOOD_METHOD,
      limitations: [NEIGHBORHOOD_LIMITATION], isDemo: false }],
  });
}

export function neighborhoodSnapshot(candidate: SpaceCandidate, dataset: NeighborhoodDataset, now = new Date().toISOString()): SourceSnapshot {
  const observation = officialNeighborhoodObservation(candidate, dataset, now);
  const reason = observation ? "Property assigned using official City of Houston boundary polygons." : candidate.isDemo ? "Synthetic listing: not assigned a real neighborhood." : "No unique City Super Neighborhood polygon contains this property's sourced coordinates; no neighborhood guessed.";
  return sourceSnapshotSchema.parse({ version: EVIDENCE_VERSION, candidateId: candidate.id, refreshedAt: now,
    observations: observation ? [observation] : [], gaps: observation ? [] : [reason],
    statuses: [{ provider: "neighborhood", status: observation ? "verified" : "outside_coverage", mode: observation ? "live" : "unavailable", checkedAt: now, capabilities: [NEIGHBORHOOD_VERSION], reason }],
  });
}

/** Top eight by actual compatible marketed suite count, not an invented popularity score. */
export function topNeighborhoodCatalog(dataset: NeighborhoodDataset) {
  const db = openDatabase();
  try {
    const metadata = JSON.parse(String(db.prepare("SELECT value FROM meta WHERE key='metadata'").get()?.value));
    if (/^synthetic[-_]/.test(metadata.datasetId ?? "")) throw new Error("Real listing data required for neighborhood ranking.");
    const rows = db.prepare("SELECT id,lat,lon FROM spaces WHERE city_id='houston' AND status_code=1 AND space_use IN (3,5) AND lat IS NOT NULL AND lon IS NOT NULL").all() as { id: string; lat: number; lon: number }[];
    const counts = new Map<number, number>();
    for (const row of rows) {
      const match = locateNeighborhood(dataset, row.lon, row.lat);
      if (match) counts.set(match.POLYID, (counts.get(match.POLYID) ?? 0) + 1);
    }
    const catalog = neighborhoodCatalog(dataset);
    return neighborhoodCatalogSchema.parse({ ...catalog, datasetId: metadata.datasetId,
      rankingBasis: "Top eight by active-snapshot Retail / Office-Retail offered-space count in the imported CoStar dataset. This is listing coverage, not neighborhood popularity or predicted success.",
      neighborhoods: catalog.neighborhoods.map(n => ({ ...n, listingCount: counts.get(n.id) ?? 0 })).filter(n => n.listingCount > 0)
        .sort((a, b) => b.listingCount - a.listingCount || a.name.localeCompare(b.name)).slice(0, 8) });
  } finally { db.close(); }
}
