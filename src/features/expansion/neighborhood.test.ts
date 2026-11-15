import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NEIGHBORHOOD_SOURCE, NEIGHBORHOOD_VERSION, locateNeighborhood, neighborhoodCatalog, neighborhoodDatasetSchema, neighborhoodsMatch } from "./domain/neighborhood.ts";
import { neighborhoodSnapshot } from "./backend/neighborhoods.ts";
import { reassessCandidate } from "./domain/evidence.ts";
import { calculatePropertyScore } from "./domain/property-score.ts";
import { mergeOfficialNeighborhood } from "./frontend/data/neighborhoods.ts";

const now = "2026-11-15T10:00:00.000Z";
// Explicit synthetic geometry for algorithm tests only; never a runtime fallback.
export const unitNeighborhoodDataset = neighborhoodDatasetSchema.parse({ version: NEIGHBORHOOD_VERSION, sourceUrl: NEIGHBORHOOD_SOURCE, retrievedAt: now, sourceDate: null,
  collection: { type: "FeatureCollection", features: [
    { type: "Feature", properties: { POLYID: 15, SNBNAME: "GREATER HEIGHTS", OBJECTID: 1 }, geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]], [[.5, .5], [1, .5], [1, 1], [.5, 1], [.5, .5]]] } },
    { type: "Feature", properties: { POLYID: 24, SNBNAME: "NEARTOWN - MONTROSE", OBJECTID: 2 }, geometry: { type: "MultiPolygon", coordinates: [[[[2, 0], [3, 0], [3, 2], [2, 2], [2, 0]]], [[[4, 0], [5, 0], [5, 1], [4, 1], [4, 0]]]] } },
  ] } });

test("coordinate membership respects polygon holes, multipart geometry and shared boundaries", () => {
  assert.equal(locateNeighborhood(unitNeighborhoodDataset, .2, .2)?.POLYID, 15);
  assert.equal(locateNeighborhood(unitNeighborhoodDataset, .75, .75), null, "hole is not membership");
  assert.equal(locateNeighborhood(unitNeighborhoodDataset, 4.5, .5)?.POLYID, 24);
  assert.equal(locateNeighborhood(unitNeighborhoodDataset, 2, 1), null, "shared boundary stays ambiguous");
  assert.equal(locateNeighborhood(unitNeighborhoodDataset, 10, 10), null);
  assert.throws(() => locateNeighborhood(unitNeighborhoodDataset, Number.NaN, 1));
});

test("catalog names come from the dataset; only documented old preferences map to official names", () => {
  const catalog = neighborhoodCatalog(unitNeighborhoodDataset);
  assert.deepEqual(catalog.neighborhoods.map(n => n.name), ["GREATER HEIGHTS", "NEARTOWN - MONTROSE"]);
  assert.ok(neighborhoodsMatch("Heights", "GREATER HEIGHTS"));
  assert.ok(neighborhoodsMatch("Montrose", "NEARTOWN - MONTROSE"));
  assert.equal(neighborhoodsMatch("Rice Village", "UNIVERSITY PLACE"), false, "do not guess informal boundaries");
});

test("official derived geography reaches assessments and scores, unknown coverage never invents a name", () => {
  const search = JSON.parse(readFileSync(new URL("./agent/fixtures/contracts/candidates.sample.json", import.meta.url), "utf8"));
  const profile = JSON.parse(readFileSync(new URL("./agent/fixtures/contracts/profile.sample.json", import.meta.url), "utf8"));
  const base = { ...search.candidates[0], candidate: { ...search.candidates[0].candidate, latitude: .2, longitude: .2, isDemo: false } };
  const sources = neighborhoodSnapshot(base.candidate, unitNeighborhoodDataset, now);
  assert.equal(sources.observations[0].origin, "derived");
  assert.equal(sources.observations[0].sourceDate, null, "retrieval date never becomes source publication date");
  const result = reassessCandidate(base, profile.requirements, [], sources, { id: "r", parentId: null, revisionNumber: 0, evaluatedAt: now });
  assert.equal(result.assessments.find(a => a.requirementId === "market.neighborhoodPreference")?.status, "pass");
  assert.equal(calculatePropertyScore({ candidate: base.candidate, requirements: profile.requirements, sources }).factors.find(f => f.key === "neighborhood")?.score, 10);
  assert.equal(neighborhoodSnapshot({ ...base.candidate, latitude: 10 }, unitNeighborhoodDataset, now).observations.length, 0);
  assert.equal(neighborhoodSnapshot({ ...base.candidate, isDemo: true }, unitNeighborhoodDataset, now).observations.length, 0, "real geography never assigned to fake listings");
  const merged = mergeOfficialNeighborhood(sources, sources);
  assert.equal(merged.observations.length, 1, "repeated refresh does not duplicate observations");
});
