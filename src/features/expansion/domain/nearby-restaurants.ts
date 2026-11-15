import { z } from "zod";

/**
 * Google Places (New) nearby-restaurant context.
 *
 * Storage policy: Google Maps Platform terms forbid storing or caching Places
 * content (names, addresses, types, coordinates beyond 30 days). Only place IDs
 * are exempt. Everything in this module is therefore computed per request and
 * returned with `no-store`; none of it is written to saved evidence, agent
 * artifacts or plans. https://developers.google.com/maps/documentation/places/web-service/policies
 */
export const NEARBY_RESTAURANTS_VERSION = "expansion-google-nearby-restaurants-v1";
export const NEARBY_RADIUS_METERS = 500;
export const NEARBY_RESULT_CAP = 20;
export const NEARBY_FIELD_MASK = ["places.id", "places.displayName", "places.location", "places.formattedAddress", "places.types", "places.primaryType", "places.googleMapsUri"].join(",");

// ---- Raw Places API (New) response (validated at the boundary) ----
const rawPlaceSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{10,300}$/),
  displayName: z.object({ text: z.string().min(1).max(300) }),
  location: z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }),
  formattedAddress: z.string().max(500).optional(),
  types: z.array(z.string().regex(/^[a-z0-9_]{1,80}$/)).max(60).default([]),
  primaryType: z.string().regex(/^[a-z0-9_]{1,80}$/).optional(),
  googleMapsUri: z.url().optional(),
});
/** Google returns `{}` (no `places` key) when nothing matches. */
export const placesNearbyResponseSchema = z.object({ places: z.array(rawPlaceSchema).max(NEARBY_RESULT_CAP).default([]) });

// ---- Normalized, display-only shape ----
export const nearbyRestaurantSchema = z.object({
  placeId: z.string().min(1),
  name: z.string().min(1),
  address: z.string().nullable(),
  typeLabel: z.string().min(1),
  /** Calculated straight-line distance from the listing's coordinates, not walking distance. */
  distanceMeters: z.number().int().nonnegative(),
  /** For drawing pins on a Google map only (Google terms: never shown on a non-Google map, never stored). */
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  googleMapsUrl: z.url(),
}).strict();
export type NearbyRestaurant = z.infer<typeof nearbyRestaurantSchema>;

export const nearbySummarySchema = z.object({
  returned: z.number().int().nonnegative(),
  capReached: z.boolean(),
  nearestMeters: z.number().int().nonnegative().nullable(),
  medianMeters: z.number().int().nonnegative().nullable(),
  /** Count per displayed type label, most common first. */
  typeCounts: z.array(z.object({ label: z.string(), count: z.number().int().positive() })),
  /** Owner cuisine as entered (null if unknown) and places whose Google type matches it. */
  cuisine: z.string().nullable(),
  sameCuisinePlaceIds: z.array(z.string()),
}).strict();
export type NearbySummary = z.infer<typeof nearbySummarySchema>;

export const nearbyStatuses = ["ok", "not_configured", "denied", "rate_limited", "timeout", "unavailable", "synthetic", "no_coordinates"] as const;
export const nearbyRestaurantsResultSchema = z.object({
  version: z.literal(NEARBY_RESTAURANTS_VERSION),
  candidateId: z.string().min(1),
  status: z.enum(nearbyStatuses),
  message: z.string().min(1),
  source: z.object({ name: z.literal("Google Maps"), api: z.literal("Places API (New) · Nearby Search"), radiusMeters: z.number(), resultCap: z.number(), rankPreference: z.literal("DISTANCE"), retrievedAt: z.iso.datetime() }),
  restaurants: z.array(nearbyRestaurantSchema).max(NEARBY_RESULT_CAP),
  summary: nearbySummarySchema.nullable(),
}).strict();
export type NearbyRestaurantsResult = z.infer<typeof nearbyRestaurantsResultSchema>;

/** Great-circle distance in meters (WGS84 mean radius). */
export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const GENERIC = new Set(["restaurant", "food", "point_of_interest", "establishment", "store", "service"]);
const FOOD_TYPES = new Set(["cafe", "coffee_shop", "bakery", "bar", "pub", "bar_and_grill", "diner", "fast_food_restaurant", "food_court", "deli", "sandwich_shop", "pizza_restaurant", "ice_cream_shop", "dessert_shop", "juice_shop", "tea_house", "steak_house", "buffet_restaurant", "brunch_restaurant", "breakfast_restaurant", "wine_bar", "cafeteria", "bagel_shop", "donut_shop", "confectionery", "chocolate_shop", "acai_shop"]);
const pretty = (type: string) => { const text = type.replace(/_restaurant$/, "").replace(/_/g, " "); return text.charAt(0).toUpperCase() + text.slice(1); };

/** Most specific food type Google reported; never inferred from the name. */
export function restaurantTypeLabel(types: string[], primaryType?: string): string {
  const candidates = [primaryType, ...types].filter((t): t is string => Boolean(t));
  const specific = candidates.find(t => t.endsWith("_restaurant") || FOOD_TYPES.has(t));
  if (specific) return pretty(specific);
  return candidates.some(t => t === "restaurant") ? "Restaurant (type not specified)" : pretty(candidates.find(t => !GENERIC.has(t)) ?? "restaurant");
}

