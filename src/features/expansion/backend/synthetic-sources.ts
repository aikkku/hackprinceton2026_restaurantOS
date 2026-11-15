import { createHash } from "node:crypto";
import { EVIDENCE_VERSION, sourceObservationSchema, sourceSnapshotSchema, type SourceObservation, type SourceSnapshot } from "../domain/evidence.ts";
import { ACS_VARIABLES, HEIGHTS_DEFINITION, SYNTHETIC_LIMITATION, acsObservation, contextGaps, mapMatterport, mapVexcel, parseAcsResponse } from "../domain/source-adapters.ts";
import type { SpaceCandidate } from "../domain/matching.ts";

/**
 * Labeled synthetic source fixtures (Phase 4, this machine has no provider
 * access or private data). Raw fixture payloads go through the REAL adapter
 * mappers, then are relabeled `simulated` with every fact stripped, so they
 * can never change a requirement assessment. They attach only to synthetic
 * candidates (synthetic dataset or demo record) and never to real records.
 */
export const SYNTHETIC_SOURCES_VERSION = "expansion-synthetic-sources-v1";
const SYNTHETIC_DATASET = /^synthetic[-_]/;

export function syntheticSourcesAllowed(candidate: SpaceCandidate, datasetId: string | null): boolean {
  return candidate.isDemo || (datasetId !== null && SYNTHETIC_DATASET.test(datasetId));
}

/** Deterministic variant per candidate so the same input always yields the same fixtures. */
export function syntheticVariant(candidateId: string): 0 | 1 | 2 {
  return (createHash("sha256").update(candidateId).digest()[0] % 3) as 0 | 1 | 2;
}

type Status = SourceSnapshot["statuses"][number];

