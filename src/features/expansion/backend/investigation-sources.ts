import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { EVIDENCE_VERSION, providerNames, providerStatusSchema, sourceObservationSchema, sourceSnapshotSchema, type SourceObservation, type SourceSnapshot } from "../domain/evidence.ts";
import { acsObservation, contextGaps, HEIGHTS_DEFINITION, mapMatterport, mapVexcel, parseAcsResponse, ACS_VARIABLES } from "../domain/source-adapters.ts";
import type { SpaceCandidate } from "../domain/matching.ts";

const execute = promisify(execFile);
const probeSchema = z.object({ status: providerStatusSchema.shape.status, reason: z.string().min(1), link: z.unknown().optional(), model: z.unknown().optional(), image: z.unknown().optional(), imageFile: z.string().optional() });
export type SourceDependencies = { fetch?: typeof fetch; probe?: typeof probeSource; network?: boolean; now?: () => string; neighborhoodLookup?: unknown };
export async function probeSource(provider: "matterport" | "vexcel", candidate: SpaceCandidate) {
  const helperVenv = resolve("src/features/expansion/data/.venv-helper", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const python = process.env.EXPANSION_EVIDENCE_PYTHON || (existsSync(helperVenv) ? helperVenv : "python");
  const result = await execute(python, [resolve("src/features/expansion/backend/source_probe.py"), provider, candidate.propertyId, String(candidate.latitude), String(candidate.longitude)], { windowsHide: true, timeout: 105_000, maxBuffer: 128 * 1024 });
  return probeSchema.parse(JSON.parse(result.stdout));
}
/** A reviewed site lookup must name an official source, date and definition. */
const neighborhoodLookupSchema = z.array(z.object({
  candidateId: z.string().min(1), definitionVersion: z.literal(HEIGHTS_DEFINITION.version),
  isMember: z.boolean(), checkedAt: z.iso.datetime(), sourceDate: z.iso.date(),
  referenceUrl: z.url().refine(url => new URL(url).hostname.endsWith(".houstontx.gov") || new URL(url).hostname === "www.houstontx.gov"),
})).refine(rows => new Set(rows.map(x => x.candidateId)).size === rows.length, "Duplicate neighborhood lookup IDs.");
const geoSchema = z.object({ result: z.object({ geographies: z.object({ "Census Tracts": z.array(z.object({ STATE: z.string().regex(/^\d{2}$/), COUNTY: z.string().regex(/^\d{3}$/), TRACT: z.string().regex(/^\d{6}$/) })).length(1) }) }) });

async function boundedJson(fetcher: typeof fetch, url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(12_000), redirect: "error" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.text();
  if (data.length > 2_000_000) throw new Error("Source response exceeds limit.");
  return JSON.parse(data);
}

export async function collectCandidateSources(candidate: SpaceCandidate, options: { currentAddress: string | null; priceLevel: number | null }, deps: SourceDependencies = {}): Promise<SourceSnapshot> {
  const now = (deps.now ?? (() => new Date().toISOString()))();
  const observations: SourceObservation[] = [];
  const statuses: z.infer<typeof providerStatusSchema>[] = [];
  const network = deps.network ?? process.env.EXPANSION_SOURCE_NETWORK === "1";
  const fetcher = deps.fetch ?? fetch;
  const probe = deps.probe ?? probeSource;
  const status = (provider: typeof providerNames[number], state: z.infer<typeof providerStatusSchema>["status"], reason: string, capabilities: string[] = []) => statuses.push({ provider, status: state, mode: state === "verified" ? "live" : "unavailable", checkedAt: now, capabilities, reason });
  // This endpoint NEVER injects synthetic facts, even for the test-owned cache.
  const sourceCallsAllowed = network && !candidate.isDemo;
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
      }
      status(provider, result.status, result.reason, result.status === "verified" ? [provider === "matterport" ? "property_metadata" : "dated_site_context_date_nullable"] : []);
    } catch { status(provider, "unavailable", "Source timed out, returned malformed data, or could not start. No fixture substituted."); }
  }
  try {
    const rawLookup = deps.neighborhoodLookup ?? (process.env.EXPANSION_HEIGHTS_LOOKUP ? JSON.parse(readFileSync(process.env.EXPANSION_HEIGHTS_LOOKUP, "utf8")) : []);
    const entry = neighborhoodLookupSchema.parse(rawLookup).find(x => x.candidateId === candidate.id);
    if (!entry) status("neighborhood", "unavailable", `${HEIGHTS_DEFINITION.limitation} No reviewed site lookup supplied.`);
    else {
      observations.push(sourceObservationSchema.parse({
        id: `neighborhood:${candidate.id}:${entry.checkedAt}`, provider: "neighborhood", candidateId: candidate.id,
        scope: "site", sourceRecordId: `${HEIGHTS_DEFINITION.version}:${candidate.id}`, sourceDate: entry.sourceDate, retrievedAt: now, origin: "observed", isSynthetic: false,
        label: HEIGHTS_DEFINITION.name, details: [entry.isMember ? "Reviewed lookup places the site in Greater Heights." : "Reviewed lookup places the site outside Greater Heights; other Houston neighborhoods remain eligible."],
        limitations: [HEIGHTS_DEFINITION.limitation], referenceUrl: entry.referenceUrl, viewerUrl: null, exportAllowed: true,
        facts: [{ id: `neighborhood-fact:${candidate.id}`, entityScope: "space", entityId: candidate.id, field: "neighborhood", value: { kind: "exact", value: entry.isMember ? "Heights" : "Other Houston neighborhood" }, unit: null, origin: "observed", source: { label: HEIGHTS_DEFINITION.name, recordId: HEIGHTS_DEFINITION.version, capturedAt: `${entry.sourceDate}T00:00:00.000Z` }, method: "Reviewed official-source site lookup; definition requires owner confirmation", limitations: [HEIGHTS_DEFINITION.limitation], isDemo: false }],
      }));
      status("neighborhood", "verified", "Dated official-source site lookup available.", [HEIGHTS_DEFINITION.version]);
    }
  } catch { status("neighborhood", "unavailable", "Reviewed Heights lookup is malformed; membership unresolved."); }
  if (sourceCallsAllowed && candidate.latitude !== null && candidate.longitude !== null) {
    try {
      const geoUrl = new URL("https://geocoding.geo.census.gov/geocoder/geographies/coordinates");
      geoUrl.search = new URLSearchParams({ x: String(candidate.longitude), y: String(candidate.latitude), benchmark: "Public_AR_Current", vintage: "Current_Current", format: "json" }).toString();
      const tract = geoSchema.parse(await boundedJson(fetcher, geoUrl.toString())).result.geographies["Census Tracts"][0];
      const url = new URL("https://api.census.gov/data/2023/acs/acs5");
      url.search = new URLSearchParams({ get: `NAME,${ACS_VARIABLES.join(",")}`, for: `tract:${tract.TRACT}`, in: `state:${tract.STATE} county:${tract.COUNTY}` }).toString();
      const context = parseAcsResponse(await boundedJson(fetcher, url.toString()), { state: tract.STATE, county: tract.COUNTY, tract: tract.TRACT });
      observations.push(acsObservation(candidate, context, now));
      status("acs", "verified", "Pinned 2019–2023 ACS five-year tract estimates retrieved; individual metrics only.", ["population_with_moe", "income_with_moe", "tract-context-only-v1"]);
    } catch { status("acs", "unavailable", "Tract lookup or pinned ACS query failed; metrics remain unavailable."); }
    try {
      const query = `[out:json][timeout:8][maxsize:1048576];nwr[amenity=restaurant](around:500,${candidate.latitude},${candidate.longitude});out tags center 200;`;
      const payload = z.object({ osm3s: z.object({ timestamp_osm_base: z.iso.datetime() }), elements: z.array(z.object({ type: z.enum(["node", "way", "relation"]), id: z.number().int().positive() })).max(200), remark: z.string().optional() }).parse(await boundedJson(fetcher, "https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: query }) }));
      if (payload.remark) throw new Error("Incomplete Overpass query.");
      observations.push(sourceObservationSchema.parse({
        id: `osm:${candidate.id}:${payload.osm3s.timestamp_osm_base}`, provider: "competition", candidateId: candidate.id,
        scope: "site", sourceRecordId: `osm-500m:${candidate.latitude},${candidate.longitude}`, sourceDate: payload.osm3s.timestamp_osm_base, retrievedAt: now,
        origin: "derived", isSynthetic: false, label: "© OpenStreetMap contributors · ODbL", details: [`${payload.elements.length}${payload.elements.length === 200 ? "+ (bounded result)" : ""} mapped restaurant objects within 500 m.`],
        limitations: ["OSM completeness is unknown; objects may duplicate one venue or omit businesses. This is not a verified competitor census or same-cuisine ranking.", "Map/storage use under ODbL; attribution retained. Composite competition score unscored."], referenceUrl: "https://www.openstreetmap.org/copyright", viewerUrl: null, facts: [], exportAllowed: true,
      }));
      status("competition", "verified", "Bounded OSM query retrieved; ODbL attribution retained.", ["mapped_restaurant_objects_500m"]);
    } catch { status("competition", "unavailable", "Competition source unavailable or incomplete; no count invented."); }
  } else {
    status("acs", "unavailable", "Public context calls disabled or sourced coordinates unavailable.");
    status("competition", "unavailable", "Public context calls disabled or sourced coordinates unavailable. Selected source: OSM/ODbL, not Google Places.");
  }
  return sourceSnapshotSchema.parse({ version: EVIDENCE_VERSION, candidateId: candidate.id, refreshedAt: now, statuses, observations,
    gaps: [...contextGaps(options.currentAddress, options.priceLevel), ...statuses.filter(x => x.status !== "verified").map(x => `${x.provider}: ${x.reason}`)] });
}

export async function candidateImage(candidate: SpaceCandidate): Promise<Uint8Array> {
  if (candidate.isDemo || process.env.EXPANSION_SOURCE_NETWORK !== "1" || process.env.EXPANSION_VEXCEL_DISPLAY !== "1") throw new Error("Image display unavailable.");
  const result = await probeSource("vexcel", candidate);
  if (result.status !== "verified" || !result.imageFile) throw new Error("Image unavailable.");
  const file = resolve(result.imageFile);
  if (!file.startsWith(resolve("src/features/expansion/data/data/evidence-images") + sep)) throw new Error("Invalid image reference.");
  return readFileSync(file);
}
