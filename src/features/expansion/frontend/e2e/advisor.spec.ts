import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { ADVISOR_VERSION, advisorRequestSchema } from "../../domain/advisor.ts";
import { AGENT_RUN_VERSION, agentRunRecordSchema } from "../../domain/agent.ts";
import { investigationRunSchema } from "../../domain/decision-brief.ts";
import { makeChoice } from "../sprout/model.ts";
import { SEARCH_SESSION_KEY, searchSessionSchema } from "../sprout/session.ts";

test("Ask Sprout accepts real same-origin browser requests on the local server", async ({ page }) => {
  await page.goto("/expansion");
  const result = await page.evaluate(async () => {
    await fetch("/api/expansion/session", { credentials: "same-origin" });
    // Invalid input reaches validation without ever calling a paid provider.
    const response = await fetch("/api/expansion/advisor", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = await response.json();
    return { status: response.status, error: body.error?.code };
  });
  expect(result).toEqual({ status: 400, error: "invalid_request" });
  const crossSite = await page.request.post("/api/expansion/advisor", {
    headers: { origin: "https://another-site.test" }, data: {},
  });
  expect(crossSite.status()).toBe(403);
});

/** Isolated browser proof: committed synthetic snapshots, no Python or live source dependency. */
test("Ask Sprout answers from every screen, retries and remembers follow-up questions", async ({ page }) => {
  const now = "2026-11-15T12:00:00.000Z";
  const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../agent/fixtures/contracts/${name}.sample.json`, import.meta.url), "utf8"));
  const search = fixture("candidates"), profile = fixture("profile"), summary = fixture("summary"), inspection = fixture("inspection");
  for (const item of search.candidates) item.candidate.isDemo = true;
  for (const item of inspection.candidates) item.candidate.isDemo = true;
  const run = agentRunRecordSchema.parse({ version: AGENT_RUN_VERSION, runId: search.runId, sessionId: "synthetic-advisor-e2e",
    status: summary.terminalStatus, executionMode: "scripted", createdAt: now, updatedAt: now, completedAt: now, cancelledAt: null,
    cityId: search.cityId, datasetId: search.datasetId, datasetDate: search.datasetDate,
    profile: { revisionId: profile.revisionId, revisionNumber: profile.revisionNumber }, requirementsHash: "synthetic-advisor-e2e", model: null,
    toolCalls: {}, stages: { readiness: "completed", market: "completed", site_scout: "completed", space_inspector: "completed", finance: "unavailable" }, error: null });
  const bundle = investigationRunSchema.parse({ run, search, profile, summary, market: fixture("market"), inspection, finance: fixture("finance") });
  const choices = bundle.search.candidates.slice(0, 2).map(c => makeChoice(bundle.profile.requirements, c));
  const session = searchSessionSchema.parse({ version: 1, source: "agent", runId: run.runId, cityLabel: "Houston", placesFound: search.candidates.length,
    profileRevisionId: profile.revisionId, saved: choices.map(c => c.candidateId), pick: choices[0].candidateId, choices, updatedAt: now });
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: SEARCH_SESSION_KEY, value: JSON.stringify(session) });
  await page.route("https://tiles.openfreemap.org/**", route => route.abort());
  await page.route("**/api/expansion/maps-config", route => route.fulfill({ json: { browserKey: null, mapId: "DEMO_MAP_ID", reason: "Synthetic browser test" } }));
  await page.route("**/api/expansion/agent-runs/fixture-run**", async route => {
    const path = new URL(route.request().url()).pathname;
    const artifact = path.split("/artifacts/")[1];
    const artifacts: Record<string, unknown> = { profile: bundle.profile, candidates: bundle.search, summary: bundle.summary,
      market: bundle.market, inspection: bundle.inspection, finance: bundle.finance, evidence: { snapshots: [] } };
    if (artifact && artifact in artifacts) await route.fulfill({ json: artifacts[artifact] });
    else if (path.endsWith("/fixture-run")) await route.fulfill({ json: run });
    else await route.fulfill({ status: 404, json: { error: { message: "No estimate fixture" } } });
  });
  const topics: string[] = [];
  let propertyCalls = 0;
  await page.route("**/api/expansion/advisor", async route => {
    const body = advisorRequestSchema.parse(route.request().postDataJSON());
    topics.push(body.context.topic);
    if (body.context.topic === "property" && ++propertyCalls === 1) {
      await route.fulfill({ status: 503, json: { error: { message: "Synthetic Gemini outage. Please retry." } } }); return;
    }
    if (body.question === "What should I ask the broker?") {
      expect(body.history).toHaveLength(2);
      expect(body.history[0].role).toBe("user");
      expect(body.history[1].text).toContain("Synthetic advisor answer");
    }
    await route.fulfill({ json: { version: ADVISOR_VERSION, answer: body.history.length ? "Ask the broker about customer parking rights." : "Synthetic advisor answer: confirm parking before committing.",
      evidenceIds: [], limitations: ["Synthetic test data."], model: "gemini-test-fixture", origin: "assumed", generatedAt: now } });
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/expansion");
  await page.getByRole("button", { name: /Continue your Houston search/ }).click();
  await page.getByRole("button", { name: "Compare saved places (2)" }).click();
  const dialog = page.getByRole("dialog", { name: "Ask Sprout" });
  const ask = page.getByRole("button", { name: "Ask Sprout about this" });
  await ask.click();
  await expect(dialog).toContainText("Synthetic advisor answer");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "View details", exact: true }).first().click();
  await ask.click();
  await expect(dialog.getByRole("alert")).toContainText("Synthetic Gemini outage");
  await dialog.getByRole("button", { name: "Retry answer" }).click();
  await expect(dialog).toContainText("AI interpretation · gemini-test-fixture");
  await dialog.getByLabel("Your question").fill("What should I ask the broker?");
  await dialog.getByLabel("Your question").press("Enter");
  await expect(dialog).toContainText("Ask the broker about customer parking rights.");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("sprout-advisor-mobile.png") });
  await dialog.getByRole("button", { name: "Close", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator("summary").last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(ask).toBeFocused();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Compare saved places", exact: true }).click();
  await page.getByRole("button", { name: /^Work out costs for/ }).click();
  for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "See results", exact: true }).click();
  await ask.click();
  await expect(dialog).toContainText("Synthetic advisor answer");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "See our recommendation" }).click();
  await ask.click();
  await expect(dialog).toContainText("Synthetic advisor answer");
  await page.keyboard.press("Escape");
  expect(topics).toEqual(["comparison", "property", "property", "property", "opening_costs", "plan"]);
  expect(errors).toEqual([]);
});
