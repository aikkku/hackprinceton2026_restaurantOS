import { test, expect } from "@playwright/test";
import sample from "../data/demo-social.json" with { type: "json" };

function semanticResponse(data = sample) {
  return { model: "browser-test-model", generatedAt: "2026-11-14T13:00:00.000Z", datasetHash: "test-hash", pipelineVersion: "social-v1", semantics: {
    topics: [{ id: "expectations", label: "Clear expectations", description: "Test interpretation of pricing and wait-time expectations." }],
    annotations: data.messages.map(message => ({ messageId: message.id, topicIds: ["expectations"], tone: "neutral", quote: message.text.slice(0, 40) })),
    limitations: ["Synthetic browser-test interpretation."],
  } };
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/tactical/ai/session", route => route.fulfill({ json: { unlocked: true } }));
  await page.goto("/tactical/reviews"); await page.getByRole("button", { name: "Content & connectivity", exact: true }).click();
});
test("semantic labels join to actor groups, explicit paths, source messages and report export", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/tactical/integrations/social/analyze", route => route.fulfill({ json: semanticResponse() }));
  const panel = page.getByRole("region", { name: "Content and connectivity pipeline" });
  await expect(panel.getByText(`${sample.messages.length} messages`, { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Analyze message content with AI" }).click();
  const findings = panel.getByRole("region", { name: "Content connectivity findings" });
  await expect(findings.getByRole("heading", { name: "Clear expectations", exact: true })).toBeVisible();
  await expect(findings.getByText(`${sample.messages.length} messages · ${sample.actors.length} actors`, { exact: false })).toBeVisible();
  expect(await findings.evaluate(element => getComputedStyle(element).backgroundColor)).toBe("rgb(247, 242, 255)");
  await findings.getByRole("button", { name: "Trace this theme" }).click();
  await expect(panel.getByLabel("Theme filter")).toHaveValue("expectations");
  await panel.getByLabel("Search message text").fill("reservation estimate");
  await expect(panel.locator(".social-timeline li")).toHaveCount(1);
  await expect(panel.locator(".social-timeline")).toContainText(sample.messages[4].text);
  const download = page.waitForEvent("download"); await panel.getByRole("button", { name: "Download analysis report" }).click(); expect((await download).suggestedFilename()).toBe("tactical-social-analysis.json");
  await panel.getByText("Choose data, import or reopen", { exact: true }).click(); await panel.getByRole("button", { name: "Use fictional conversation" }).click();
  await expect(findings).toHaveCount(0); expect(errors).toEqual([]);
});
test("observed imports require permission, save/reopen and source failures preserve work", async ({ page }) => {
  const panel = page.getByRole("region", { name: "Content and connectivity pipeline" });
  await panel.getByText("Choose data, import or reopen", { exact: true }).click();
  const imported = { ...sample, provenance: "observed", title: "Permissioned message sample" };
  const file = { name: "observed.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) };
  await panel.getByLabel("Import conversation JSON").setInputFiles(file); await expect(panel.getByRole("alert")).toHaveText("Confirm permission before importing observed messages.");
  await panel.getByLabel(/I have permission to use imported messages/).check(); await panel.getByLabel("Import conversation JSON").setInputFiles(file);
  await expect(panel.getByText("Permissioned message sample", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Save conversation locally" }).click();
  await page.reload(); await page.getByRole("button", { name: "Content & connectivity", exact: true }).click(); await panel.getByText("Choose data, import or reopen", { exact: true }).click(); await panel.getByRole("button", { name: "Reopen conversation", exact: true }).click();
  await expect(panel.getByText("Permissioned message sample", { exact: true })).toBeVisible();
  await page.route("**/api/tactical/integrations/social/source", route => route.fulfill({ status: 503, json: { error: "private details" } }));
  await panel.getByRole("button", { name: "Load public discussion" }).click(); await expect(panel.getByRole("alert")).toContainText("Current work is unchanged");
  await expect(panel.getByText("Permissioned message sample", { exact: true })).toBeVisible();
  await panel.getByLabel("Import conversation JSON").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"version":2}') }); await expect(panel.getByRole("alert")).toContainText("Invalid conversation");
});
test("invalid AI evidence fails generically and the pipeline fits narrow reduced-motion screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
  const valid = semanticResponse(); valid.semantics.topics[0].label = "Customer expectations about tipping, service charges and menu price transparency";
  await page.route("**/api/tactical/integrations/social/analyze", route => route.fulfill({ json: valid }));
  const panel = page.getByRole("region", { name: "Content and connectivity pipeline" });
  await panel.getByRole("button", { name: "Analyze message content with AI" }).click();
  await expect(panel.getByRole("region", { name: "Content connectivity findings" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.unroute("**/api/tactical/integrations/social/analyze");
  const bad = semanticResponse(); bad.semantics.annotations[0].quote = "Fabricated quote";
  await page.route("**/api/tactical/integrations/social/analyze", route => route.fulfill({ json: bad }));
  await panel.getByRole("button", { name: "Analyze message content with AI" }).click();
  await expect(panel.getByRole("alert")).toHaveText("Something is wrong");
  await expect(panel.getByText("Fabricated quote", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
