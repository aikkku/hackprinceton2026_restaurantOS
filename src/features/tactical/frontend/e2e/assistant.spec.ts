import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import demo from "../data/demo-restaurant.json" with { type: "json" };
import { datasetSchema } from "../../domain/dataset";
import { executeAssistantTools } from "../../backend/assistant/tools";
import type { Conversation, AssistantPlan, AssistantMessage } from "../../domain/assistant";
const stock = demo.operations.inventory.find(row => /ribeye/i.test(row.name))!;
const dish = demo.operations.menu.find(row => /ribeye/i.test(row.name))!;
async function mock(page: Page) {
 let data = datasetSchema.parse(demo), revision = 1;
 const threads = new Map<string, Conversation>();
 await page.route("**/api/tactical/ai/session", route => route.fulfill({ json: { unlocked: true } }));
 await page.route("**/api/tactical/ai", route => route.fulfill({ status: 503, json: { error: "Something is wrong" } }));
 await page.route("**/api/tactical/assistant**", async route => {
  const url = new URL(route.request().url()), common = { ok: true, storage: "mongodb", dataset: data, datasetRevision: revision };
  if (route.request().method() === "GET") {
   const id = url.searchParams.get("threadId");
   return route.fulfill({ json: id ? { ...common, thread: threads.get(id) } : { ...common, threads: [...threads.values()].reverse().map(({ id, title, updatedAt, revision }) => ({ id, title, updatedAt, revision })) } });
  }
  const input = route.request().postDataJSON();
  if (input.action === "apply") {
   const thread = threads.get(input.threadId)!, proposal = thread.messages.find(row => row.id === input.messageId)!.proposals[0];
   data = structuredClone(data); data.operations.inventory.find(row => row.id === proposal.entityId)!.current = input.value;
   proposal.value = input.value; proposal.status = "applied"; proposal.appliedAt = new Date().toISOString(); thread.revision++; revision++;
   return route.fulfill({ json: { ...common, dataset: data, datasetRevision: revision, thread } });
  }
  const text = input.text.toLowerCase();
  const call: AssistantPlan["calls"][number] = { tool: "find_records", area: "inventory", ids: [stock.id], query: "", field: null, value: null };
  let navigate = true;
  if (text.includes("compare")) { call.tool = "stock_overview"; call.ids = []; navigate = false; }
  if (text.includes("price")) { call.tool = "price_test"; call.area = "menu"; call.ids = [dish.id]; navigate = false; }
  if (text.includes("update")) { call.tool = "propose_update"; call.field = "current"; call.value = 42; navigate = false; }
  if (text.includes("review")) { call.tool = "review_evidence"; call.area = "reviews"; call.ids = [data.reviews[0].id]; navigate = false; }
  if (text.includes("furniture")) { call.tool = "floor_plan"; call.area = "floor"; call.ids = [data.layoutConfigurations.entries[0].layout.objects[0].id]; navigate = false; }
  if (text.includes("team")) { call.tool = "team_overview"; call.area = "employees"; call.ids = [data.operations.employees[0].id]; navigate = false; }
  const result = executeAssistantTools({ message: "Here are the requested source records.", calls: [call], navigate }, data, revision);
  const now = new Date().toISOString(), old = threads.get(input.threadId);
  const user: AssistantMessage = { id: input.messageId, role: "user", text: input.text, createdAt: now, blocks: [], proposals: [], targets: [], navigate: false, model: null, datasetRevision: revision };
  const answer: AssistantMessage = { id: randomUUID(), role: "assistant", text: "Here are the requested source records.", createdAt: now, ...result, navigate, model: "browser-test", datasetRevision: revision };
  const thread: Conversation = { id: input.threadId, restaurantId: data.profile.id, title: old?.title ?? input.text, revision: (old?.revision ?? 0) + 1, createdAt: old?.createdAt ?? now, updatedAt: now, messages: [...(old?.messages ?? []), user, answer] };
  threads.set(thread.id, thread); return route.fulfill({ json: { ...common, thread } });
 });
}
async function send(page: Page, text: string) {
 await expect(page).toHaveURL(/tactical\/ai$/);
 const composer = page.getByLabel("Ask your restaurant advisor");
 await expect(composer).toBeVisible(); await expect(composer).toBeEnabled();
 await composer.fill(text); await expect(composer).toHaveValue(text);
 await page.getByRole("button", { name: "Send message", exact: true }).click();
}

