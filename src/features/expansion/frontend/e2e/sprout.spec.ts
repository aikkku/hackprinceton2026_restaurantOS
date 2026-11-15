import { expect, test, type Page } from "@playwright/test";

/**
 * sprout. Expansion journeys against the REAL backend and the REAL Python
 * worker (scripted test model, see playwright.config.ts). Only controlled
 * failure injection is mocked; the synthetic CoStar cache comes from
 * global-setup.ts (38 offered spaces, 31 candidates, one shared address).
 */

async function needsToReview(page: Page, budget?: string) {
  await page.goto("/expansion");
  await page.getByRole("button", { name: "Find Locations" }).click();
  await expect(page.getByRole("heading", { name: "Where would you like to expand?" })).toBeVisible();
  await expect(page.getByText("Filled in from the example profile")).toBeVisible();
  await expect(page.getByRole("button", { name: "Heights" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  if (budget) await page.getByLabel("Monthly rent budget").fill(budget);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Here’s what we’ll look for" })).toBeVisible();
}

test("full journey: needs → specialists → places → check → compare → costs → saved plan", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://tiles.openfreemap.org/**", (route) => route.abort());

  await needsToReview(page, "6,000");
  await expect(page.getByText("Up to $6,000")).toBeVisible();
  await page.getByRole("button", { name: "Change seats" }).click();
  await page.getByLabel("Most seats").fill("60");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("40–60")).toBeVisible();
  await page.getByRole("button", { name: "Find Locations" }).click();

  // Real SSE stage events, then grounded counts from the run's artifacts.
  await expect(page.getByRole("heading", { name: /We found 31 places/ })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("31 places can fit a restaurant")).toBeVisible();
  await page.getByText("View details").click();
  await expect(page.getByText("Test mode: scripted model (not a live AI run)")).toBeVisible();
  await page.getByRole("button", { name: "See locations" }).click();

  await expect(page.getByRole("heading", { name: "31 places in Houston" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText("Synthetic test listings, not real properties.")).toBeVisible();
  // Map tiles are blocked: the honest fallback plane still shows grouped pins.
  await expect(page.getByText(/Map tiles couldn’t load/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Save E2E Synthetic Building · Suite S0" }).click();
  await page.getByRole("button", { name: "Save E2E Synthetic Building · Suite S15" }).click();
  await expect(page.getByRole("button", { name: "Compare saved places (2)" })).toBeEnabled();

  // The no-rent space (Suite NE) shows a derived estimate, never a quoted price.
  await page.getByRole("button", { name: "Show all 31 places" }).click();
  const noRentCard = page.locator(".sx-pcard").filter({ hasText: "Suite NE" });
  await expect(noRentCard).toBeVisible();
  await expect(noRentCard).toContainText("Estimate");
  await expect(noRentCard.locator(".sx-pcard-cost")).toContainText("≈ $");
  await page.getByRole("button", { name: "Show E2E Synthetic Building · Suite NE on the map" }).click();
  await page.getByRole("button", { name: "See details ›" }).click();
  await page.getByText("How we checked").click();
  await expect(page.getByText("Estimated rent method")).toBeVisible();
  await page.getByText("Listing details and sources").click();
  await expect(page.getByText("Estimated base rent")).toBeVisible();

  await page.getByRole("button", { name: "All places" }).click();
  await page.getByRole("button", { name: "Show E2E Synthetic Building · Suite S0 on the map" }).click();
  await page.getByRole("button", { name: "See details ›" }).click();
  await expect(page.getByText("This place could work, but parking and kitchen aren’t confirmed yet.")).toBeVisible();
  await expect(page.getByText("$2,400/mo").first()).toBeVisible();

  // A dated owner verification re-runs the deterministic reassessment.
  await page.getByText("Things to check").click();
  await page.getByRole("button", { name: "I checked something" }).click();
  await page.getByLabel("Where did you see it?").fill("Site visit with broker");
  await page.getByLabel("When?").fill("2026-11-14");
  await page.getByRole("button", { name: "Add to this place" }).click();
  await expect(page.getByText("This place could work, but parking isn’t confirmed yet.")).toBeVisible();
  await expect(page.getByText("Your check").first()).toBeVisible();

  await page.getByRole("button", { name: "Ask Sprout about this" }).click();
  await expect(page.getByRole("dialog")).toContainText("isn’t connected in Expansion yet");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Compare saved places", exact: true }).click();
  await expect(page.getByText("They all cost the same each month ($2,400).")).toBeVisible();
  await page.getByRole("button", { name: "Pick this one" }).first().click();
  await page.getByRole("button", { name: /Work out costs for E2E Synthetic Building · Suite S0/ }).click();

  await expect(page.getByText("1 of 9")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click(); // funds from profile
  for (const amount of ["40000", "30000"]) {
    await page.getByRole("textbox").first().fill(amount);
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await page.getByRole("button", { name: /Use 2 months of base rent \(\$4,800\)/ }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  for (const amount of ["5000", "15000", "10000", "20000"]) {
    await page.getByRole("textbox").first().fill(amount);
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await page.getByRole("button", { name: /Try 35¢ as an example/ }).click();
  await expect(page.getByText("Example value")).toBeVisible();
  await page.getByRole("button", { name: "See results", exact: true }).click();

  await expect(page.getByLabel("Money needed to open")).toContainText("$94,800");
  await expect(page.getByLabel("Money needed to open")).toContainText("You’d be $4,800 short after your reserve");
  await expect(page.getByLabel("Monthly rent cost")).toContainText("$3,600 under your budget");
  await expect(page.getByLabel("Sales needed each month")).toContainText("$64,000");
  await expect(page.getByText("Some results use example values")).toBeVisible();

  await page.getByRole("button", { name: "See our recommendation" }).click();
  await expect(page.getByText("Kitchen confirmed for this space")).toBeVisible();
  await page.getByLabel("Plan name").fill("Suite S0 first look");
  await page.getByRole("button", { name: "Save this plan" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Suite S0 first look" })).toBeVisible();

  // Reload: the plan survives, and the search can be resumed.
  await page.reload();
  await expect(page.getByText("Continue your Houston search.")).toBeVisible();
  await expect(page.getByText("31 places found · 2 saved")).toBeVisible();
  await page.getByText("Saved plans").click();
  await page.getByRole("button", { name: "Open plan Suite S0 first look" }).click();
  await expect(page.getByText(/This is a saved plan from/)).toBeVisible();
  await expect(page.getByText("Kitchen confirmed for this space")).toBeVisible();
  expect(errors).toEqual([]);
});

test("model outage: honest failure, then the labeled basic search", async ({ page }) => {
  test.setTimeout(180_000);
  // Controlled failure injection: ask for the live model, which the e2e
  // environment forces offline (EXPANSION_AGENT_E2E_FORCE_OFFLINE=1).
  await page.route("**/api/expansion/agent-capabilities", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, defaultMode: "live" } });
  });
  await page.route("https://tiles.openfreemap.org/**", (route) => route.abort());
  await needsToReview(page);
  await page.getByRole("button", { name: "Find Locations" }).click();
  await expect(page.getByRole("heading", { name: "The search didn’t finish." })).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Search without the specialists" }).click();
  await expect(page.getByRole("heading", { name: "31 places in Houston" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Basic search: these places weren’t inspected/)).toBeVisible();
});

test("corrupt saved needs are preserved until the owner starts over", async ({ page }) => {
  await page.goto("/expansion");
  await page.evaluate(() => localStorage.setItem("restaurantos.expansion.profile.draft.v1", "{broken"));
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "left untouched" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("restaurantos.expansion.profile.draft.v1"))).toBe("{broken");
  await page.getByRole("button", { name: "Start over with the example restaurant" }).click();
  expect(await page.evaluate(() => localStorage.getItem("restaurantos.expansion.profile.draft.v1"))).toBeNull();
});

test("mobile layout has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await needsToReview(page);
  // Report the offending elements, not just a boolean.
  const overflowing = () => page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll(".sx-root *")]
      .filter((el) => el.getBoundingClientRect().right > width + 0.5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
  });
  expect(await overflowing()).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("Expansion does not change Tactical styles during navigation", async ({ page }) => {
  await page.goto("/tactical");
  await expect(page.locator(".tactical-workspace .workspace-main")).toBeVisible();
  const styles = () => page.locator(".tactical-workspace").evaluate((root) =>
    [".workspace-main", ".primary", "h1"].map((selector) => {
      const style = getComputedStyle(root.querySelector(selector)!);
      return [selector, style.fontSize, style.padding, style.backgroundColor, style.borderRadius];
    }));
  const before = await styles();
  await page.getByRole("link", { name: "Explore expansion" }).click();
  await expect(page.getByRole("button", { name: "Find Locations" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("link", { name: "Manage restaurant" }).click();
  await expect(page.locator(".tactical-workspace .workspace-main")).toBeVisible({ timeout: 30_000 });
  expect(await styles()).toEqual(before);
});
