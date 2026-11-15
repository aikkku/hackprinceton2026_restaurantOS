import test from "node:test";
import assert from "node:assert/strict";
import demo from "./frontend/data/demo-restaurant.json" with { type: "json" };
import { datasetSchema } from "./domain/dataset.ts";
import { reviewAnalysisVersion, matchesReview, validateReviewBatch, type AnalyzedReview } from "./domain/review-analysis.ts";
import { createReviewAnalysisHandler, createReviewProcessor, reviewAnalysisKey } from "./backend/review-analysis.ts";
import type { ReviewAnalysisRepository } from "./backend/review-analysis-store.ts";
import type { generateStructured } from "./backend/gemini.ts";
import { createDataApi } from "./backend/data-api.ts";
import type { DatasetRepository } from "./backend/mongodb.ts";

const dataset = datasetSchema.parse(demo);
function memoryRepository() {
  const values = new Map<string, AnalyzedReview>();
  const leases = new Map<string, { owner: string; until: number }>();
  const repository: ReviewAnalysisRepository = {
    async read(keys) { return new Map(keys.flatMap(key => values.has(key) ? [[key, values.get(key)!] as const] : [])); },
    async claim(key, owner, now) {
      if (values.has(key) || (leases.get(key)?.until ?? 0) > now) return false;
      leases.set(key, { owner, until: now + 90_000 }); return true;
    },
    async complete(key, owner, value) { assert.equal(leases.get(key)?.owner, owner); values.set(key, value); leases.delete(key); },
    async release(key, owner) { if (leases.get(key)?.owner === owner) leases.delete(key); },
  };
  return { repository, values, leases };
}
function generator(calls: string[][]) {
  return (async (_schema, _system, prompt) => {
    const { reviews } = JSON.parse(prompt);
    calls.push(reviews.map((row: { id: string }) => row.id));
    return { classifications: reviews.map((row: { id: string; rating: number }) => ({ reviewId: row.id, themes: ["Service"], sentiment: row.rating > 3 ? "positive" : "negative", highPriority: row.rating < 3, reason: "Test interpretation tied to the supplied review." })) };
  }) as typeof generateStructured;
}
const request = (method: string, restaurantId = dataset.profile.id) => new Request(`http://localhost/api/tactical/reviews/analysis?restaurantId=${restaurantId}`, {
  method, headers: { origin: "http://localhost", "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify({ restaurantId }) } : {}),
});

test("reviews classify once across processor instances and only new or edited content reruns", async () => {
  const { repository, values } = memoryRepository();
  const calls: string[][] = [];
  const make = () => createReviewProcessor({ repository, generate: generator(calls), budget: () => true, model: () => "test-model" });
  let processor = make();
  let state = await processor.process(dataset);
  while (state.pending) state = await processor.process(dataset);
  assert.equal(values.size, 30); assert.equal(calls.length, 3);
  processor = make();
  assert.equal((await processor.process(dataset)).pending, 0); assert.equal(calls.length, 3);
  const changed = structuredClone(dataset);
  changed.reviews.push({ ...changed.reviews[0], id: "new-comment", text: "Our takeaway order was missing its soup." });
  await processor.process(changed);
  assert.deepEqual(calls.at(-1), ["new-comment"]);
  changed.reviews[0].text += " Updated detail.";
  await processor.process(changed);
  assert.deepEqual(calls.at(-1), [changed.reviews[0].id]);
  changed.reviews[1].themes = ["Manually edited fixture tags"];
  await processor.process(changed); assert.equal(calls.length, 5);
  const removed = { ...changed, reviews: changed.reviews.slice(1) };
  assert.ok(!(await processor.status(removed)).records.some(row => row.source.id === changed.reviews[0].id));
});

test("concurrent requests lease each review once and reuse completed results", async () => {
  const { repository } = memoryRepository(); const calls: string[][] = [];
  const processor = createReviewProcessor({ repository, generate: generator(calls), budget: () => true });
  const small = { ...dataset, reviews: dataset.reviews.slice(0, 6) };
  await Promise.all([processor.process(small), processor.process(small), processor.process(small)]);
  assert.equal(calls.flat().length, 6); assert.equal(new Set(calls.flat()).size, 6);
  assert.equal((await processor.status(small)).pending, 0);
});

test("provider failures and invalid coverage release leases without storing fabricated classifications", async () => {
  for (const invalid of [null, { classifications: [] }, { classifications: [{ reviewId: "wrong", themes: ["Service"], sentiment: "negative", highPriority: true, reason: "Wrong ID" }] }]) {
    const { repository, values, leases } = memoryRepository();
    const processor = createReviewProcessor({ repository, budget: () => true, generate: (async () => { if (invalid === null) throw new Error("private provider error"); return invalid; }) as typeof generateStructured });
    const small = { ...dataset, reviews: dataset.reviews.slice(0, 1) };
    await assert.rejects(processor.process(small));
    assert.equal(values.size, 0); assert.equal(leases.size, 0);
    const retry = createReviewProcessor({ repository, budget: () => true, generate: generator([]) });
    assert.equal((await retry.process(small)).pending, 0);
  }
});

test("priority coverage is exact, source edits invalidate labels and restaurant IDs isolate keys", () => {
  const review = dataset.reviews[0];
  const row = { reviewId: review.id, themes: ["Seating", "Seating"], sentiment: "negative", highPriority: true, reason: "Seating complaint." };
  assert.deepEqual(validateReviewBatch({ classifications: [row] }, [review])[0].themes, ["Seating"]);
  assert.throws(() => validateReviewBatch({ classifications: [row, row] }, [review]));
  assert.throws(() => validateReviewBatch({ classifications: [{ ...row, themes: ["invented taxonomy"] }] }, [review]));
  const source = { id: review.id, text: review.text, date: review.date, rating: review.rating };
  const record: AnalyzedReview = { restaurantId: dataset.profile.id, source, classification: { ...row, themes: ["Seating"], sentiment: "negative" }, model: "test", pipelineVersion: reviewAnalysisVersion, processedAt: new Date().toISOString() };
  assert.equal(matchesReview(record, dataset.profile.id, review), true);
  assert.equal(matchesReview(record, dataset.profile.id, { ...review, text: "Changed" }), false);
  assert.notEqual(reviewAnalysisKey("another-restaurant", review), reviewAnalysisKey(dataset.profile.id, review));
});

test("review API serves cached data, protects generation and hides provider failures", async () => {
  const { repository } = memoryRepository(); const calls: string[][] = [];
  const processor = createReviewProcessor({ repository, budget: () => true, generate: generator(calls) });
  const small = { ...dataset, reviews: dataset.reviews.slice(0, 2) };
  const handler = createReviewAnalysisHandler({ load: async () => small, processor, authorize: () => true, enabled: () => true });
  assert.equal((await (await handler(request("GET"))).json()).pending, 2); assert.equal(calls.length, 0);
  assert.equal((await (await handler(request("POST"))).json()).pending, 0);
  await handler(request("POST")); assert.equal(calls.length, 1);
  assert.equal((await handler(request("POST", "another-restaurant"))).status, 404);
  const locked = createReviewAnalysisHandler({ load: async () => small, processor, authorize: () => false, enabled: () => true });
  assert.equal((await locked(request("POST"))).status, 401);
  const crossOrigin = new Request("http://localhost/api/tactical/reviews/analysis", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ restaurantId: small.profile.id }) });
  assert.equal((await handler(crossOrigin)).status, 401);
  const failed = createReviewAnalysisHandler({ load: async () => { throw new Error("secret database detail"); }, enabled: () => true });
  const response = await failed(request("GET"));
  assert.equal(response.status, 503); assert.equal((await response.json()).error, "Something is wrong");
  const offline = createReviewAnalysisHandler({ load: async () => small, enabled: () => false });
  assert.equal((await (await offline(request("GET"))).json()).storage, "unavailable");
});

