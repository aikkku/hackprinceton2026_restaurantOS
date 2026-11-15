import { test, expect } from "@playwright/test";
import demo from "../data/demo-restaurant.json" with { type: "json" };
import { reviewTopics, type AnalyzedReview } from "../../domain/review-analysis";

const records: AnalyzedReview[] = demo.reviews.map((review, index) => ({
  restaurantId: demo.profile.id,
  source: { id: review.id, text: review.text, rating: review.rating, date: review.date },
  classification: { reviewId: review.id, themes: [reviewTopics[index % reviewTopics.length]], sentiment: index === 0 ? "negative" : "positive", highPriority: index === 0, reason: "An actionable test concern in this specific review." },
  model: "test-provider", processedAt: "2026-11-15T01:00:00.000Z", pipelineVersion: "review-triage-v1",
}));
const state = (rows: AnalyzedReview[]) => ({ ok: true, records: rows, total: demo.reviews.length, pending: demo.reviews.length - rows.length, busy: false, storage: "mongodb" });

test("laptop review views retain filters and independently scroll by keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route("**/api/tactical/reviews/analysis**", route => route.fulfill({ json: state(records) }));
  await page.goto("/tactical/reviews");
  await expect(page.getByText("30 of 30 classified · saved to MongoDB")).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Customer signals views" });
  const feed = page.getByRole("list", { name: "Customer review results" });
  const themes = page.getByRole("region", { name: "Filter by review theme" });
  for (const region of [feed, themes]) {
    await region.focus();
    await region.press("End");
    await expect.poll(() => region.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  }
  await page.getByRole("checkbox", { name: "High priority" }).check();
  await expect(page.locator("[data-review-id]")).toHaveCount(1);
  await navigation.getByRole("button", { name: "Relationship network", exact: true }).click();
  await expect(navigation.getByRole("button", { name: "Relationship network", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Relationship filter").selectOption("commented");
  await navigation.getByRole("button", { name: "Content & connectivity", exact: true }).click();
  await expect(page.getByRole("region", { name: "Content and connectivity pipeline" })).toBeVisible();
  await navigation.getByRole("button", { name: "Relationship network", exact: true }).click();
  await expect(page.getByLabel("Relationship filter")).toHaveValue("commented");
  await navigation.getByRole("button", { name: "Review evidence", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "High priority" })).toBeChecked();
  await expect(page.locator("[data-review-id]")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("reviews use saved AI themes, sentiment and high priority instead of fixture mission tags", async ({ page }) => {
  let generations = 0;
  await page.route("**/api/tactical/ai/session", route => route.fulfill({ json: { unlocked: true } }));
  await page.route("**/api/tactical/reviews/analysis**", route => {
    if (route.request().method() === "POST") generations++;
    return route.fulfill({ json: state(records) });
  });
  await page.goto("/tactical/reviews");
  await expect(page.getByText("30 of 30 classified · saved to MongoDB")).toBeVisible();
  await expect(page.getByText("Mission evidence", { exact: true })).toHaveCount(0);
  await expect(page.getByText("AI review researcher", { exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "High priority" }).check();
  await expect(page.locator("[data-review-id]")).toHaveCount(1);
  await expect(page.locator("[data-review-id]")).toHaveAttribute("data-review-id", demo.reviews[0].id);
  await expect(page.locator(".review-ai-labels")).toHaveAttribute("title", /An actionable test concern in this specific review/);
  await expect(page.getByText("Why this priority?", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear review filters" }).click();
  await page.getByLabel("AI sentiment", { exact: true }).selectOption("negative");
  await expect(page.locator("[data-review-id]")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear review filters" }).click();
  await page.getByRole("region", { name: "Filter by review theme" }).getByRole("button", { name: /Seating/ }).click();
  await expect(page.locator("[data-review-id]")).toHaveCount(3);
  await page.reload();
  await expect(page.getByText("30 of 30 classified · saved to MongoDB")).toBeVisible();
  expect(generations).toBe(0);
});

test("initial classification runs in batches, stops when complete and only requests missing results after reload", async ({ page }) => {
  let saved = records.slice(0, 20); let posts = 0;
  await page.route("**/api/tactical/ai/session", route => route.fulfill({ json: { unlocked: true } }));
  await page.route("**/api/tactical/reviews/analysis**", route => {
    if (route.request().method() === "POST") { posts++; saved = records; }
    return route.fulfill({ json: state(saved) });
  });
  await page.goto("/tactical/reviews");
  await expect(page.getByText("30 of 30 classified · saved to MongoDB")).toBeVisible();
  expect(posts).toBe(1);
  await page.reload();
  await expect(page.getByText("30 of 30 classified · saved to MongoDB")).toBeVisible();
  expect(posts).toBe(1);
});

test("AI failure preserves cached classifications and retry resumes missing reviews", async ({ page }) => {
  let fail = true;
  await page.route("**/api/tactical/ai/session", route => route.fulfill({ json: { unlocked: true } }));
  await page.route("**/api/tactical/reviews/analysis**", route => route.request().method() === "POST" && fail
    ? route.fulfill({ status: 503, json: { error: "private failure" } })
    : route.fulfill({ json: state(fail ? records.slice(0, 5) : records) }));
  await page.goto("/tactical/reviews");
  await expect(page.locator(".review-analysis-status").getByRole("alert")).toHaveText("Something is wrong");
  await expect(page.locator(".review-ai-labels")).toHaveCount(5);
  await expect(page.locator("[data-review-id]")).toHaveCount(30);
  fail = false;
  await page.getByRole("button", { name: "Retry review analysis" }).click();
  await expect(page.getByText("30 of 30 classified · saved to MongoDB")).toBeVisible();
});

test("themes and reviews scroll independently on narrow screens and keyboard users can reach the theme list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/tactical/reviews/analysis**", route => route.fulfill({ json: state(records) }));
  await page.goto("/tactical/reviews");
  const themes = page.getByRole("region", { name: "Filter by review theme" });
  await expect(themes.getByRole("button")).toHaveCount(reviewTopics.length);
  await themes.focus();
  await expect(themes).toBeFocused();
  expect(await themes.evaluate(el => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === "auto")).toBe(true);
  expect(await page.locator(".review-list").evaluate(el => el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY === "auto")).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
