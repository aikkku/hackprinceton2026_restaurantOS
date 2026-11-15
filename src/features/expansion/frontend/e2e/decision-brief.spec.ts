import { expect, test, type Page } from "@playwright/test";
const liveModel = process.env.EXPANSION_E2E_LIVE_MODEL === "1";

/** Real Next backend + actual Deep Agents graph/worker/tools/SSE.
 * The model and property cache are explicitly synthetic (Playwright env).
 * Provider failure injection is limited to the refresh edge case.
 */
async function openExplorer(page: Page) {
  await page.goto("/expansion");
  await page.getByRole("button", { name: "Use example restaurant" }).click();
  await page.getByRole("button", { name: "Continue to the scouting map" }).click();
  await page.getByLabel("Data mode").selectOption("local");
  await expect(page.locator(".profile-strip")).toContainText("Cedar Kitchen");
}
async function investigateRealRun(page: Page) {
  await openExplorer(page);
  await expect(page.getByLabel("Agent execution mode")).toHaveValue(liveModel ? "live" : "scripted", { timeout: 45_000 });
  await page.getByRole("button", { name: "Start agent-assisted scouting" }).click();
  await expect(page.getByRole("heading", { name: "Deep Agents run results" })).toBeVisible({ timeout: liveModel ? 300_000 : 90_000 });
  await page.getByRole("button", { name: "Investigate this run" }).click();
  const bench = page.getByRole("region", { name: "Investigation and decision briefs" });
  await expect(bench.getByLabel("Space to investigate")).toBeVisible({ timeout: 45_000 });
  await expect(bench.locator(".decision-run-meta")).toContainText("synthetic test inputs");
  return bench;
}

