import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { datasetSchema } from "./domain/dataset.ts";
import { aiError, validateAiResult, proposedAiLayout, type AiResult, type AiRequest } from "./domain/ai.ts";
import { buildAiContext } from "./backend/ai-context.ts";
import { createAiHandler } from "./backend/ai-service.ts";
import { createPhotoHandler } from "./backend/analyze.ts";
import { aiSession, authorizedAi, boundedJson, sameOrigin } from "./backend/ai-access.ts";
import type { generateStructured } from "./backend/gemini.ts";

const dataset = datasetSchema.parse(JSON.parse(readFileSync(new URL("./frontend/data/demo-restaurant.json", import.meta.url), "utf8")));
const input: AiRequest = { task: "floor", restaurantId: dataset.profile.id, question: "Review this layout", layout: dataset.layout };
const valid: AiResult = { summary: "Inspect declared seating geometry.", limitations: ["No measured comfort or utilization data."], findings: [{ title: "Inspect layout", explanation: "The plan contains seating groups.", action: "Verify measurements.", priority: "low", confidence: "low", evidenceIds: ["metric:layout"], cost: "Unknown" }], classifications: [], draft: null, customObject: null, moves: [] };
function request(body: unknown = input, origin = "http://localhost") { return new Request("http://localhost/api/tactical/ai", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }); }
const generated = (value: unknown) => (async () => value) as typeof generateStructured;

test("AI context excludes employee contacts, computes canonical ledger values, and enforces restaurant ownership", () => {
  const context = buildAiContext(dataset, { ...input, task: "advisor" });
  assert.ok(context.evidence.some(item => item.id === "metric:ledger"));
  assert.equal(context.evidence.some(item => item.detail.includes("@example.com")), false);
  assert.throws(() => buildAiContext(dataset, { ...input, restaurantId: "other" }));
  assert.throws(() => buildAiContext(dataset, { ...input, task: "reply", reviewId: "missing" }));
});

test("AI outputs reject fabricated evidence, invalid quotes and incomplete review coverage", () => {
  const { evidence, layout } = buildAiContext(dataset, input);
  assert.deepEqual(validateAiResult(valid, input, evidence, layout), valid);
  assert.throws(() => validateAiResult({ ...valid, findings: [{ ...valid.findings[0], evidenceIds: ["review:invented"] }] }, input, evidence, layout));
  const reviews = { ...input, task: "reviews" as const };
  const reviewContext = buildAiContext(dataset, reviews);
  assert.throws(() => validateAiResult({ ...valid, findings: [], classifications: [] }, reviews, reviewContext.evidence, layout));
  const classifications = dataset.reviews.map(review => ({ reviewId: review.id, sentiment: "mixed", themes: ["Service"], quote: review.text.slice(0, 20), menuItemIds: [] }));
  assert.equal(validateAiResult({ ...valid, findings: [], classifications }, reviews, reviewContext.evidence, layout).classifications.length, dataset.reviews.length);
  assert.throws(() => validateAiResult({ ...valid, findings: [], classifications: [{ ...classifications[0], quote: "Fabricated review quote" }, ...classifications.slice(1)] }, reviews, reviewContext.evidence, layout));
  assert.throws(() => validateAiResult({ ...valid, findings: [], classifications: [{ ...classifications[0], menuItemIds: ["invented"] }, ...classifications.slice(1)] }, reviews, reviewContext.evidence, layout));
});

test("AI proposals cannot invent objects, alter capacity, overlap footprints or leave room bounds", () => {
  const layout = { ...dataset.layout, objects: dataset.layout.objects.slice(0, 1) };
  const object = layout.objects[0];
  const moves = [{ objectId: object.id, x: 0, y: 0, reason: "Inspect this option." }];
  const next = proposedAiLayout(layout, moves);
  assert.equal(next.objects[0].seats, object.seats);
  assert.equal(next.objects[0].width, object.width);
  assert.notEqual(next, layout);
  assert.throws(() => proposedAiLayout(layout, [{ ...moves[0], objectId: "invented" }]));
  assert.throws(() => proposedAiLayout(layout, [{ ...moves[0], x: 99 }]));
  assert.throws(() => proposedAiLayout(layout, [moves[0], moves[0]]));
  assert.throws(() => proposedAiLayout({ ...layout, objects: [object, { ...object, id: "block", x: 0, y: 0 }] }, moves));
});

