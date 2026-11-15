import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { explainNearbyRestaurants, fetchNearbyRestaurants } from "./backend/google-places.ts";
import { checkGrounding, distanceMeters, restaurantTypeLabel, summarizeNearby, NEARBY_FIELD_MASK, type NearbyRestaurantsResult } from "./domain/nearby-restaurants.ts";
import { sourceSnapshotSchema } from "./domain/evidence.ts";

// Synthetic place records shaped like Places API (New); not real Google content.
const now = "2026-11-15T10:00:00.000Z";
const search = JSON.parse(readFileSync(new URL("./agent/fixtures/contracts/candidates.sample.json", import.meta.url), "utf8"));
const candidate = { ...search.candidates[0].candidate, isDemo: false, latitude: 29.76, longitude: -95.37 };
const place = (id: string, name: string, lat: number, types: string[], primaryType?: string) => ({ id: `test_place_${id}`, displayName: { text: name }, location: { latitude: lat, longitude: -95.37 }, formattedAddress: `${id} Test St`, types, ...(primaryType ? { primaryType } : {}) });
const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
const deps = (fetch: typeof globalThis.fetch) => ({ fetch, apiKey: "test-key", network: true, now: () => now });

test("distance and type labels are deterministic and never derived from names", () => {
  assert.equal(Math.round(distanceMeters({ latitude: 29.76, longitude: -95.37 }, { latitude: 29.761, longitude: -95.37 })), 111);
  assert.equal(restaurantTypeLabel(["mexican_restaurant", "restaurant", "food"]), "Mexican");
  assert.equal(restaurantTypeLabel(["tourist_attraction", "restaurant"], "tourist_attraction"), "Restaurant (type not specified)");
  assert.equal(restaurantTypeLabel(["coffee_shop", "cafe"], "coffee_shop"), "Coffee shop");
});

test("adapter sends a bounded, field-masked distance query and normalizes results", async () => {
  let sent: RequestInit | undefined;
  const result = await fetchNearbyRestaurants(candidate, "Mexican food", deps(async (_url, init) => {
    sent = init;
    return new Response(JSON.stringify({ places: [place("b", "Far Taco", 29.763, ["mexican_restaurant", "restaurant"]), place("a", "Near Steak", 29.7605, ["steak_house", "restaurant"], "steak_house"), place("a", "Near Steak", 29.7605, ["steak_house"])] }));
  }));
  const headers = new Headers(sent?.headers);
  assert.equal(headers.get("X-Goog-FieldMask"), NEARBY_FIELD_MASK);
  const body = JSON.parse(String(sent?.body));
  assert.deepEqual([body.locationRestriction.circle.radius, body.maxResultCount, body.rankPreference, body.includedTypes], [500, 20, "DISTANCE", ["restaurant"]]);
  assert.equal(result.status, "ok");
  assert.deepEqual(result.restaurants.map(r => [r.name, r.typeLabel, r.distanceMeters]), [["Near Steak", "Steak house", 56], ["Far Taco", "Mexican", 334]], "deduplicated and nearest first");
  assert.match(result.restaurants[0].googleMapsUrl, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Near\+Steak&query_place_id=test_place_a$/);
  assert.deepEqual(result.summary?.sameCuisinePlaceIds, ["test_place_b"]);
  assert.equal(result.summary?.capReached, false);
  assert.equal(result.summary?.medianMeters, 195);
});

test("empty results are a successful empty list, not a failure or a zero-competition claim", async () => {
  const result = await fetchNearbyRestaurants(candidate, null, deps(reply({})));
  assert.equal(result.status, "ok");
  assert.equal(result.restaurants.length, 0);
  assert.equal(result.summary?.nearestMeters, null);
});