test("real agent → evidence → assumption → compare → formula → save/reload/restore → revised profile/new run", async ({ page }) => {
  test.setTimeout(liveModel ? 720_000 : 240_000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const bench = await investigateRealRun(page);
  await expect(bench).toContainText(liveModel ? "live model" : "scripted test model");
  await bench.getByLabel(/Compare this space/).check();
  await bench.getByText("Add assumption or dated verification", { exact: true }).click();
  await bench.getByLabel("Investigation note", { exact: true }).fill("Synthetic planning assumption: kitchen may exist; inspect suite before lease.");
  await bench.getByRole("button", { name: "Record investigation note" }).click();
  await expect(bench.locator(".decision-notes")).toContainText("Assumed · planning only");
  await expect(bench.locator(".decision-requirements")).toContainText("No suite-scoped evidence verifies an existing kitchen");
  await bench.getByText("Opening finance assumptions", { exact: true }).click();
  await bench.getByLabel("Fixed costs / month", { exact: true }).fill("10000");
  await bench.getByLabel("Fixed cost scope").selectOption("includes_occupancy");
  await bench.getByLabel("Contribution margin (0–1)").fill("0.4");
  await bench.getByLabel("Average guest spend", { exact: true }).fill("25");
  await bench.getByLabel("Operating days / month").fill("25");
  await bench.getByRole("button", { name: "Apply finance assumptions" }).click();
  await expect(bench.locator(".decision-investigation > .decision-finance-summary")).toContainText("$25,000");
  await bench.getByText("Sources and formula drawer", { exact: true }).click();
  await expect(bench.locator(".decision-source-drawer")).toContainText("complete fixed costs ÷ contribution margin");
  await bench.getByRole("button", { name: "Refresh sources and reassess" }).click();
  await expect(bench.locator(".decision-notice")).toContainText("Sources refreshed", { timeout: 30_000 });
  await expect(bench.locator(".decision-source-drawer")).toContainText("acs: unavailable");
  await expect(bench.locator(".decision-source-drawer")).toContainText("customer parking");
  const firstId = await bench.getByLabel("Space to investigate").inputValue();
  await bench.getByLabel("Space to investigate").selectOption({ index: 1 });
  await bench.getByLabel(/Compare this space/).check();
  await expect(bench.getByRole("region", { name: "Space comparison" }).locator(".decision-comparison-grid > article")).toHaveCount(2);
  await bench.getByLabel("Brief title").fill("Synthetic Cedar decision");
  await bench.getByRole("button", { name: "Save decision brief", exact: true }).click();
  await expect(bench.locator(".decision-notice")).toContainText("Decision brief saved", { timeout: 20_000 });
  // Inspect the actual stored record, not a mocked response.
  const before = await page.evaluate(() => localStorage.getItem("restaurantos.expansion.decision-briefs.v1"));
  expect(before).toContain("Synthetic Cedar decision");
  expect(before).toContain("synthetic-e2e-v1");
  await page.reload();
  await page.getByRole("button", { name: "Continue to the scouting map" }).click();
  const restoredBench = page.getByRole("region", { name: "Investigation and decision briefs" });
  await restoredBench.getByText(/Saved decision briefs \(1\)/).click();
  // Restore even with the provider endpoint unavailable; it must make no call.
  let providerCalls = 0;
  await page.route("**/api/expansion/investigations/**", async route => { providerCalls++; await route.fulfill({ status: 503, json: { error: { code: "synthetic_provider_failure", message: "Synthetic outage" } } }); });
  await restoredBench.getByRole("button", { name: "Restore brief: Synthetic Cedar decision" }).click();
  await expect(restoredBench).toContainText("Restored saved evidence without contacting providers");
  await expect(restoredBench.getByLabel("Space to investigate")).toHaveValue(firstId);
  await expect(restoredBench.locator(".decision-investigation > .decision-finance-summary")).toContainText("$25,000");
  expect(providerCalls).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem("restaurantos.expansion.decision-briefs.v1"))).toBe(before);
  await restoredBench.getByText("Sources and formula drawer", { exact: true }).click();
  await restoredBench.getByRole("button", { name: "Refresh sources and reassess" }).click();
  await expect(restoredBench.getByRole("alert")).toContainText("previous evidence snapshot is preserved");
  expect(await page.evaluate(() => localStorage.getItem("restaurantos.expansion.decision-briefs.v1"))).toBe(before);
  // Profile revision creates a new run, never retargets an existing comparison.
  await page.locator(".profile-strip").getByRole("button", { name: "Edit profile" }).click();
  await page.getByRole("button", { name: "Edit requirements" }).click();
  await page.getByLabel("Emergency reserve (optional follow-up)").fill("20000");
  await page.getByRole("button", { name: "Save profile draft" }).click();
  await page.getByRole("button", { name: "Continue to the scouting map" }).click();
  await expect(page.locator(".profile-strip")).toContainText("revision 1");
  await expect(page.getByLabel("Agent execution mode")).toHaveValue(liveModel ? "live" : "scripted", { timeout: 30_000 });
  await page.getByRole("button", { name: "Start agent-assisted scouting" }).click();
  await expect(page.getByRole("heading", { name: "Deep Agents run results" })).toBeVisible({ timeout: liveModel ? 300_000 : 90_000 });
  await page.getByRole("button", { name: "Investigate this run" }).click();
  await expect(restoredBench.locator(".decision-run-meta")).toContainText("profile revision 1", { timeout: 30_000 });
  await restoredBench.getByText(/Saved decision briefs \(1\)/).click();
  await restoredBench.getByRole("button", { name: "Restore brief: Synthetic Cedar decision" }).click();
  await expect(restoredBench).toContainText("different profile revision");
  expect(errors).toEqual([]);
});

test("investigation keyboard/mobile/reduced-motion and corrupted brief storage", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("restaurantos.expansion.decision-briefs.v1", "synthetic corrupted bytes"));
  const bench = await investigateRealRun(page);
  await expect(bench).toContainText("Unreadable brief data preserved");
  await bench.getByLabel(/Compare this space/).focus();
  await page.keyboard.press("Space");
  await expect(bench.getByLabel(/Compare this space/)).toBeChecked();
  await bench.getByLabel("Space to investigate").focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await bench.getByLabel(/Compare this space/).focus();
  await page.keyboard.press("Space");
  await expect(bench.getByRole("button", { name: "Save decision brief", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("restaurantos.expansion.decision-briefs.v1"))).toBe("synthetic corrupted bytes");
  expect(await bench.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});
