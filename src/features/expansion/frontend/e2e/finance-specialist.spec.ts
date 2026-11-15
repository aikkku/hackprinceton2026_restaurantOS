import { expect, test } from "@playwright/test";
import { NEIGHBORHOOD_SOURCE, NEIGHBORHOOD_VERSION } from "../../domain/neighborhood.ts";

test("Finance specialist completes with visibly labeled mock inputs and deterministic results", async ({ page }) => {
  test.setTimeout(180_000);
  await page.route("**/api/expansion/neighborhoods", (route) => route.fulfill({ json: {
    version: NEIGHBORHOOD_VERSION, sourceUrl: NEIGHBORHOOD_SOURCE,
    retrievedAt: "2026-11-15T12:00:00.000Z", sourceDate: null,
    definition: "Synthetic catalog for the finance browser test.", datasetId: "synthetic-e2e-v1",
    neighborhoods: [{ id: 15, name: "GREATER HEIGHTS", listingCount: 31 }],
  } }));
  await page.goto("/expansion");
  await page.getByRole("button", { name: "Try the example restaurant" }).click();
  await expect(page.getByRole("button", { name: /^GREATER HEIGHTS/ })).toHaveAttribute("aria-pressed", "true");
  for (let step = 0; step < 4; step++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  const response = page.waitForResponse((result) => result.url().endsWith("/api/expansion/agent-runs") && result.request().method() === "POST");
  await page.getByRole("button", { name: "Find Locations" }).click();
  const started = await response;
  expect(started.ok()).toBe(true);
  const intake = started.request().postDataJSON().intake;
  expect(intake.isDemo).toBe(true);
  expect(intake.origin).toBe("simulated_finance");
  expect(intake.financialBaseline.netSales).toBe(60000);
  await expect(page.getByRole("heading", { name: /We found 31 places/ })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("list", { name: "Search progress" }).getByText("Comparing costs").locator("..").getByText("Done", { exact: true })).toBeVisible();
  await page.getByText("View details").click();
  const finance = page.locator(".sx-agent").filter({ has: page.getByText("Finance specialist", { exact: true }) });
  await expect(finance.getByText("Finished", { exact: true })).toBeVisible();
  await expect(finance.getByText(/Mock baseline: \$16,000 monthly fixed costs ÷ 40% contribution margin = \$40,000 required monthly sales before rent/)).toBeVisible();
  await expect(finance.getByText(/Unknown rent or extra charges stay unknown/)).toBeVisible();
  await expect(page.getByText("Test mode: scripted model (not a live AI run)")).toBeVisible();
  await expect(page.getByRole("button", { name: "See locations" })).toBeEnabled();
});
