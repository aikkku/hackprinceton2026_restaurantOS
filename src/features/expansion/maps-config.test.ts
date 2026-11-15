import test from "node:test";
import assert from "node:assert/strict";
import { mapsBrowserConfig } from "./backend/maps-config.ts";

// Synthetic key-shaped strings only.
const browser = "AIzaSyBrowserKeyForTestsOnly_123456789";
const server = "AIzaSyServerKeyForTestsOnly_9876543210";

test("browser map config never exposes the server Places key", () => {
  assert.deepEqual(mapsBrowserConfig({ GOOGLE_MAPS_BROWSER_KEY: browser, GOOGLE_MAPS_API_KEY: server }), { browserKey: browser, mapId: "DEMO_MAP_ID", reason: null });
  assert.equal(mapsBrowserConfig({ GOOGLE_MAPS_BROWSER_KEY: server, GOOGLE_MAPS_API_KEY: server }).browserKey, null);
  assert.equal(mapsBrowserConfig({ GOOGLE_MAPS_BROWSER_KEY: ` ${server} `, GOOGLE_PLACES_API_KEY: server }).browserKey, null);
  assert.match(mapsBrowserConfig({ GOOGLE_MAPS_API_KEY: server }).reason ?? "", /not configured/);
  assert.equal(mapsBrowserConfig({ GOOGLE_MAPS_BROWSER_KEY: "bad key!" }).browserKey, null);
  assert.equal(mapsBrowserConfig({ GOOGLE_MAPS_BROWSER_KEY: browser, GOOGLE_MAPS_MAP_ID: "abc123" }).mapId, "abc123");
  assert.equal(mapsBrowserConfig({ GOOGLE_MAPS_BROWSER_KEY: browser, GOOGLE_MAPS_MAP_ID: "<script>" }).mapId, "DEMO_MAP_ID");
});
