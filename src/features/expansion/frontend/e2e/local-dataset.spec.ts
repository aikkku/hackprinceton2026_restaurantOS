import { expect, test, type Page } from "@playwright/test";
import { fixtureProvider } from "../data/demo-market.ts";

async function syntheticSource() {
  const demo = await fixtureProvider.load();
  const city = { ...demo.cities[0], id: "synthetic-city", name: "Synthetic market", isDemo: false,
    coverage: { propertyCount: 2, listingCount: 2, mappableCount: 2 } };
  const evidence = [{ id: "synthetic-source", provider: "Synthetic test provider", recordId: "test-records",
    label: "Synthetic test evidence", origin: "observed", isDemo: false, observedAt: null,
    rights: "Synthetic test records only", notes: "Not actual property data." }];
  const properties = demo.properties.slice(0, 2).map((property, index) => ({ ...property,
    id: `synthetic-${index}`, name: `Synthetic space ${index + 1}`, cityId: city.id, isDemo: false,
    sourceIds: [evidence[0].id], askingRent: index === 0 ? null : property.askingRent,
    sourcePropertyId: `test-property-${index}`, sourceListingId: `test-listing-${index}`,
    recordKind: "listing", availability: "unknown", recordDate: "2025-01-01", datasetDate: null,
    originalRentUnit: index === 0 ? null : "USD / SF / year", rentBasis: null }));
  const areas = demo.areas.filter((area) => properties.some((property) => property.h3Index === area.h3Index)).map((area) => ({
    ...area, cityId: city.id, label: `Snapshot cell ${area.h3Index}`, isDemo: false, sourceIds: [evidence[0].id],
    factors: { demand: null, similarity: null, competition: null, cost: null }, averageBaseRentMonthly: null,
    metrics: { propertyCount: 1, listingCount: 1, rentSampleCount: 0, averageAskingRentPerSfYear: null } }));
  const metadata = { mode: "local", datasetId: "synthetic-test-v1", provider: evidence[0].provider,
    datasetDate: null, importedAt: "2026-11-14T12:00:00.000Z", rights: evidence[0].rights,
    notes: ["Synthetic API test."], propertyCount: 2, listingCount: 2, mappableCount: 2 };
  return { cities: [city], areas, properties, evidence, metadata };
}

async function mockSource(page: Page) {
  const dataset = await syntheticSource();
  await page.route("https://tiles.openfreemap.org/**", (route) => route.abort());
  await page.route("**/api/expansion/markets", (route) => route.fulfill({ json: { cities: dataset.cities, evidence: dataset.evidence, metadata: dataset.metadata } }));
  await page.route("**/api/expansion/query?*", (route) => route.fulfill({ json: { dataset,
    coverage: { totalMatching: 2, returned: 2, limit: 100, offset: 0, areasReturned: dataset.areas.length, areasLimited: false } } }));
  await page.route("**/api/expansion/properties/*", (route) => {
    const property = dataset.properties.find((item) => route.request().url().endsWith(item.id))!;
    return route.fulfill({ json: { property, area: dataset.areas.find((item) => item.h3Index === property.h3Index), evidence: dataset.evidence, metadata: dataset.metadata } });
  });
}

