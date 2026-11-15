import { test, expect } from "@playwright/test";
import demo from "../data/demo-restaurant.json" with { type: "json" };

function response(task: string) {
  return { ok: true, model: "test-provider", generatedAt: "2026-11-14T23:00:00.000Z", inputHash: task, cached: false,
    evidence: [{ id: "profile", label: demo.profile.name, detail: JSON.stringify(demo.profile) }],
    result: { summary: `Test AI ${task} interpretation`, limitations: ["Synthetic browser-test response, not a live provider request."],
      findings: [{ title: "Review the evidence", explanation: "A planning hypothesis.", action: "Inspect the source.", priority: "low", confidence: "low", evidenceIds: ["profile"], cost: "Unknown" }],
      classifications: [], draft: ["reply", "job"].includes(task) ? "An editable test draft." : null,
      customObject: task === "custom-object" ? { name: "AI refrigerator", description: "Estimated refrigerator footprint", category: "equipment", width: 1, depth: 1 } : null,
      moves: [],
    },
  };
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/tactical/ai/session", route => route.fulfill({ json: { unlocked: true } }));
});

test("per-review AI responses are editable and copyable, posting stays disabled, and failures are generic", async ({ page }) => {
  await page.route("**/api/tactical/ai", async route => {
    expect(route.request().postDataJSON().reviewId).toBe(demo.reviews[0].id);
    await route.fulfill({ json: response("reply") });
  });
  await page.goto("/tactical/reviews");
  const review = page.locator(`[data-review-id="${demo.reviews[0].id}"]`);
  await expect(review.getByRole("button", { name: "Reply", exact: true })).toBeDisabled();
  await review.getByRole("button", { name: "Draft with AI" }).click();
  const draft = review.getByLabel(`AI response draft for ${demo.reviews[0].id}`);
  await expect(draft).toHaveValue("An editable test draft.");
  await draft.fill("My reviewed reply.");
  await expect(draft).toHaveValue("My reviewed reply.");
  await review.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(review.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  expect(await review.locator(".review-reply-draft").evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(247, 242, 255)");
  await page.unroute("**/api/tactical/ai");
  await page.route("**/api/tactical/ai", route => route.fulfill({ status: 503, json: { ok: false, error: "private provider failure" } }));
  await review.getByRole("button", { name: "Regenerate" }).click();
  await expect(review.getByRole("alert")).toHaveText("Something is wrong");
  await expect(draft).toHaveValue("My reviewed reply.");
  await expect(page.getByText("private provider failure")).toHaveCount(0);
});

test("AI object estimates require explicit use and placement and retain purple provenance after save", async ({ page }) => {
  await page.route("**/api/tactical/ai", async route => route.fulfill({ json: response(route.request().postDataJSON().task) }));
  await page.goto("/tactical");
  await page.getByText("Furniture", { exact: true }).click();
  await page.getByRole("button", { name: "Custom object", exact: true }).click();
  const details = page.locator(".floor-tile").filter({ has: page.getByText("Furniture details", { exact: true }) });
  if (await details.getAttribute("open") === null) await page.getByText("Furniture details", { exact: true }).click();
  await page.getByText("AI furniture designer", { exact: true }).click();
  const designer = page.getByRole("region", { name: "AI custom-object designer", exact: true });
  await designer.getByLabel("Describe the object").fill("A refrigerator");
  const initial = await page.locator("[data-object]").count();
  await designer.getByRole("button", { name: "Generate with AI" }).click();
  await expect(designer.getByRole("button", { name: "Use object suggestion" })).toBeVisible();
  await expect(page.locator("[data-object]")).toHaveCount(initial);
  await designer.getByRole("button", { name: "Use object suggestion" }).click();
  await expect(page.getByLabel("Object name")).toHaveValue("AI refrigerator");
  await expect(page.locator("[data-object]")).toHaveCount(initial);
  await page.getByRole("button", { name: "Place in clear spot" }).click();
  await expect(page.locator(".svg-hit.is-ai-highlighted")).toHaveCount(1);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(page.locator(".svg-hit.is-ai-highlighted")).toHaveCount(1);
});

// Connected advisor chat and narrow-screen coverage live in assistant.spec.ts.

test("AI layout proposals stay separate until applied and stale context disables reuse", async ({ page }) => {
  await page.route("**/api/tactical/ai", async route => {
    const request = route.request().postDataJSON();
    expect(request.layout.objects.some((object: { id: string; x: number }) => object.id === "south-two" && object.x === 5.25)).toBe(true);
    expect(request.layoutVersions.entries[0].layout.objects.length).toBeGreaterThan(1);
    const data = response(request.task);
    await route.fulfill({ json: { ...data, result: { ...data.result, moves: [{ objectId: "south-two", x: 3, y: 5.55, reason: "Test alternative position" }] } } });
  });
  await page.goto("/tactical");
  await page.getByRole("region", { name: "Floor plan editor" }).getByText("The Seating Problem", { exact: true }).click();
  const panel = page.getByRole("region", { name: "AI seating analysis", exact: true });
  await panel.getByRole("button", { name: "Generate with AI" }).click();
  await panel.getByRole("button", { name: "Preview AI layout" }).click();
  await expect(page.locator(".svg-proposed-ai")).toHaveCount(1);
  const table = page.locator('[data-object="south-two"]');
  await expect(table).toHaveAttribute("transform", "translate(5.25 5.55)");
  await page.getByRole("button", { name: "Apply AI layout", exact: true }).click();
  await expect(table).toHaveAttribute("transform", "translate(3 5.55)");
  await expect(panel.getByRole("button", { name: "Preview AI layout" })).toBeDisabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(table).toHaveAttribute("transform", "translate(5.25 5.55)");
});
