import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEnvironment } from "./preflight.mjs";
const base = { TACTICAL_DATA_SOURCE: "demo", TACTICAL_AI_PASSWORD: "a".repeat(40), TACTICAL_API_TOKEN: "b".repeat(40), EXPANSION_SESSION_SECRET: "c".repeat(40), EXPANSION_ACCESS_CODE: "d".repeat(40), EXPANSION_PERSISTENCE: "file" };
test("local fixture deployment needs no external provider or database credentials", () => assert.deepEqual(checkEnvironment(base), []));
test("public deployment rejects missing or shared credentials without printing them", () => {
  assert.equal(checkEnvironment({}).length, 5);
  const secret = "do-not-log-this-credential-1234567890";
  const errors = checkEnvironment({ ...base, TACTICAL_AI_PASSWORD: secret, TACTICAL_API_TOKEN: secret });
  assert.equal(errors.length, 1); assert.ok(!errors.join().includes(secret));
});
test("Mongo deployment requires explicit storage settings and restaurant binding", () => {
  assert.equal(checkEnvironment({ ...base, TACTICAL_DATA_SOURCE: "mongodb" }).length, 3);
  assert.deepEqual(checkEnvironment({ ...base, TACTICAL_DATA_SOURCE: "mongodb", MONGODB_URI: "mongodb://localhost:27017", MONGODB_DB: "restaurantos", TACTICAL_RESTAURANT_ID: "juniper-table" }), []);
});
test("unsupported data modes and a remote worker bridge fail before startup", () => {
  assert.equal(checkEnvironment({ ...base, TACTICAL_DATA_SOURCE: "other", EXPANSION_AGENT_BRIDGE_URL: "https://example.com" }).length, 2);
});