test("stock lookup clears hidden filters, navigates, highlights temporarily, and saves history across reload", async ({ page }) => {
 await mock(page); await page.setViewportSize({ width: 1280, height: 720 });
 await page.goto("/tactical/supply"); await page.getByLabel("Search inventory").fill("no match");
 await page.getByRole("link", { name: "AI Assistant", exact: true }).click();
 await expect(page.getByRole("button", { name: /Find a record/ })).toBeEnabled();
 await send(page, "How much ribeye steak do we have?");
 await expect(page).toHaveURL(/tactical\/supply/);
 const tile = page.locator(`[data-inventory-id="${stock.id}"]`);
 await expect(page.getByLabel("Search inventory")).toHaveValue(""); await expect(tile).toHaveClass(/assistant-location-highlight/);
 await expect(tile).toBeFocused(); await expect(tile).toContainText(String(stock.current));
 await expect(tile).not.toHaveClass(/assistant-location-highlight/, { timeout: 7000 });
 await page.getByRole("link", { name: "AI Assistant", exact: true }).click();
 await expect(page.getByRole("region", { name: "Inventory records", exact: true })).toContainText(`${stock.current} ${stock.unit}`);
 await page.reload();
 await expect(page.getByRole("log")).toContainText("How much ribeye steak do we have?");
 await expect(page.getByRole("region", { name: "Inventory records", exact: true })).toBeVisible();
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("chat provides stock charts, canonical price sliders, new conversations and history reopening", async ({ page }) => {
 await mock(page); await page.goto("/tactical/ai");
 await expect(page.getByRole("button", { name: /Understand stock/ })).toBeEnabled();
 await send(page, "Compare our low stock");
 await expect(page.getByRole("region", { name: "Stock against reorder points" })).toBeVisible();
 await send(page, "Try a price increase for ribeye");
 const slider = page.getByRole("slider", { name: `Price increase for ${dish.name}` });
 await slider.focus(); await page.keyboard.press("ArrowRight");
 const testResult = page.getByRole("region", { name: `Price test for ${dish.name}` });
 await expect(testResult.locator(".assistant-metrics")).not.toContainText("$45.00");
 await page.getByRole("button", { name: "New chat", exact: true }).click();
 await expect(page.getByRole("heading", { name: "What would you like to work on?" })).toBeVisible();
 await page.getByRole("complementary", { name: "Chat history" }).getByRole("button", { name: /Compare our low stock/ }).click();
 await expect(testResult).toBeVisible();
});
test("editing a proposal changes shared stock only after Apply, and persists its audit state", async ({ page }) => {
 await mock(page); await page.goto("/tactical/ai");
 await expect(page.getByRole("button", { name: /Find a record/ })).toBeEnabled();
 await send(page, "Update ribeye on hand to forty two");
 const proposal = page.getByRole("region", { name: `Change ${stock.name}` });
 await proposal.getByRole("spinbutton").fill("43");
 await page.getByRole("link", { name: "Supply Management", exact: true }).click();
 await expect(page.locator(`[data-inventory-id="${stock.id}"] .supply-item-facts`)).toContainText(String(stock.current));
 await page.getByRole("link", { name: "AI Assistant", exact: true }).click();
 await proposal.getByRole("button", { name: "Apply change", exact: true }).click();
 await expect(proposal).toContainText("Saved change");
 await proposal.getByRole("button", { name: "View updated record" }).click();
 await expect(page.locator(`[data-inventory-id="${stock.id}"] .supply-item-facts`)).toContainText("43");
 await page.getByRole("link", { name: "AI Assistant", exact: true }).click(); await expect(page).toHaveURL(/tactical\/ai/); await page.reload();
 await expect(proposal).toContainText("Saved change");
 await expect(proposal.getByRole("button", { name: "Apply change", exact: true })).toHaveCount(0);
});
test("provider failure keeps the draft, reports generic error, and keyboard-accessible chat fits narrow screens", async ({ page }) => {
 await mock(page); await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
 await page.goto("/tactical/ai"); await expect(page.getByRole("button", { name: /Find a record/ })).toBeEnabled();
 await page.route("**/api/tactical/assistant", route => route.fulfill({ status: 503, json: { error: "private provider failure" } }));
 await send(page, "Explain the stock");
 await expect(page.getByRole("region", { name: "AI restaurant advisor" }).getByRole("alert")).toHaveText("Something is wrong");
 await expect(page.getByLabel("Ask your restaurant advisor")).toHaveValue("Explain the stock");
 await expect(page.getByText("private provider failure")).toHaveCount(0);
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("record links reveal Finance menu, HR roster, review evidence and floor furniture", async ({ page }) => {
 await mock(page); await page.setViewportSize({ width: 1280, height: 720 }); await page.goto("/tactical/ai");
 await expect(page.getByRole("button", { name: /Find a record/ })).toBeEnabled();
 await send(page, "Try the ribeye price");
 await page.getByRole("log").getByRole("button", { name: dish.name, exact: true }).click();
 await expect(page).toHaveURL(/tactical\/finance/);
 await expect(page.locator(`[data-assistant-key="menu:${dish.id}"]`)).toHaveClass(/assistant-location-highlight/);
 await expect(page.getByRole("region", { name: "Current menu assumptions table" })).toBeVisible();
 await page.getByRole("link", { name: "AI Assistant", exact: true }).click();
 await send(page, "Show the team");
 const employee = demo.operations.employees[0];
 await page.getByRole("button", { name: `Locate ${employee.name}`, exact: true }).click();
 await expect(page).toHaveURL(/tactical\/hr/);
 await expect(page.locator(`[data-assistant-key="employee:${employee.id}"]`)).toHaveClass(/assistant-location-highlight/);
 await expect(page.getByRole("region", { name: "Team roster" })).toBeVisible();
 await page.getByRole("link", { name: "AI Assistant", exact: true }).click();
 await send(page, "Show a review");
 await page.getByRole("button", { name: `Locate Review ${demo.reviews[0].date}`, exact: true }).click();
 await expect(page).toHaveURL(/tactical\/reviews/);
 await expect(page.locator(`[data-review-id="${demo.reviews[0].id}"]`)).toHaveClass(/assistant-location-highlight/);
 await page.getByRole("link", { name: "AI Assistant", exact: true }).click();
 await send(page, "Show furniture coordinates");
 await page.getByRole("region", { name: "Saved floor plan", exact: true }).getByRole("button").first().click();
 await expect(page).toHaveURL(/tactical$/);
 await expect(page.locator("g.assistant-location-highlight")).toHaveCount(1);
});
