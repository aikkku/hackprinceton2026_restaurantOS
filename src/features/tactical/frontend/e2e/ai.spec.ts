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

test("AI panels use purple, show evidence, editable drafts and the exact generic failure message", async ({ page }) => {
  await page.route("**/api/tactical/ai", async route => route.fulfill({ json: response(route.request().postDataJSON().task) }));
  await page.goto("/tactical/reviews");
  const research = page.getByRole("region", { name: "AI review researcher", exact: true });
  await research.getByRole("button", { name: "Generate with AI" }).click();
  await expect(research.getByText("Test AI reviews interpretation")).toBeVisible();
  expect(await research.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(247, 242, 255)");
  await research.getByText("Supporting evidence · 1").click();
  await expect(research.getByText(demo.profile.name, { exact: true })).toBeVisible();
  const reply = page.getByRole("region", { name: "AI review reply", exact: true });
  await reply.getByRole("button", { name: "Generate with AI" }).click();
  await reply.getByLabel("Edit AI draft").fill("My reviewed reply.");
  await expect(reply.getByLabel("Edit AI draft")).toHaveValue("My reviewed reply.");
  await page.unroute("**/api/tactical/ai");
  await page.route("**/api/tactical/ai", route => route.fulfill({ status: 503, json: { ok: false, error: "private provider failure" } }));
  await research.getByRole("button", { name: "Generate with AI" }).click();
  await expect(research.getByRole("alert")).toHaveText("Something is wrong");
  await expect(research.getByText("Test AI reviews interpretation")).toHaveCount(0);
  await expect(page.getByText("private provider failure")).toHaveCount(0);
});

test("AI object estimates require explicit use and placement and retain purple provenance after save", async ({ page }) => {
  await page.route("**/api/tactical/ai", async route => route.fulfill({ json: response(route.request().postDataJSON().task) }));
  await page.goto("/tactical");
  const designer = page.getByRole("region", { name: "AI custom-object designer", exact: true });
  await designer.getByLabel("Describe the object").fill("A refrigerator");
  const initial = await page.locator("[data-object]").count();
  await designer.getByRole("button", { name: "Generate with AI" }).click();
  await expect(designer.getByRole("button", { name: "Use object suggestion" })).toBeVisible();
  await expect(page.locator("[data-object]")).toHaveCount(initial);
  await designer.getByRole("button", { name: "Use object suggestion" }).click();
  await expect(page.getByLabel("New object name")).toHaveValue("AI refrigerator");
  await expect(page.locator("[data-object]")).toHaveCount(initial);
  await page.getByRole("button", { name: "Place in clear spot" }).click();
  await expect(page.locator(".svg-hit.is-ai-highlighted")).toHaveCount(1);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.reload();
  await expect(page.locator(".svg-hit.is-ai-highlighted")).toHaveCount(1);
});

test("finance, supply, job and advisor workflows are reachable on narrow screens", async ({ page }) => {
  await page.route("**/api/tactical/ai", async route => route.fulfill({ json: response(route.request().postDataJSON().task) }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [route, title, task] of [["finance", "AI financial analysis", "finance"], ["supply", "AI supply advisor", "supply"], ["hr", "AI job-description draft", "job"], ["ai", "AI restaurant advisor", "advisor"]]) {
    await page.goto(`/tactical/${route}`);
    const panel = page.getByRole("region", { name: title, exact: true });
    await panel.locator("textarea").first().fill("Explain this context");
    await panel.getByRole("button", { name: "Generate with AI" }).click();
    await expect(panel.getByText(`Test AI ${task} interpretation`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("AI layout proposals stay separate until applied and stale context disables reuse", async ({ page }) => {
  const object = { id: "table", type: "table_2", seats: 2, x: 1, y: 1, width: 1, depth: 1, rotation: 0 };
  await page.route("**/api/tactical/ai", async route => {
    const data = response(route.request().postDataJSON().task);
    await route.fulfill({ json: { ...data, result: { ...data.result, moves: [{ objectId: "table", x: 3, y: 3, reason: "Test alternative position" }] } } });
  });
  await page.goto("/tactical");
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeEnabled();
  await page.getByLabel("Import layout JSON file").setInputFiles({ name: "layout.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...demo.layout, objects: [object] })) });
  const panel = page.getByRole("region", { name: "AI floor-plan analysis", exact: true });
  await panel.getByRole("button", { name: "Generate with AI" }).click();
  await panel.getByRole("button", { name: "Preview AI layout" }).click();
  await expect(page.locator(".svg-proposed-ai")).toHaveCount(1);
  await expect(page.locator('[data-object="table"]')).toHaveAttribute("transform", "translate(1 1)");
  await page.getByRole("button", { name: "Apply AI layout", exact: true }).click();
  await expect(page.locator('[data-object="table"]')).toHaveAttribute("transform", "translate(3 3)");
  await expect(panel.getByRole("button", { name: "Preview AI layout" })).toBeDisabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('[data-object="table"]')).toHaveAttribute("transform", "translate(1 1)");
});
