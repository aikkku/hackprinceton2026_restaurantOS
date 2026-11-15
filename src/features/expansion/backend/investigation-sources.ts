import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { EVIDENCE_VERSION, providerNames, providerStatusSchema, sourceObservationSchema, sourceSnapshotSchema, type SourceObservation, type SourceSnapshot } from "../domain/evidence.ts";
import { acsObservation, contextGaps, mapMatterport, mapVexcel, parseAcsResponse, ACS_VARIABLES } from "../domain/source-adapters.ts";
import type { SpaceCandidate } from "../domain/matching.ts";
import { inferProperty } from "./property-inference.ts";
import type { PropertyInference } from "../domain/property-inference.ts";
import { loadOfficialNeighborhoods, neighborhoodSnapshot } from "./neighborhoods.ts";
import type { NeighborhoodDataset } from "../domain/neighborhood.ts";

const execute = promisify(execFile);
const probeSchema = z.object({ status: providerStatusSchema.shape.status, reason: z.string().min(1), link: z.unknown().optional(), model: z.unknown().optional(), image: z.unknown().optional(), imageFile: z.string().optional() });
export type SourceDependencies = { fetch?: typeof fetch; probe?: typeof probeSource; network?: boolean; now?: () => string; neighborhoodDataset?: NeighborhoodDataset; censusApiKey?: string; onNeighborhood?: (snapshot: SourceSnapshot) => void };
export async function probeSource(provider: "matterport" | "vexcel", candidate: SpaceCandidate) {
  const helperVenv = resolve("src/features/expansion/data/.venv-helper", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const python = process.env.EXPANSION_EVIDENCE_PYTHON || (existsSync(helperVenv) ? helperVenv : "python");
  const result = await execute(python, [resolve("src/features/expansion/backend/source_probe.py"), provider, candidate.propertyId, String(candidate.latitude), String(candidate.longitude)], { windowsHide: true, timeout: 105_000, maxBuffer: 128 * 1024 });
  return probeSchema.parse(JSON.parse(result.stdout));
}
const geoSchema = z.object({ result: z.object({ geographies: z.object({ "Census Tracts": z.array(z.object({ STATE: z.string().regex(/^\d{2}$/), COUNTY: z.string().regex(/^\d{3}$/), TRACT: z.string().regex(/^\d{6}$/) })).length(1) }) }) });

class SourceHttpError extends Error {
  readonly status: number;
  constructor(status: number) { super(`Source HTTP ${status}`); this.status = status; }
}

async function boundedJson(fetcher: typeof fetch, url: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers);
  headers.set("User-Agent", "RestaurantOS/0.1 (restaurant location research; bounded public map queries)");
  const response = await fetcher(url, { ...init, headers, signal: AbortSignal.timeout(12_000), redirect: "error" });
  if (!response.ok) throw new SourceHttpError(response.status);
  const data = await response.text();
  if (data.length > 2_000_000) throw new Error("Source response exceeds limit.");
  return JSON.parse(data);
}

