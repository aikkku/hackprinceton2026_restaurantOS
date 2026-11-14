import assert from "node:assert/strict";
import test from "node:test";
import { filterReviews, summarizeReviews } from "./domain/reviews.ts";
import type { Fixture } from "./domain/schemas.ts";

const reviews: Fixture["reviews"] = [
  { id: "review-a", date: "2026-11-01", rating: 3, text: "A long wait for our table.", themes: ["Wait time", "wait time", " Seating "] },
  { id: "review-b", date: "2026-11-02", rating: 5, text: "Lovely service at the counter.", themes: ["Service"] },
  { id: "review-c", date: "2026-11-03", rating: 4, text: "We waited, and then enjoyed our meal.", themes: ["WAIT TIME"] },
];

test("review topics count each review once and retain the contributing source IDs", () => {
  const summary = summarizeReviews(reviews);
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.themes[0], {
    key: "wait time", label: "Wait time", count: 2, fraction: 2 / 3, reviewIds: ["review-a", "review-c"],
  });
  assert.equal(summary.themes.find(({ key }) => key === "seating")?.count, 1);
  assert.equal(summary.meanRating, 4);
  assert.deepEqual(summary.ratings.map(({ count }) => count), [1, 1, 1, 0, 0]);
});

test("review filters combine source citations, topic selection, and text search", () => {
  assert.deepEqual(filterReviews(reviews, {
    query: "TABLE", theme: " seating ", citedOnly: true, evidenceIds: ["review-a", "missing"],
  }).map(({ id }) => id), ["review-a"]);
  assert.deepEqual(filterReviews(reviews, { query: "review-c" }).map(({ id }) => id), ["review-c"]);
  assert.deepEqual(filterReviews(reviews, { query: "counter", theme: "Wait time" }), []);
  assert.deepEqual(filterReviews(reviews, { citedOnly: true, evidenceIds: [] }), []);
  assert.deepEqual(filterReviews(reviews), reviews);
});

test("empty review data yields unavailable mean rating and zero counts", () => {
  const summary = summarizeReviews([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.meanRating, null);
  assert.deepEqual(summary.themes, []);
  assert.ok(summary.ratings.every(({ count, fraction }) => count === 0 && fraction === 0));
  assert.deepEqual(filterReviews([], { query: "table" }), []);
});
