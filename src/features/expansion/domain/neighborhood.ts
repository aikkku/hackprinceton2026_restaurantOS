import { z } from "zod";
import type { CandidateFact } from "./matching.ts";

export const NEIGHBORHOOD_VERSION = "houston-official-super-neighborhoods-v1";
export const NEIGHBORHOOD_METHOD = "Point in City of Houston Super Neighborhood polygon (WGS84)";
export const NEIGHBORHOOD_SOURCE = "https://mycity2.houstontx.gov/gisweb02/rest/services/HoustonMap/Administrative_Boundary/MapServer/3";
export const NEIGHBORHOOD_LABEL = "City of Houston Super Neighborhoods";
export const NEIGHBORHOOD_LIMITATION = "Official Super Neighborhood planning boundaries, not informal neighborhood names or a property survey. Areas outside the polygons remain unassigned. Boundary publication/update date is not supplied by this service; retrieval time is separate.";

const position = z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]);
const ring = z.array(position).min(4);
export const neighborhoodFeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.object({ POLYID: z.number().int().positive(), SNBNAME: z.string().trim().min(1), OBJECTID: z.number().int(), SnbrInfoURL: z.string().nullable().optional() }),
  geometry: z.discriminatedUnion("type", [
    z.object({ type: z.literal("Polygon"), coordinates: z.array(ring).min(1) }),
    z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(ring).min(1)).min(1) }),
  ]),
});
export const neighborhoodCollectionSchema = z.object({
  type: z.literal("FeatureCollection"), features: z.array(neighborhoodFeatureSchema).min(1).max(200),
  exceededTransferLimit: z.literal(false).optional(),
});
export const neighborhoodDatasetSchema = z.object({
  version: z.literal(NEIGHBORHOOD_VERSION), sourceUrl: z.literal(NEIGHBORHOOD_SOURCE), retrievedAt: z.iso.datetime(),
  sourceDate: z.string().nullable(), collection: neighborhoodCollectionSchema,
});
export const neighborhoodCatalogSchema = z.object({
  version: z.literal(NEIGHBORHOOD_VERSION), sourceUrl: z.literal(NEIGHBORHOOD_SOURCE), retrievedAt: z.iso.datetime(),
  sourceDate: z.string().nullable(), definition: z.string(),
  neighborhoods: z.array(z.object({ id: z.number().int(), name: z.string(), listingCount: z.number().int().nonnegative().optional() })),
  rankingBasis: z.string().optional(), datasetId: z.string().optional(),
});
export type NeighborhoodDataset = z.infer<typeof neighborhoodDatasetSchema>;
export type NeighborhoodCatalog = z.infer<typeof neighborhoodCatalogSchema>;

/** Only an explicit old Heights preference has a documented official equivalent. */
export function normalizeNeighborhoodName(name: string): string {
  const normalized = name.trim().toUpperCase().replace(/\s+/g, " ");
  return normalized === "HEIGHTS" ? "GREATER HEIGHTS" : normalized === "MONTROSE" ? "NEARTOWN - MONTROSE" : normalized;
}
export const neighborhoodsMatch = (a: string, b: string) => normalizeNeighborhoodName(a) === normalizeNeighborhoodName(b);
export const isOfficialNeighborhoodFact = (fact: CandidateFact) => fact.field === "neighborhood" && fact.origin === "derived" && fact.method === NEIGHBORHOOD_METHOD && fact.source.label === NEIGHBORHOOD_LABEL && fact.source.recordId?.startsWith(`${NEIGHBORHOOD_VERSION}:`) === true;

function inRing(x: number, y: number, points: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (Math.abs(cross) < 1e-12 && x >= Math.min(xi, xj) && x <= Math.max(xi, xj) && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) return true;
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Holes and multipart polygons are respected; overlapping/boundary matches stay ambiguous. */
export function locateNeighborhood(dataset: NeighborhoodDataset, longitude: number, latitude: number) {
  position.parse([longitude, latitude]);
  const matches = dataset.collection.features.filter(feature => {
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    return polygons.some(rings => inRing(longitude, latitude, rings[0]) && !rings.slice(1).some(hole => inRing(longitude, latitude, hole)));
  });
  const unique = new Map(matches.map(f => [f.properties.POLYID, f.properties]));
  return unique.size === 1 ? [...unique.values()][0] : null;
}

export function neighborhoodCatalog(dataset: NeighborhoodDataset): NeighborhoodCatalog {
  const names = new Map(dataset.collection.features.map(f => [f.properties.POLYID, f.properties.SNBNAME]));
  return neighborhoodCatalogSchema.parse({ ...dataset, definition: NEIGHBORHOOD_LIMITATION,
    neighborhoods: [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)) });
}