test("successful dataset ingestion runs review processing once and an AI outage does not undo the saved upload", async () => {
  const original = process.env.TACTICAL_API_TOKEN; process.env.TACTICAL_API_TOKEN = "test-token-".repeat(5);
  try {
    let saves = 0; let processing = 0;
    const repository: DatasetRepository = { async read() { return null; }, async list() { return []; }, async save(next) { saves++; return { _id: next.profile.id, revision: 1, updatedAt: new Date().toISOString(), dataset: next }; } };
    const input = () => new Request("http://localhost/api/tactical/restaurants/juniper-table/dataset", { method: "PUT", headers: { authorization: `Bearer ${process.env.TACTICAL_API_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 0, dataset }) });
    const api = createDataApi(repository, async () => { processing++; return { pending: 0 }; });
    const response = await api(input(), dataset.profile.id);
    assert.equal(response.status, 201); assert.equal(processing, 1); assert.equal(saves, 1);
    assert.equal((await response.json()).reviewAnalysis.pending, 0);
    const failed = createDataApi(repository, async () => { throw new Error("private failure"); });
    const saved = await failed(input(), dataset.profile.id);
    assert.equal(saved.status, 201); assert.equal(saves, 2);
    assert.deepEqual((await saved.json()).reviewAnalysis, { error: "Something is wrong" });
  } finally { if (original === undefined) delete process.env.TACTICAL_API_TOKEN; else process.env.TACTICAL_API_TOKEN = original; }
});


test("incoming reviews do not require authored themes before AI classification", () => {
  const source = structuredClone(demo) as unknown as { reviews: Array<{ themes?: string[] }> };
  delete source.reviews[0].themes;
  assert.deepEqual(datasetSchema.parse(source).reviews[0].themes, []);
});
