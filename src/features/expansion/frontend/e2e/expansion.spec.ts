import { expect, test } from "@playwright/test";

test("Expansion does not change Tactical styles during client navigation", async ({
  page,
}) => {
  await page.goto("/tactical");
  await expect(
    page.locator(".tactical-workspace .workspace-main"),
  ).toBeVisible();
  async function tacticalStyles() {
    return page.locator(".tactical-workspace").evaluate((root) =>
      [
        ".workspace-main",
        ".workspace-footer",
        ".primary",
        ".text-button",
        "h1",
      ].map((selector) => {
        const style = getComputedStyle(root.querySelector(selector)!);
        return [
          selector,
          style.fontSize,
          style.padding,
          style.backgroundColor,
          style.borderRadius,
          style.maxWidth,
          style.minHeight,
        ];
      }),
    );
  }
  const before = await tacticalStyles();
  await page.goto("/expansion");
  await page.getByRole("button", { name: "Continue to the scouting map" }).click();
  await expect(page.locator(".property-card")).toHaveCount(4);
  await page.getByRole("link", { name: "Manage restaurant" }).click();
  await expect(page).toHaveURL(/\/tactical/);
  await expect(
    page.locator(".tactical-workspace .workspace-main"),
  ).toBeVisible();
  expect(await tacticalStyles()).toEqual(before);
  await expect(
    page.getByRole("button", { name: "Save draft", exact: true }),
  ).toBeEnabled();
});

test("scout, simulate, compare, save and restore exact assumptions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveURL(/\/tactical/);
  await page.goto("/expansion");
  await page.getByRole("button", { name: "Continue to the scouting map" }).click();
  await expect(
    page.getByRole("heading", {
      name: "A little scouting. A clearer decision.",
    }),
  ).toBeVisible();
  await expect(page.locator(".property-card")).toHaveCount(4);
  await expect(page.getByLabel("City")).toHaveValue("houston-demo");
  await page.getByRole("button", { name: /Canopy Corner/ }).click();
  await expect(
    page.getByRole("complementary", { name: "Property Scout" }),
  ).toContainText("$4,000 / mo");
  await page.getByRole("button", { name: "Try opening here" }).click();
  await expect(page.locator(".required-sales")).toHaveText("$30,714");
  await expect(page.getByLabel("Assumed monthly sales (optional)")).toHaveValue(
    "",
  );
  await page.getByLabel("Pass-throughs").fill("1000");
  await page.getByLabel("Assumed monthly sales (optional)").fill("50000");
  await expect(page.locator(".required-sales")).toHaveText("$31,429");
  await expect(page.locator(".outcome-panel")).toContainText("$6,500 / mo");
  await page
    .getByRole("button", { name: "Compare scenario", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save scenario", exact: true })
    .click();
  await expect(page.locator(".saved-list article")).toHaveCount(1);
  await page.getByRole("button", { name: /Garden Arcade/ }).click();
  await page.getByRole("button", { name: "Try opening here" }).click();
  await page
    .getByRole("button", { name: "Compare scenario", exact: true })
    .click();
  await expect(page.locator(".compare-card")).toHaveCount(2);
  await expect(page.locator(".compare-card").first()).toContainText("$31,429");
  await expect(page.locator(".compare-card").last()).toContainText("$32,714");
  await page.reload();
  await page.getByRole("button", { name: "Continue to the scouting map" }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.getByLabel("Pass-throughs")).toHaveValue("1000");
  await expect(page.getByLabel("Assumed monthly sales (optional)")).toHaveValue(
    "50000",
  );
  await expect(page.locator(".required-sales")).toHaveText("$31,429");
  await page.getByRole("button", { name: "View analysis" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("expansion-finance-v1");
  await expect(page.getByRole("dialog")).toContainText("demo-listing-1");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "View analysis" }),
  ).toBeFocused();
  await page.getByLabel("Contribution margin", { exact: false }).fill("0");
  await expect(page.locator(".outcome-panel")).toContainText(
    "No sales threshold is attainable",
  );
  await page.getByLabel("Contribution margin", { exact: false }).fill("-1");
  await expect(
    page.getByRole("button", { name: "Save scenario", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Reset to baseline" }).click();
  await expect(page.getByLabel("Pass-throughs")).toHaveValue("750");
  await expect(page.getByLabel("Assumed monthly sales (optional)")).toHaveValue(
    "",
  );
  expect(errors).toEqual([]);
});

test("map failure, keyboard area selection, empty filters and zero weights remain usable", async ({
  page,
}) => {
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
  await page.goto("/expansion");
  await page.getByRole("button", { name: "Continue to the scouting map" }).click();
  await expect(
    page.getByText("Street map unavailable. Geographic preview only."),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("button", { name: "Retry map" })).toBeVisible();
  await page.locator(".area-list summary").focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /Scout sector 05/ }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("complementary", { name: "Area Scout" }),
  ).toContainText("Scout sector 05");
  for (const slider of await page.getByRole("slider").all())
    await slider.fill("0");
  await expect(page.locator(".score-orb")).toContainText("Insufficient data");
  await expect(page.locator(".coverage-row")).toContainText("0%");
  await page.getByRole("button", { name: "Reset priorities" }).click();
  await page.getByLabel("Minimum space").fill("99999");
  await expect(
    page.getByRole("heading", { name: "No spaces match these filters." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset property filters" }).click();
  await expect(page.locator(".property-card")).toHaveCount(4);
});

test("corrupt storage is preserved until the user clears it", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("restaurantos.expansion.demo.scenarios.v1", "{bad"),
  );
  await page.goto("/expansion");
  await page.getByRole("button", { name: "Continue to the scouting map" }).click();
  await expect(page.locator('.saved-section [role="alert"]')).toContainText(
    "Existing storage has been preserved",
  );
  expect(
    await page.evaluate(() =>
      localStorage.getItem("restaurantos.expansion.demo.scenarios.v1"),
    ),
  ).toBe("{bad");
  await page.getByRole("button", { name: /Canopy Corner/ }).click();
  await page.getByRole("button", { name: "Try opening here" }).click();
  await expect(
    page.getByRole("button", { name: "Save scenario", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Clear saved demo data" }).click();
  await page
    .getByRole("button", { name: "Save scenario", exact: true })
    .click();
  await expect(page.locator(".saved-list article")).toHaveCount(1);
});

test("mobile and reduced motion layout has no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    route.abort(),
  );
  await page.goto("/expansion");
  await page.getByRole("button", { name: "Continue to the scouting map" }).click();
  await expect(page.locator(".property-card")).toHaveCount(4);
  await page.getByRole("button", { name: /Canopy Corner/ }).click();
  await page.getByRole("button", { name: "Try opening here" }).click();
  await expect(page.locator(".required-sales")).toHaveText("$30,714");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "View analysis" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/expansion-mobile.png",
    fullPage: true,
  });
});