export function syntheticSourceSnapshot(candidate: SpaceCandidate, datasetId: string | null, options: { currentAddress: string | null; priceLevel: number | null }, now: string): SourceSnapshot {
  if (!syntheticSourcesAllowed(candidate, datasetId)) throw Object.assign(new Error("Synthetic fixtures attach only to synthetic candidates; real records stay unmixed."), { code: "conflict" });
  const variant = syntheticVariant(candidate.id);
  const observations: SourceObservation[] = [];
  const statuses: Status[] = [];
  const gaps: string[] = [];
  const status = (provider: Status["provider"], capabilities: string[], reason: string) =>
    statuses.push({ provider, status: "unavailable", mode: "synthetic", checkedAt: now, capabilities, reason: `Live access not verified on this machine. ${reason} Synthetic fixture only.` });
  const fixtureModel = `synthetic${variant}${createHash("sha256").update(candidate.id).digest("hex").slice(0, 8)}`;

  // Matterport: 0 = property-level only; 1 = suite association + measured dining; 2 = wrong-suite link rejected.
  try {
    const link = { modelId: fixtureModel, propertyId: candidate.propertyId, candidateId: variant === 0 ? null : variant === 1 ? candidate.id : `${candidate.id}:other-suite`, verifiedAt: variant === 1 ? "2026-10-01" : null, reference: "Synthetic association fixture", viewerPermitted: false };
    const model = { id: fixtureModel, name: "Synthetic model fixture", capturedAt: variant === 1 ? "2026-09-15" : null, measurements: variant === 1 ? { usableDiningSqFt: 640, sourceRecordId: "synthetic-measurement" } : null };
    observations.push(mapMatterport(candidate, link, model, now, variant === 1 ? 15 : null, { synthetic: true }));
    status("matterport", variant === 1 ? ["model_metadata", "suite_association", "measured_dining_area"] : ["model_metadata"], variant === 1 ? "Fixture shows a dated suite association with a measured dining area and a 15 SF/seat planning density." : "Fixture shows property-level metadata only.");
  } catch {
    status("matterport", [], "Fixture models a link that names a different suite; the adapter rejected the association.");
    gaps.push("matterport: model association mismatch (synthetic) — no suite evidence attached.");
  }

  // Vexcel: 0 = occluded/undated; 1 = reviewed visible stalls; 2 = synthetic HTTP 403.
  if (variant === 2 || candidate.latitude === null || candidate.longitude === null) {
    statuses.push({ provider: "vexcel", status: "denied", mode: "synthetic", checkedAt: now, capabilities: [], reason: "Synthetic HTTP 403 fixture: imagery access denied. No image or stall count substituted." });
  } else {
    observations.push(mapVexcel(candidate, { recordId: `synthetic-image-${variant}`, latitude: candidate.latitude, longitude: candidate.longitude, capturedAt: variant === 1 ? "2026-03-02" : null, occluded: variant === 1 ? false : true, reviewedVisibleStalls: variant === 1 ? 12 : null, reviewReference: variant === 1 ? "synthetic-review" : null }, now, { synthetic: true }));
    status("vexcel", ["dated_site_context", variant === 1 ? "reviewed_visible_stalls" : "occlusion_flag"], "Visible stalls never establish customer parking rights.");
  }

  // Neighborhood: unresolved on purpose; Heights is a preference and needs a sourced lookup.
  observations.push(sourceObservationSchema.parse({
    id: `synthetic:neighborhood:${candidate.id}`, provider: "neighborhood", candidateId: candidate.id, scope: "site",
    sourceRecordId: `${HEIGHTS_DEFINITION.version}:synthetic`, sourceDate: null, retrievedAt: now, origin: "simulated", isSynthetic: true,
    label: `Synthetic fixture · ${HEIGHTS_DEFINITION.name}`, details: ["Membership unresolved in the fixture; other Houston neighborhoods remain eligible."],
    limitations: [SYNTHETIC_LIMITATION, HEIGHTS_DEFINITION.limitation], referenceUrl: HEIGHTS_DEFINITION.referenceUrl, viewerUrl: null, facts: [], exportAllowed: false,
  }));
  status("neighborhood", [HEIGHTS_DEFINITION.version], "Boundary lookup not reviewed.");

  // ACS: synthetic tract table through the real parser (incl. a -666666666 MOE sentinel → null).
  const geo = { state: "48", county: "201", tract: `99${String(variant).padStart(4, "0")}` };
  const table = [["NAME", ...ACS_VARIABLES, "state", "county", "tract"], [`Synthetic Tract ${geo.tract}`, String(3200 + variant * 400), "410", String(61000 + variant * 9000), variant === 2 ? "-666666666" : "7400", geo.state, geo.county, geo.tract]];
  observations.push(acsObservation(candidate, parseAcsResponse(table, geo), now, { synthetic: true }));
  status("acs", ["population_with_moe", "income_with_moe", "tract-context-only-v1"], "Pinned release/variables shown with synthetic values.");

  // Competition: count context only; no ranking or score.
  observations.push(sourceObservationSchema.parse({
    id: `synthetic:competition:${candidate.id}`, provider: "competition", candidateId: candidate.id, scope: "site",
    sourceRecordId: "synthetic-osm-500m", sourceDate: null, retrievedAt: now, origin: "simulated", isSynthetic: true,
    label: "Synthetic fixture · mapped restaurant objects (OSM-shaped)", details: [`${14 + variant * 5} synthetic mapped restaurant objects within 500 m.`],
    limitations: [SYNTHETIC_LIMITATION, "Not a competitor census, cuisine match or demand signal. Composite competition score unscored."],
    referenceUrl: "https://www.openstreetmap.org/copyright", viewerUrl: null, facts: [], exportAllowed: false,
  }));
  status("competition", ["mapped_restaurant_objects_500m"], "Selected live source is OSM/ODbL (not Google Places).");

  return sourceSnapshotSchema.parse({ version: EVIDENCE_VERSION, candidateId: candidate.id, refreshedAt: now, statuses, observations,
    gaps: [`Synthetic fixtures (${SYNTHETIC_SOURCES_VERSION}, variant ${variant}) shown for a synthetic candidate. They carry no facts and cannot verify any requirement.`, ...contextGaps(options.currentAddress, options.priceLevel), ...gaps] });
}
