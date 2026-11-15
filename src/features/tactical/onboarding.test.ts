import test from "node:test";
import assert from "node:assert/strict";
import demo from "./frontend/data/demo-restaurant.json" with { type: "json" };
import { datasetSchema } from "./domain/dataset.ts";
import { initialOnboardingDraft, onboardingDraftSchema, summarizeOnboarding } from "./domain/onboarding.ts";
import { createOnboardingHandler } from "./backend/onboarding.ts";

const dataset = datasetSchema.parse(demo);
const request = (body: unknown, origin = "http://localhost") => new Request("http://localhost/api/tactical/onboarding", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("demo setup derives its summary from the same selected dataset without mutating it", async () => {
  const before = structuredClone(dataset);
  const handle = createOnboardingHandler(async () => ({ dataset, source: "MongoDB · mock data", revision: 8 }));
  const response = await handle(request({ demo: true }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.restaurant.name, dataset.profile.name);
  assert.equal(result.restaurant.counts.team, 7);
  assert.equal(result.restaurant.counts.menu, dataset.operations.menu.length);
  assert.equal(result.restaurant.revision, 8);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal("employees" in result.restaurant, false);
  assert.deepEqual(dataset, before);
});

test("real setup, unexpected details and cross-origin requests never load or change the dataset", async () => {
  let loads = 0;
  const handle = createOnboardingHandler(async () => { loads++; return { dataset, source: "Local mock fixture", revision: null }; });
  for (const body of [{ demo: false }, {}, { demo: true, name: "Uploaded restaurant" }, { demo: true, files: ["private menu"] }, { demo: true, extra: "x".repeat(2048) }]) {
    assert.equal((await handle(request(body))).status, 422);
  }
  assert.equal((await handle(request({ demo: true }, "https://other.example"))).status, 403);
  assert.equal(loads, 0);
});

test("unavailable demo reports a retryable failure without leaking provider details or silently substituting data", async () => {
  const handle = createOnboardingHandler(async () => { throw new Error("private provider detail"); });
  const response = await handle(request({ demo: true }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /try again/);
  assert.throws(() => summarizeOnboarding({ ...dataset, isDemo: false } as unknown as typeof dataset, "real", null));
});

test("browser draft requires the current version, bounded strings and an explicit data mode", () => {
  assert.equal(onboardingDraftSchema.safeParse(initialOnboardingDraft).success, true);
  for (const patch of [{ version: 2 }, { step: "ready" }, { demo: "true" }, { name: "x".repeat(121) }, { goal: "unknown" }]) {
    assert.equal(onboardingDraftSchema.safeParse({ ...initialOnboardingDraft, ...patch }).success, false);
  }
});
