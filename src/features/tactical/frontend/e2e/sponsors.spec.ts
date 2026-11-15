import { test, expect } from "@playwright/test";
import bank from "../data/demo-nessie.json" with { type: "json" };
import network from "../data/demo-network.json" with { type: "json" };

test.beforeEach(async ({ page }) => {
  await page.route("**/api/tactical/ai/session", route => route.fulfill({ json: { unlocked: true } }));
});

test("Nessie source, assumptions, evidence, export and failure remain distinct", async ({ page }) => {
  await page.route("**/api/tactical/integrations/nessie", route => route.fulfill({ json: { ok: true, snapshot: { ...bank, source: "nessie-sandbox" } } }));
  await page.goto("/tactical/finance"); await page.getByRole("button", { name: "Nessie", exact: true }).click();
  const panel = page.getByRole("region", { name: "Nessie sandbox finance" });
  await expect(panel.getByText("Saved snapshot", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Refresh from Nessie" }).click();
  await expect(panel.getByText("Nessie API", { exact: true })).toBeVisible();
  await panel.getByLabel("Proposed investment (USD)").fill("30000");
  await expect(panel.getByRole("heading", { name: "Below the assumed cash reserve" })).toBeVisible();
  await panel.getByLabel("Assumed monthly net cash burn (USD)").fill("0");
  await expect(panel.getByText(/Unavailable \(zero burn\)/)).toBeVisible();
  await panel.getByText("View banking evidence and formulas").click();
  await expect(panel.getByText(bank.deposits[0]._id, { exact: true })).toBeVisible();
  const download = page.waitForEvent("download"); await panel.getByRole("button", { name: "Download cash scenario" }).click();
  expect((await download).suggestedFilename()).toBe("tactical-cash-scenario.json");
  await page.unroute("**/api/tactical/integrations/nessie"); await page.route("**/api/tactical/integrations/nessie", route => route.fulfill({ status: 503, json: { error: "private" } }));
  await panel.getByRole("button", { name: "Refresh from Nessie" }).click();
  await expect(panel.getByRole("alert")).toContainText("Nessie is unavailable");
  await expect(panel.getByText("Nessie API", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: "Reset snapshot" }).click();
  await expect(panel.getByText("Saved snapshot", { exact: true })).toBeVisible();
});

test("network import, validation, evidence, local save/reopen and AI failure", async ({ page }) => {
  await page.goto("/tactical/reviews"); await page.getByRole("button", { name: "Relationship network", exact: true }).click();
  const panel = page.getByRole("region", { name: "Relationship network", exact: true });
  await expect(panel.getByRole("heading", { name: "From conversations to connected evidence" })).toBeVisible();
  await expect(panel.getByText("8 relationships", { exact: true })).toBeVisible();
  await panel.getByLabel("Inspect node").selectOption("a:one");
  await panel.getByText("Relationship evidence · 1 edges", { exact: true }).click();
  await expect(panel.getByText(network.evidence[2].excerpt, { exact: true })).toBeVisible();
  await panel.getByText("Import, save and export a network", { exact: true }).click();
  const imported = { ...network, name: "Permissioned browser test", provenance: "observed" };
  await panel.getByLabel("Import network JSON").setInputFiles({ name: "network.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(panel.getByRole("alert")).toHaveText("Confirm permission before importing observed relationship data.");
  await panel.getByLabel(/I have permission/).check();
  await panel.getByLabel("Import network JSON").setInputFiles({ name: "network.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(panel.getByText(imported.name, { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Save network locally" }).click();
  await page.reload(); await page.getByRole("button", { name: "Relationship network", exact: true }).click();
  await panel.getByText("Import, save and export a network", { exact: true }).click();
  await panel.getByRole("button", { name: "Reopen saved network" }).click();
  await expect(panel.getByText("Permissioned browser test", { exact: true })).toBeVisible();
  await panel.getByLabel("Import network JSON").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"version":9}') });
  await expect(panel.getByRole("alert")).toContainText("Invalid network:");
  await expect(panel.getByText("Permissioned browser test", { exact: true })).toBeVisible();
  const ai = panel.getByRole("region", { name: "AI network interpretation" });
  await page.route("**/api/tactical/integrations/network", route => route.fulfill({ json: { model: "test-provider", generatedAt: "2026-11-14T12:00:00.000Z", result: { summary: "A source-linked test hypothesis", hypotheses: [{ action: "Test a brunch post", rationale: "This is a sample hypothesis", evidenceIds: ["s:brunch"] }], limitations: ["Synthetic test response"] } } }));
  await ai.getByRole("button", { name: "Interpret network with AI" }).click();
  await expect(ai.getByText("A source-linked test hypothesis", { exact: true })).toBeVisible();
  await ai.getByText("Supporting evidence", { exact: true }).click();
  await expect(ai.getByText(/Invented fixture post: Weekend brunch/)).toBeVisible();
  await panel.getByLabel("Relationship filter").selectOption("liked");
  await expect(ai.getByText("A source-linked test hypothesis", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/tactical/integrations/network");
  await page.route("**/api/tactical/integrations/network", route => route.fulfill({ status: 503, json: { error: "provider details" } }));
  await ai.getByRole("button", { name: "Interpret network with AI" }).click();
  await expect(ai.getByRole("alert")).toHaveText("Something is wrong");
  expect(await ai.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(247, 242, 255)");
});

test("network and sandbox tools fit a narrow reduced-motion viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [route, name] of [["reviews", "Relationship network"], ["finance", "Nessie"]]) {
    await page.goto(`/tactical/${route}`); await page.getByRole("button", { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