test("failures are classified and never substitute data", async () => {
  const cases: [typeof fetch, string][] = [
    [reply({ error: { status: "PERMISSION_DENIED" } }, 403), "denied"],
    [reply({ error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." } }, 400), "denied"],
    [reply({ error: { status: "RESOURCE_EXHAUSTED" } }, 429), "rate_limited"],
    [reply({ error: { status: "INTERNAL" } }, 500), "unavailable"],
    [reply({ places: [{ id: "x" }] }), "unavailable"],
    [async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }, "timeout"],
    [async () => { throw new TypeError("fetch failed"); }, "unavailable"],
  ];
  for (const [fetch, status] of cases) {
    const result = await fetchNearbyRestaurants(candidate, null, deps(fetch));
    assert.equal(result.status, status);
    assert.deepEqual([result.restaurants, result.summary], [[], null]);
  }
  const never = async () => { throw new Error("must not call"); };
  assert.equal((await fetchNearbyRestaurants({ ...candidate, isDemo: true }, null, deps(never))).status, "synthetic");
  assert.equal((await fetchNearbyRestaurants({ ...candidate, latitude: null }, null, deps(never))).status, "no_coordinates");
  assert.equal((await fetchNearbyRestaurants(candidate, null, { ...deps(never), apiKey: null })).status, "not_configured");
  assert.equal((await fetchNearbyRestaurants(candidate, null, { ...deps(never), network: false })).status, "unavailable");
});

test("Places content cannot enter saved evidence: there is no provider for it", () => {
  const shape = sourceSnapshotSchema.safeParse({ version: "expansion-investigation-evidence-v1", candidateId: candidate.id, refreshedAt: now, statuses: [{ provider: "google_places", status: "verified", mode: "live", checkedAt: now, capabilities: [], reason: "x" }], observations: [], gaps: [] });
  assert.equal(shape.success, false);
});

async function okResult(): Promise<NearbyRestaurantsResult> {
  return fetchNearbyRestaurants(candidate, "Mexican", deps(reply({ places: [place("a", "Near Steak", 29.7605, ["steak_house"]), place("b", "Far Taco", 29.763, ["mexican_restaurant"])] })));
}

test("grounding check rejects unknown places and invented numbers", async () => {
  const result = await okResult();
  const ok = { overlap: "Far Taco is listed as Mexican, 334 m away.", gaps: "No seafood types among the 2 results.", caveats: [], citedPlaceIds: ["test_place_b"] };
  assert.equal(checkGrounding(ok, result), null);
  assert.match(checkGrounding({ ...ok, citedPlaceIds: ["someone_else"] }, result) ?? "", /outside/);
  assert.match(checkGrounding({ ...ok, gaps: "Expect 1,200 covers a day." }, result) ?? "", /1200/);
  assert.equal(checkGrounding({ ...ok, gaps: "Two results came back." }, result), null, "spelled-out count that matches");
  assert.match(checkGrounding({ ...ok, gaps: "Seven places serve Thai." }, result) ?? "", /7/);
  const named = { ...result, restaurants: [...result.restaurants, { ...result.restaurants[0], placeId: "test_place_c", name: "Tequila 45" }] };
  assert.equal(checkGrounding({ ...ok, overlap: "Tequila 45 is nearby." }, named), null, "digits quoted from a retrieved name are allowed");
});

test("explainer passes only retrieved facts and validates the model output", async () => {
  const result = await okResult();
  let prompt = "";
  const output = { overlap: "Far Taco shares your Mexican type.", gaps: "No seafood listed among these results.", caveats: ["Google types can be wrong."], citedPlaceIds: ["test_place_b"] };
  const gemini = (text: string) => async (_url: unknown, init?: RequestInit) => { prompt = String(init?.body); return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] })); };
  const explanation = await explainNearbyRestaurants(result, "Test Cantina", { fetch: gemini(JSON.stringify(output)) as typeof fetch, apiKey: "k", model: "gemini-test", now: () => now });
  assert.equal(explanation.origin, "assumed");
  assert.deepEqual(explanation.citedPlaceIds, ["test_place_b"]);
  assert.match(prompt, /Far Taco/);
  assert.doesNotMatch(prompt, /Test St/, "addresses are not sent to the model");
  await assert.rejects(explainNearbyRestaurants(result, null, { fetch: gemini(JSON.stringify({ ...output, gaps: "Demand is 40% higher." })) as typeof fetch, apiKey: "k", model: "gemini-test" }), /discarded/);
  await assert.rejects(explainNearbyRestaurants(result, null, { fetch: gemini("not json") as typeof fetch, apiKey: "k", model: "gemini-test" }), /format/);
  await assert.rejects(explainNearbyRestaurants({ ...result, status: "denied" }, null, { apiKey: "k" }), /no retrieved results/);
});

test("summary flags the 20-result cap", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ placeId: `p${i}`, name: `R${i}`, address: null, typeLabel: "Pizza", distanceMeters: i * 10, latitude: 29.76, longitude: -95.37, googleMapsUrl: "https://www.google.com/maps" }));
  const summary = summarizeNearby(rows, "pizza");
  assert.equal(summary.capReached, true);
  assert.equal(summary.sameCuisinePlaceIds.length, 20);
  assert.deepEqual(summary.typeCounts, [{ label: "Pizza", count: 20 }]);
});