test("local dataset supports unknown rent, inspect, edit, compare, save and reload restore", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockSource(page);
  await page.goto("/expansion");
  await page.getByLabel("Data mode").selectOption("local");
  await expect(page.getByLabel("City")).toHaveValue("synthetic-city");
  await expect(page.locator(".property-card")).toHaveCount(2);
  await expect(page.locator(".query-status")).toContainText("of 2 matching records");
  await expect(page.locator(".score-orb")).toContainText("Insufficient data");
  await page.getByRole("button", { name: /Synthetic space 1/ }).click();
  await expect(page.getByRole("complementary", { name: "Property Scout" })).toContainText("Unknown — verify first");
  await page.getByRole("button", { name: "Try opening here" }).click();
  await expect(page.getByLabel(/^Base rent/)).toHaveValue("");
  await expect(page.getByRole("button", { name: "Save scenario", exact: true })).toBeDisabled();
  await page.getByLabel(/^Base rent/).fill("4000");
  await page.getByLabel("Pass-throughs").fill("1000");
  await page.getByRole("button", { name: "Compare scenario", exact: true }).click();
  await page.getByRole("button", { name: "Save scenario", exact: true }).click();
  await expect(page.locator(".saved-list article")).toHaveCount(1);
  await expect(page.locator(".compare-card")).toContainText("Local dataset snapshot");
  await page.getByRole("button", { name: /Synthetic space 2/ }).click();
  await page.getByRole("button", { name: "Try opening here" }).click();
  await page.getByRole("button", { name: "Compare scenario", exact: true }).click();
  await expect(page.locator(".compare-card")).toHaveCount(2);
  await page.reload();
  await expect(page.getByLabel("Data mode")).toHaveValue("local");
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByLabel("Pass-throughs")).toHaveValue("1000");
  await expect(page.locator(".required-sales")).toHaveText("$31,429");
  await page.getByRole("button", { name: "View analysis" }).click();
  await expect(page.getByRole("dialog")).toContainText("Synthetic test evidence");
  await expect(page.getByRole("dialog")).toContainText("expansion-area-local-v1");
  expect(errors).toEqual([]);
});

test("local dataset distinguishes missing configuration and source failure, with retry and Demo escape", async ({ page }) => {
  let configured = false;
  await page.route("**/api/expansion/markets", (route) => route.fulfill({ status: 503,
    json: { error: { code: configured ? "source_failure" : "not_configured", message: configured ? "Synthetic source failure" : "Set the local database configuration." } } }));
  await page.goto("/expansion");
  await page.getByLabel("Data mode").selectOption("local");
  await expect(page.getByRole("heading", { name: "Local dataset is not configured." })).toBeVisible();
  configured = true;
  await page.getByRole("button", { name: "Retry data" }).click();
  await expect(page.getByRole("heading", { name: "The scouting data could not load." })).toBeVisible();
  await expect(page.locator(".startup")).toContainText("Synthetic source failure");
  await page.getByLabel("Data mode").selectOption("demo");
  await expect(page.locator(".property-card")).toHaveCount(4);
});

test("local query empty and failure states preserve a draft and retry", async ({ page }) => {
  await mockSource(page);
  await page.goto("/expansion");
  await page.getByLabel("Data mode").selectOption("local");
  await page.getByRole("button", { name: /Synthetic space 1/ }).click();
  await page.getByRole("button", { name: "Try opening here" }).click();
  await page.getByLabel(/^Base rent/).fill("4321");
  await page.route("**/api/expansion/query?*", (route) => route.fulfill({ status: 503, json: { error: { code: "source_failure", message: "Synthetic query failed" } } }));
  await page.getByLabel("Monthly base-rent budget").fill("9000");
  await expect(page.locator(".query-status")).toContainText("Synthetic query failed");
  await expect(page.getByLabel(/^Base rent/)).toHaveValue("4321");
  const dataset = await syntheticSource();
  await page.route("**/api/expansion/query?*", (route) => route.fulfill({ json: { dataset: { ...dataset, areas: [], properties: [] }, coverage: { totalMatching: 0, returned: 0, limit: 100, offset: 0, areasReturned: 0, areasLimited: false } } }));
  await page.getByRole("button", { name: "Retry area query" }).click();
  await expect(page.locator(".query-status")).toContainText("0–0 of 0");
  await expect(page.getByRole("heading", { name: "No spaces match these filters." })).toBeVisible();
  await expect(page.getByLabel(/^Base rent/)).toHaveValue("4321");
});

