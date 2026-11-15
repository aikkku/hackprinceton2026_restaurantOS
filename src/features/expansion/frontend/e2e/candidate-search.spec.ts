import { expect, test } from "@playwright/test";

/**
 * Phase 2 acceptance journey against the REAL backend reading a test-owned
 * synthetic cache (seeded by global-setup.ts through the real import
 * pipeline). No new API route is mocked here; the only route mock is the
 * controlled source-failure injection for the retry path.
 */

test("profile-driven full-city search: run, groups, inspector reasons, pagination, stable pan, controlled error retry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/expansion");

  // Choose the example profile and continue to the explorer (the unsaved
  // profile revision is enough to drive a run).
  await page.getByRole("button", { name: "Use example restaurant" }).click();
  await expect(page.locator(".answer-list article")).toHaveCount(7);
  await page.getByRole("button", { name: "Continue to the scouting map" }).click();
  await page.getByLabel("Data mode").selectOption("local");
  await expect(page.locator(".profile-strip")).toContainText("Cedar Kitchen");
  await expect(
    page.getByRole("button", { name: "Start profile search" }),
  ).toBeVisible();

  // Controlled source failure: the first create-run POST fails, then retries.
  await page.route(
    "**/api/expansion/runs",
    (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: "source_failure", message: "Synthetic controlled failure" } },
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "Start profile search" }).click();
  await expect(page.locator(".run-section").getByRole("alert")).toContainText("Synthetic controlled failure");
  await page.getByRole("button", { name: "Retry search" }).click();

  // The real backend searches the synthetic snapshot (37 offered spaces:
  // 30 active candidates, 5 incompatible uses, 2 off-market). Triple-net
  // quotes above the cap fail deterministically, the rest need verification.
  // Generous timeouts: the dev server compiles each route on first hit.
  await expect(page.locator(".run-summary")).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".run-section")).toContainText("37 offered spaces examined", { timeout: 30000 });
  await expect(page.locator(".run-section")).toContainText("30 candidates", { timeout: 30000 });
  await expect(page.locator(".summary-chip.reject")).toContainText("12 do not meet", { timeout: 30000 });
  // Snapshot facts alone cannot verify kitchen/parking: the no-verified-match
  // state must be visible and truthful.
  await expect(
    page.getByText(/No space fully verifies all hard requirements/),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("tab", { name: /Needs verification \(18\)/ }),
  ).toBeVisible({ timeout: 30000 });
  await expect(
    page.getByRole("tab", { name: /Does not meet \(12\)/ }),
  ).toBeVisible({ timeout: 30000 });

  // Pagination over the loaded candidates.
  await expect(page.locator(".candidate-card")).toHaveCount(20, { timeout: 30000 });
  await expect(page.locator(".run-pagination").first()).toContainText("Showing 1–20 of 30", { timeout: 30000 });
  await page.locator(".run-pagination").first().getByRole("button", { name: "Next" }).click();
  await expect(page.locator(".run-pagination").first()).toContainText("Showing 21–30 of 30", { timeout: 30000 });
  await expect(page.locator(".candidate-card")).toHaveCount(10, { timeout: 30000 });
  await page.locator(".run-pagination").first().getByRole("button", { name: "Previous" }).click();
  await expect(page.locator(".candidate-card")).toHaveCount(20, { timeout: 30000 });

  // Select a candidate and inspect its requirement reasons.
  await page.locator(".candidate-card").first().click();
  const inspector = page.getByRole("complementary", { name: "Property Scout" });
  await expect(inspector).toContainText("PROFILE ASSESSMENT", { timeout: 20000 });
  await expect(page.getByLabel("Requirement assessment")).toContainText("needs verification", { timeout: 20000 });
  await expect(page.getByLabel("Requirement assessment")).toContainText("unverified");
  await expect(page.getByLabel("Requirement assessment")).toContainText("Source value:");

  // Discoverable excluded-record view with reasons.
  await page.locator(".excluded-list summary").click();
  await expect(page.locator(".excluded-list")).toContainText("off market");
  await expect(page.locator(".excluded-list")).toContainText("incompatible space use");

  // Panning the map cannot change the run results.
  const before = await page.locator(".run-summary").textContent();
  const map = page.locator(".scout-map");
  const box = await map.boundingBox();
  assertBox(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 110, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(".run-summary")).toHaveText(before ?? "");
  await expect(page.locator(".candidate-card")).toHaveCount(20);

  expect(errors).toEqual([]);
});

function assertBox(box: { x: number; y: number; width: number; height: number } | null): asserts box is { x: number; y: number; width: number; height: number } {
  expect(box).not.toBeNull();
}