const MAPS_HOSTS = new Set(["maps.google.com", "www.google.com", "google.com", "goo.gl", "maps.app.goo.gl"]);
function mapsUrl(raw: z.infer<typeof rawPlaceSchema>): string {
  if (raw.googleMapsUri) {
    const url = new URL(raw.googleMapsUri);
    if (url.protocol === "https:" && MAPS_HOSTS.has(url.hostname)) return url.toString();
  }
  const url = new URL("https://www.google.com/maps/search/");
  url.search = new URLSearchParams({ api: "1", query: raw.displayName.text, query_place_id: raw.id }).toString();
  return url.toString();
}

export function normalizeNearby(payload: unknown, origin: { latitude: number; longitude: number }): NearbyRestaurant[] {
  const { places } = placesNearbyResponseSchema.parse(payload);
  const seen = new Set<string>();
  return places.filter(p => !seen.has(p.id) && seen.add(p.id)).map(p => nearbyRestaurantSchema.parse({
    placeId: p.id, name: p.displayName.text, address: p.formattedAddress ?? null,
    typeLabel: restaurantTypeLabel(p.types, p.primaryType),
    distanceMeters: Math.round(distanceMeters(origin, p.location)),
    latitude: p.location.latitude, longitude: p.location.longitude,
    googleMapsUrl: mapsUrl(p),
  })).sort((a, b) => a.distanceMeters - b.distanceMeters || a.placeId.localeCompare(b.placeId));
}

const STOP = new Set(["food", "foods", "restaurant", "restaurants", "cuisine", "kitchen", "style", "and", "the", "with", "bar", "grill", "house", "shop", "cafe"]);
const tokens = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(t => t.length >= 3 && !STOP.has(t));

/** Deterministic overlap: owner cuisine words vs. Google's reported type label only. */
export function summarizeNearby(restaurants: NearbyRestaurant[], cuisine: string | null): NearbySummary {
  const counts = new Map<string, number>();
  for (const r of restaurants) counts.set(r.typeLabel, (counts.get(r.typeLabel) ?? 0) + 1);
  const sorted = restaurants.map(r => r.distanceMeters).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const words = cuisine ? tokens(cuisine) : [];
  return nearbySummarySchema.parse({
    returned: restaurants.length,
    capReached: restaurants.length >= NEARBY_RESULT_CAP,
    nearestMeters: sorted[0] ?? null,
    medianMeters: sorted.length ? (sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)) : null,
    typeCounts: [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    cuisine: cuisine?.trim() || null,
    sameCuisinePlaceIds: words.length ? restaurants.filter(r => tokens(r.typeLabel).some(t => words.includes(t))).map(r => r.placeId) : [],
  });
}

// ---- Grounded explanation (AI organizes; numbers stay deterministic) ----
export const nearbyExplanationOutputSchema = z.object({
  overlap: z.string().min(1).max(700),
  gaps: z.string().min(1).max(700),
  caveats: z.array(z.string().min(1).max(300)).max(3),
  citedPlaceIds: z.array(z.string()).max(NEARBY_RESULT_CAP),
}).strict();
export const nearbyExplanationSchema = nearbyExplanationOutputSchema.extend({
  version: z.literal(NEARBY_RESTAURANTS_VERSION), candidateId: z.string(), model: z.string(), generatedAt: z.iso.datetime(), origin: z.literal("assumed"),
}).strict();
export type NearbyExplanation = z.infer<typeof nearbyExplanationSchema>;

/** Numbers the explanation may mention: only those already computed deterministically. */
export function allowedNumbers(result: NearbyRestaurantsResult): Set<string> {
  const values = [result.source.radiusMeters, result.source.resultCap, ...result.restaurants.map(r => r.distanceMeters)];
  if (result.summary) values.push(result.summary.returned, result.summary.sameCuisinePlaceIds.length, ...result.summary.typeCounts.map(t => t.count),
    ...[result.summary.nearestMeters, result.summary.medianMeters].filter((v): v is number => v !== null));
  // Digits inside retrieved names/types ("Tequila 45") are quoted data, not new figures.
  const quoted = result.restaurants.flatMap(r => `${r.name} ${r.typeLabel}`.match(/\d+(?:[.,]\d+)*/g) ?? []).map(n => n.replace(/,/g, ""));
  return new Set([...values.map(String), ...quoted]);
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

/** Rejects explanations that cite unknown places or introduce numbers we did not compute. */
export function checkGrounding(output: z.infer<typeof nearbyExplanationOutputSchema>, result: NearbyRestaurantsResult): string | null {
  const ids = new Set(result.restaurants.map(r => r.placeId));
  if (output.citedPlaceIds.some(id => !ids.has(id))) return "cited a place outside the retrieved results";
  const allowed = allowedNumbers(result);
  const text = [output.overlap, output.gaps, ...output.caveats].join(" ");
  const numbers = (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map(n => n.replace(/,/g, ""));
  // Spelled-out counts ("Six places…") are checked too; "one" is too ambiguous in prose.
  const words = text.toLowerCase().match(new RegExp(`\\b(${NUMBER_WORDS.slice(2).join("|")})\\b`, "g")) ?? [];
  const bad = [...numbers, ...words.map(w => String(NUMBER_WORDS.indexOf(w)))].filter(n => !allowed.has(n));
  return bad.length ? `introduced numbers not in the retrieved data (${bad.slice(0, 3).join(", ")})` : null;
}