test("configured local data completes the actual API to browser save and restore flow", async ({ page, request }) => {
  test.skip(process.env.EXPANSION_E2E_LOCAL !== "1", "Set EXPANSION_E2E_LOCAL=1 with an imported local database.");
  const markets = await request.get("/api/expansion/markets");
  expect(markets.ok()).toBe(true);
  const body = await markets.json();
  expect(body.cities.length).toBeGreaterThan(0);
  await page.route("https://tiles.openfreemap.org/**", (route) => route.abort());
  await page.goto("/expansion");
  await page.getByLabel("Data mode").selectOption("local");
  await page.getByLabel("City").selectOption(body.cities[0].id);
  await expect(page.locator(".property-card").first()).toBeVisible();
  await page.locator(".area-list summary").click();
  await page.locator(".area-buttons button").first().click();
  await expect(page.getByRole("complementary", { name: "Area Scout" })).toContainText("Insufficient data");
  await page.locator(".property-card").first().click();
  await page.getByRole("button", { name: "Try opening here" }).click();
  await page.getByLabel(/^Base rent/).fill("4000");
  await page.getByLabel("Pass-throughs").fill("1000");
  await page.getByRole("button", { name: "Compare scenario", exact: true }).click();
  await page.getByRole("button", { name: "Save scenario", exact: true }).click();
  await expect(page.locator(".saved-list article")).toHaveCount(1);
  await page.locator(".property-card").nth(1).click();
  await page.getByRole("button", { name: "Try opening here" }).click();
  await page.getByLabel(/^Base rent/).fill("4500");
  await page.getByRole("button", { name: "Compare scenario", exact: true }).click();
  await expect(page.locator(".compare-card")).toHaveCount(2);
  await page.reload();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByLabel("Pass-throughs")).toHaveValue("1000");
  await expect(page.locator(".required-sales")).toHaveText("$31,429");
  if (body.cities.length > 1) {
    await page.getByLabel("City").selectOption(body.cities[1].id);
    await expect(page.locator(".map-heading h2")).toContainText(body.cities[1].name);
    await expect(page.locator(".property-card").first()).toBeVisible();
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await expect(page.getByLabel("City")).toHaveValue(body.cities[0].id);
    await expect(page.getByLabel("Pass-throughs")).toHaveValue("1000");
  }
});

test("local mobile reduced motion and saved evidence survive source failure", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockSource(page);
  await page.goto("/expansion");
  await page.getByLabel("Data mode").selectOption("local");
  await page.getByRole("button", { name: /Synthetic space 1/ }).click();
  await page.getByRole("button", { name: "Try opening here" }).click();
  await page.getByLabel(/^Base rent/).fill("4000");
  await page.getByRole("button", { name: "Save scenario", exact: true }).click();
  await page.reload();
  await page.route("**/api/expansion/properties/*", (route) => route.fulfill({ status: 503, json: { error: { code: "source_failure", message: "Synthetic source unavailable" } } }));
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.locator(".inspector")).toContainText("Dated saved property snapshot");
  await expect(page.getByLabel(/^Base rent/)).toHaveValue("4000");
  await expect(page.locator(".required-sales")).toHaveText("$30,714");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "View analysis" }).click();
  await expect(page.getByRole("dialog")).toContainText("Synthetic test evidence");
  expect(await page.getByRole("dialog").evaluate((element) => element.scrollWidth <= innerWidth)).toBe(true);
});

test("a slow saved-property restore cannot replace a newer selection", async ({ page }) => {
  await mockSource(page);
  await page.goto("/expansion");
  await page.getByLabel("Data mode").selectOption("local");
  await page.getByRole("button", { name: /Synthetic space 1/ }).click();
  await page.getByRole("button", { name: "Try opening here" }).click();
  await page.getByLabel(/^Base rent/).fill("4000");
  await page.getByRole("button", { name: "Save scenario", exact: true }).click();
  const dataset = await syntheticSource();
  await page.route("**/api/expansion/properties/synthetic-0", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fulfill({ json: { property: dataset.properties[0], area: dataset.areas[0], evidence: dataset.evidence, metadata: dataset.metadata } }).catch(() => {});
  });
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("button", { name: /Synthetic space 2/ }).click();
  await expect(page.getByRole("complementary", { name: "Property Scout" }).getByRole("heading")).toHaveText("Synthetic space 2");
  await expect.poll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    return page.getByRole("complementary", { name: "Property Scout" }).getByRole("heading").textContent();
  }).toBe("Synthetic space 2");
});
