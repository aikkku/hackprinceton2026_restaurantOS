import { expect, test } from "@playwright/test";

/**
 * Phase 3 browser journey against the REAL backend + REAL Python worker.
 * The webServer env forces EXPANSION_AGENT_DEFAULT_MODE=scripted, so the
 * Deep Agents graph runs with the committed deterministic model double
 * (labeled "scripted test model" in the UI) while every specialist, tool
 * call, artifact and SSE event is real. The outage test forces "live"
 * requests offline (EXPANSION_AGENT_E2E_FORCE_OFFLINE=1) so no provider is
 * ever contacted from these specs.
 */

async function openExplorer(page: import("@playwright/test").Page) {
  await page.goto("/expansion");
  await page.getByRole("button", { name: "Use example restaurant" }).click();
  await page.getByRole("button", { name: "Continue to the scouting map" }).click();
  await page.getByLabel("Data mode").selectOption("local");
  await expect(page.locator(".profile-strip")).toContainText("Cedar Kitchen");
}

test("agent-assisted scouting: real stage events, grounded results, inspection, cancel", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openExplorer(page);

  const section = page.locator(".agent-section").first();
  await expect(section).toContainText("Agent-assisted scouting");
  // First hit compiles the capabilities route in dev; wait generously.
  await expect(page.getByLabel("Agent execution mode")).toHaveValue("scripted", { timeout: 45000 });

  // Start: the planner delegates to the five specialists through the real
  // framework; stage rows stream in as real SSE events.
  await section.getByRole("button", { name: "Start agent-assisted scouting" }).click();
  await expect(section.locator(".agent-stages .stage-row")).toHaveCount(5, { timeout: 30000 });
  await expect(section).toContainText("Site scout");
  await expect(section).toContainText("Space inspector");
  await expect(section).toContainText("Finance");

  // Grounded terminal results: summary, stage digests, labeled mode.
  await expect(section.getByText("Deep Agents run results")).toBeVisible({ timeout: 60000 });
  await expect(section.locator(".mode-badge")).toContainText("scripted test model");
  await expect(section.locator(".agent-summary")).toContainText(
    "Agent-assisted scouting completed",
    { timeout: 30000 },
  );
  await expect(section.locator(".agent-summary")).toContainText("Financial baseline");
  await expect(section.locator(".agent-finance")).toContainText("Required sales: unavailable");
  // All five specialist stages reached a validated terminal status.
  for (const stage of ["Readiness", "Market", "Site scout", "Space inspector", "Finance"]) {
    await expect(section.locator(".agent-stages")).toContainText(stage, { timeout: 30000 });
  }

  // Grounded candidates reuse the deterministic assessments; inspect one.
  await expect(section.locator(".candidate-card")).toHaveCount(20, { timeout: 30000 });
  await section.locator(".candidate-card").first().click();
  await expect(section.getByLabel("Requirement assessment")).toContainText("PROFILE ASSESSMENT", {
    timeout: 20000,
  });

  // Cancel a second run mid-flight. The worker's first bridge call is
  // delayed once (spec-level latency injection, like the Phase 2 controlled
  // source failure) so the cancel click deterministically lands while the
  // run is still executing.
  let delayBridge = false;
  await page.route("**/api/expansion/agent-tools", async (route) => {
    if (delayBridge) {
      delayBridge = false;
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 4000));
      await route.fulfill({ response });
    } else {
      await route.continue();
    }
  });
  await section.getByRole("button", { name: "Start another agent run" }).click();
  await expect(section.getByRole("button", { name: "Start agent-assisted scouting" })).toBeVisible();
  delayBridge = true;
  await section.getByRole("button", { name: "Start agent-assisted scouting" }).click();
  await expect(section.getByRole("button", { name: "Cancel agent run" })).toBeVisible({ timeout: 30000 });
  await section.getByRole("button", { name: "Cancel agent run" }).click();
  await expect(section.getByRole("alert")).toContainText("cancelled", { timeout: 30000 });

  expect(errors).toEqual([]);
});

test("model outage: honest failure then the explicit deterministic path", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openExplorer(page);

  const section = page.locator(".agent-section").first();
  // Wait for capabilities to load (the select shows the server default),
  // then switch to the live model — the e2e environment forces the provider
  // offline, so the worker must fail honestly instead of fabricating progress.
  await expect(page.getByLabel("Agent execution mode")).toHaveValue("scripted", { timeout: 45000 });
  await page.getByLabel("Agent execution mode").selectOption("live");
  await expect(page.getByLabel("Agent execution mode")).toHaveValue("live");
  await section.getByRole("button", { name: "Start agent-assisted scouting" }).click();
  await expect(section.getByRole("alert")).toContainText("unavailable", { timeout: 45000 });

  // The explicit deterministic fallback stays available and labeled.
  const fallback = section.getByRole("button", { name: "Continue with deterministic search" });
  await expect(fallback).toBeVisible({ timeout: 20000 });
  await fallback.click();
  await expect(page.locator("#deterministic-search")).toBeVisible();
  await page.getByRole("button", { name: "Start profile search" }).click();
  await expect(page.locator(".run-summary")).toBeVisible({ timeout: 45000 });
  await expect(page.locator(".run-section").last()).toContainText("37 offered spaces examined", {
    timeout: 30000,
  });
  await expect(page.locator(".run-section").last()).toContainText("30 candidates", { timeout: 30000 });

  expect(errors).toEqual([]);
});