/** Public context can refresh independently of imagery and property AI. */
export async function collectNeighborhoodSources(candidate: SpaceCandidate, deps: SourceDependencies = {}): Promise<SourceSnapshot> {
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const observations: SourceObservation[] = [];
  const statuses: z.infer<typeof providerStatusSchema>[] = [];
  const sourceCallsAllowed = (deps.network ?? process.env.EXPANSION_SOURCE_NETWORK === "1") && !candidate.isDemo;
  const fetcher = deps.fetch ?? fetch;
  const status = (provider: "acs" | "competition" | "neighborhood", state: z.infer<typeof providerStatusSchema>["status"], reason: string, capabilities: string[] = []) => statuses.push({ provider, status: state, mode: state === "verified" ? "live" : "unavailable", checkedAt: now, capabilities, reason });
  if (sourceCallsAllowed && candidate.latitude !== null && candidate.longitude !== null) {
    const censusKey = deps.censusApiKey ?? process.env.CENSUS_API_KEY ?? process.env.EXPANSION_CENSUS_API_KEY;
    await Promise.all([(async () => {
    if (!censusKey) {
      status("acs", "unavailable", "Census access is not configured. Set CENSUS_API_KEY on the server to retrieve population and income estimates.");
      return;
    }
    try {
      const geoUrl = new URL("https://geocoding.geo.census.gov/geocoder/geographies/coordinates");
      geoUrl.search = new URLSearchParams({ x: String(candidate.longitude), y: String(candidate.latitude), benchmark: "Public_AR_Current", vintage: "Current_Current", format: "json" }).toString();
      const tract = geoSchema.parse(await boundedJson(fetcher, geoUrl.toString())).result.geographies["Census Tracts"][0];
      const url = new URL("https://api.census.gov/data/2023/acs/acs5");
      url.search = new URLSearchParams({ get: `NAME,${ACS_VARIABLES.join(",")}`, for: `tract:${tract.TRACT}`, in: `state:${tract.STATE} county:${tract.COUNTY}`, key: censusKey }).toString();
      const context = parseAcsResponse(await boundedJson(fetcher, url.toString()), { state: tract.STATE, county: tract.COUNTY, tract: tract.TRACT });
      observations.push(acsObservation(candidate, context, now));
      status("acs", "verified", "Pinned 2019–2023 ACS five-year tract estimates retrieved; individual metrics only.", ["population_with_moe", "income_with_moe", "tract-context-only-v1"]);
    } catch (error) { status("acs", "unavailable", error instanceof SourceHttpError && [401, 403].includes(error.status)
      ? "Census rejected access. Check that the server Census API key is valid and activated."
      : "Census tract lookup or data request could not complete. Population and income remain unavailable; retry later."); }
    })(), (async () => {
    try {
      const query = `[out:json][timeout:8][maxsize:1048576];nwr[amenity=restaurant](around:500,${candidate.latitude},${candidate.longitude});out tags center 200;`;
      const schema = z.object({ osm3s: z.object({ timestamp_osm_base: z.iso.datetime() }), elements: z.array(z.object({ type: z.enum(["node", "way", "relation"]), id: z.number().int().positive() })).max(200), remark: z.string().optional() });
      let raw: unknown;
      try { raw = await boundedJson(fetcher, "https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: query }) }); }
      catch (error) {
        // A second public OSM instance handles connection failures/outages.
        // Never bypass a rate limit, denied access or malformed query.
        if (error instanceof SourceHttpError && error.status < 500) throw error;
        raw = await boundedJson(fetcher, "https://overpass.private.coffee/api/interpreter", { method: "POST", body: new URLSearchParams({ data: query }) });
      }
      const payload = schema.parse(raw);
      if (payload.remark) throw new Error("Incomplete Overpass query.");
      observations.push(sourceObservationSchema.parse({
        id: `osm:${candidate.id}:${payload.osm3s.timestamp_osm_base}`, provider: "competition", candidateId: candidate.id,
        scope: "site", sourceRecordId: `osm-500m:${candidate.latitude},${candidate.longitude}`, sourceDate: payload.osm3s.timestamp_osm_base, retrievedAt: now,
        origin: "derived", isSynthetic: false, label: "© OpenStreetMap contributors · ODbL", details: [`${payload.elements.length}${payload.elements.length === 200 ? "+ (bounded result)" : ""} mapped restaurant objects within 500 m.`],
        limitations: ["OSM completeness is unknown; objects may duplicate one venue or omit businesses. This is not a verified competitor census or same-cuisine ranking.", "Map/storage use under ODbL; attribution retained. Composite competition score unscored."], referenceUrl: "https://www.openstreetmap.org/copyright", viewerUrl: null, facts: [], exportAllowed: true,
      }));
      status("competition", "verified", "Bounded OSM query retrieved; ODbL attribution retained.", ["mapped_restaurant_objects_500m"]);
    } catch (error) { status("competition", "unavailable", error instanceof SourceHttpError && error.status === 429
      ? "OpenStreetMap source is rate-limited. Wait before refreshing; no restaurant count was substituted."
      : "OpenStreetMap sources could not be reached or returned incomplete data. Retry later; no restaurant count was substituted."); }
    })()]);
  } else {
    status("acs", "unavailable", "Public context calls disabled or sourced coordinates unavailable.");
    status("competition", "unavailable", "Public context calls disabled or sourced coordinates unavailable. Selected source: OSM/ODbL, not Google Places.");
  }
  if (!candidate.isDemo && (sourceCallsAllowed || deps.neighborhoodDataset)) {
    try {
      const snapshot = neighborhoodSnapshot(candidate, deps.neighborhoodDataset ?? await loadOfficialNeighborhoods(fetcher), now);
      observations.push(...snapshot.observations);
      statuses.push(...snapshot.statuses);
    } catch { status("neighborhood", "unavailable", "Official City neighborhood membership unavailable; no name or membership guessed."); }
  } else status("neighborhood", "unavailable", "Official neighborhood membership lookup disabled or synthetic candidate.");
  return sourceSnapshotSchema.parse({ version: EVIDENCE_VERSION, candidateId: candidate.id, refreshedAt: now, statuses, observations,
    gaps: statuses.filter(x => x.status !== "verified").map(x => `${x.provider}: ${x.reason}`) });
}

export async function collectCandidateSources(candidate: SpaceCandidate, options: { currentAddress: string | null; priceLevel: number | null }, deps: SourceDependencies = {}): Promise<SourceSnapshot> {
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const observations: SourceObservation[] = [];
  const statuses: z.infer<typeof providerStatusSchema>[] = [];
  const network = deps.network ?? process.env.EXPANSION_SOURCE_NETWORK === "1";
  const neighborhoodTask = collectNeighborhoodSources(candidate, deps).then(snapshot => { deps.onNeighborhood?.(snapshot); return snapshot; });
  const probe = deps.probe ?? probeSource;
  const status = (provider: typeof providerNames[number], state: z.infer<typeof providerStatusSchema>["status"], reason: string, capabilities: string[] = []) => statuses.push({ provider, status: state, mode: state === "verified" ? "live" : "unavailable", checkedAt: now, capabilities, reason });
  // This endpoint NEVER injects synthetic facts, even for the test-owned cache.
  const sourceCallsAllowed = network && !candidate.isDemo;
  let photo: Uint8Array | null = null;
  for (const provider of ["matterport", "vexcel"] as const) {
    if (!sourceCallsAllowed || (provider === "vexcel" && process.env.EXPANSION_VEXCEL_DISPLAY !== "1")) {
      status(provider, "unavailable", candidate.isDemo ? "Synthetic candidate: live source calls disabled." : "Source probing disabled. Configure EXPANSION_SOURCE_NETWORK and permitted imagery display explicitly.");
      continue;
    }
    try {
      const result = probeSchema.parse(await probe(provider, candidate));
      if (result.status === "verified") {
        const observation = provider === "matterport" ? mapMatterport(candidate, result.link, result.model, now) : mapVexcel(candidate, result.image, now);
        observations.push(observation);
        if (provider === "vexcel" && result.imageFile) photo = readEvidenceImage(result.imageFile);
      }
      status(provider, result.status, result.reason, result.status === "verified" ? [provider === "matterport" ? "property_metadata" : "dated_site_context_date_nullable"] : []);
    } catch { status(provider, "unavailable", "Source timed out, returned malformed data, or could not start. No fixture substituted."); }
  }
  const publicContext = await neighborhoodTask;
  observations.push(...publicContext.observations);
  statuses.push(...publicContext.statuses);
  let propertyInference: PropertyInference | undefined;
  const inferenceGaps: string[] = [];
  if (sourceCallsAllowed) {
    // Even without imagery, the model assesses kitchen likelihood from the actual listing.
    try { propertyInference = await inferProperty(candidate, observations, photo); }
    catch { inferenceGaps.push("AI property assessment unavailable. Retry Look for missing details; listing and source checks are retained."); }
  }
  return sourceSnapshotSchema.parse({ version: EVIDENCE_VERSION, candidateId: candidate.id, refreshedAt: now, statuses, observations,
    ...(propertyInference ? { propertyInference } : {}),
    gaps: [...inferenceGaps, ...contextGaps(options.currentAddress, options.priceLevel), ...statuses.filter(x => x.status !== "verified").map(x => `${x.provider}: ${x.reason}`)] });
}

function readEvidenceImage(imageFile: string): Uint8Array {
  const file = resolve(imageFile);
  if (!file.startsWith(resolve("src/features/expansion/data/data/evidence-images") + sep)) throw new Error("Invalid image reference.");
  const bytes = readFileSync(file);
  if (bytes.byteLength > 15_000_000) throw new Error("Image exceeds limit.");
  return bytes;
}

export async function candidateImage(candidate: SpaceCandidate): Promise<Uint8Array> {
  if (candidate.isDemo || process.env.EXPANSION_SOURCE_NETWORK !== "1" || process.env.EXPANSION_VEXCEL_DISPLAY !== "1") throw new Error("Image display unavailable.");
  const result = await probeSource("vexcel", candidate);
  if (result.status !== "verified" || !result.imageFile) throw new Error("Image unavailable.");
  return readEvidenceImage(result.imageFile);
}