test("AI route validates citations, caches exact context and invalidates when questions change", async () => {
  let calls = 0;
  const generate = (async () => { calls++; return valid; }) as typeof generateStructured;
  const handle = createAiHandler({ load: async () => dataset, generate, authorize: () => true, budget: () => true });
  assert.equal((await handle(request())).status, 200);
  assert.equal((await (await handle(request())).json()).cached, true);
  assert.equal(calls, 1);
  await handle(request({ ...input, question: "Different question" }));
  assert.equal(calls, 2);
  const invalid = createAiHandler({ load: async () => dataset, generate: generated({ ...valid, findings: [{ ...valid.findings[0], evidenceIds: ["invented"] }] }), authorize: () => true, budget: () => true });
  assert.deepEqual(await (await invalid(request())).json(), { ok: false, error: aiError });
});

test("all provider, auth, origin, budget and body failures return only the requested generic error", async () => {
  const failing = (async () => { throw new Error("private provider details"); }) as typeof generateStructured;
  for (const dependencies of [
    { generate: failing, authorize: () => true, budget: () => true },
    { generate: generated(valid), authorize: () => false, budget: () => true },
    { generate: generated(valid), authorize: () => true, budget: () => false },
  ]) {
    const handle = createAiHandler({ load: async () => dataset, ...dependencies });
    assert.deepEqual(await (await handle(request())).json(), { ok: false, error: aiError });
  }
  const handle = createAiHandler({ load: async () => dataset, generate: generated(valid), authorize: () => true, budget: () => true });
  assert.equal((await handle(request(input, "https://other.example"))).status, 403);
  assert.deepEqual(await (await handle(request({ ...input, question: "x".repeat(300_000) }))).json(), { ok: false, error: aiError });
  await assert.rejects(boundedJson(request({ text: "large" }), 2));
});

test("AI session uses an expiring signed HTTP-only cookie and rejects incorrect or malformed credentials", async () => {
  assert.equal(sameOrigin(new Request("http://localhost:3057/api", { headers: { host: "127.0.0.1:3057", origin: "http://127.0.0.1:3057" } })), true);
  assert.equal(sameOrigin(new Request("http://localhost:3057/api", { headers: { host: "127.0.0.1:3057", origin: "http://evil.example" } })), false);
  const old = process.env.TACTICAL_AI_PASSWORD;
  process.env.TACTICAL_AI_PASSWORD = "test-only-password-at-least-32-characters";
  try {
    const unlock = await aiSession(request({ password: process.env.TACTICAL_AI_PASSWORD }));
    assert.equal(unlock.status, 200);
    const cookie = unlock.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
    assert.equal(authorizedAi(new Request("http://localhost", { headers: { cookie: cookie.split(";")[0] } })), true);
    assert.equal(authorizedAi(new Request("http://localhost", { headers: { cookie: `tactical_ai=1.fake.bad` } })), false);
    assert.deepEqual(await (await aiSession(request({ password: "wrong" }))).json(), { ok: false, error: aiError });
    assert.equal((await aiSession(request({ password: "é".repeat(process.env.TACTICAL_AI_PASSWORD.length) }))).status, 401);
  } finally { if (old === undefined) delete process.env.TACTICAL_AI_PASSWORD; else process.env.TACTICAL_AI_PASSWORD = old; }
});

test("photo AI failures never produce a sample fallback", async () => {
  const input = { photos: ["data:image/png;base64,AAAA"], facts: { entranceWall: "unknown", cashierWall: "unknown", barWall: "unknown", tableCounts: "", tableSpacing: "", notes: "" }, accuracy: "standard", lessons: [] };
  const handle = createPhotoHandler((async () => { throw new Error("provider failed"); }) as typeof generateStructured, () => true, () => true);
  const response = await handle(request(input));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: aiError });
  const good = createPhotoHandler(generated(dataset.photoPlans.blank), () => true, () => true);
  const result = await (await good(request(input))).json();
  assert.equal(result.source, "ai");
});
