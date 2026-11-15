import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import demo from "./frontend/data/demo-restaurant.json" with { type: "json" };
import { datasetSchema } from "./domain/dataset.ts";
import { assistantPlanSchema, applyAssistantProposal, assistantSuggestions, type AssistantPlan } from "./domain/assistant.ts";
import { executeAssistantTools } from "./backend/assistant/tools.ts";
import { memoryAssistantRepository } from "./backend/assistant/repository.ts";
import { createAssistantHandler } from "./backend/assistant/service.ts";
import type { generateStructured } from "./backend/gemini.ts";
const dataset = datasetSchema.parse(demo);
const stock = dataset.operations.inventory.find(row => /ribeye/i.test(row.name))!;
const menu = dataset.operations.menu.find(row => /ribeye/i.test(row.name))!;
const record = { _id: dataset.profile.id, revision: 5, updatedAt: "2026-11-15T12:00:00Z", dataset };
const call = (tool: AssistantPlan["calls"][number]["tool"], area: AssistantPlan["calls"][number]["area"], ids: string[] = []) => ({ tool, area, ids, query: "", field: null, value: null });
const plan = (calls: AssistantPlan["calls"], navigate = false): AssistantPlan => ({ message: "Here are the source records for your restaurant.", calls, navigate });
const proposalPlan = plan([{ ...call("propose_update", "inventory", [stock.id]), field: "current", value: 42 }]);
function request(input: unknown, origin = "http://localhost") { return new Request("http://localhost/api/tactical/assistant", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(input) }); }
const input = () => ({ action: "message", restaurantId: dataset.profile.id, threadId: randomUUID(), messageId: randomUUID(), text: "Find the ribeye quantity" });
const generated = (value: unknown) => (async () => value) as typeof generateStructured;
function setup(value = plan([call("find_records", "inventory", [stock.id])], true)) {
  const repo = memoryAssistantRepository(record);
  return { repo, handle: createAssistantHandler({ repository: () => repo, generate: generated(value), authorize: () => true, budget: () => true }) };
}
test("assistant tools return canonical stock, finance metrics and exact review evidence", () => {
  const result = executeAssistantTools(plan([call("find_records", "inventory", [stock.id]), call("finance_report", "finance"), call("review_evidence", "reviews", [dataset.reviews[0].id])]), dataset, 5);
  assert.equal(result.blocks[0].type, "table");
  if (result.blocks[0].type === "table") assert.equal(result.blocks[0].rows[0].cells[1], `${stock.current} ${stock.unit}`);
  assert.equal(result.targets[0].page, "supply");
  assert.equal(result.blocks[2].type, "table");
  if (result.blocks[2].type === "table") assert.equal(result.blocks[2].rows[0].cells[2], dataset.reviews[0].text);
  assert.throws(() => executeAssistantTools(plan([call("find_records", "inventory", ["invented"])]), dataset, 5));
  assert.ok(assistantSuggestions(dataset)[0].includes(stock.name));
});
test("tool schemas reject arbitrary tools/fields; proposals cannot mutate other records or invalid values", () => {
  assert.equal(assistantPlanSchema.safeParse(plan([{ ...call("find_records", "inventory"), tool: "drop_database" } as never])).success, false);
  const proposal = executeAssistantTools(proposalPlan, dataset, 5).proposals[0];
  const changed = applyAssistantProposal(dataset, proposal, 42);
  assert.equal(changed.operations.inventory.find(row => row.id === stock.id)!.current, 42);
  assert.equal(dataset.operations.inventory.find(row => row.id === stock.id)!.current, stock.current);
  assert.deepEqual(changed.operations.menu, dataset.operations.menu);
  assert.throws(() => applyAssistantProposal(dataset, proposal, -1));
  assert.throws(() => applyAssistantProposal(dataset, { ...proposal, field: "dineInPriceCents" }, 100));
  assert.throws(() => applyAssistantProposal(dataset, { ...proposal, before: -1 }, 100));
});
test("price widget uses historical sales snapshots and stock charts normalize heterogeneous units", () => {
  const result = executeAssistantTools(plan([call("price_test", "menu", [menu.id]), call("stock_overview", "inventory", [stock.id])]), dataset, 5);
  const sale = dataset.operations.financeReport!.sales.find(row => row.menuItemId === menu.id)!;
  assert.equal(result.blocks[0].type, "price-test");
  if (result.blocks[0].type === "price-test") { assert.equal(result.blocks[0].priceCents, sale.dineInPriceCents); assert.equal(result.blocks[0].units, sale.dineInUnits); }
  if (result.blocks[1].type === "chart") assert.equal(result.blocks[1].rows[0].value, stock.current / stock.threshold * 100);
});
test("chat history survives a new handler, passes prior messages to the model, and replays retry IDs once", async () => {
  const { repo, handle } = setup(); const first = input();
  const answer = await (await handle(request(first))).json(); assert.equal(answer.thread.messages.length, 2);
  assert.equal(answer.thread.messages[1].navigate, true);
  const replay = await (await handle(request(first))).json(); assert.equal(replay.replayed, true); assert.equal(replay.thread.messages.length, 2);
  let prompt = "";
  const next = createAssistantHandler({ repository: () => repo, authorize: () => true, budget: () => true, generate: (async (_schema, _system, value) => { prompt = value; return plan([call("stock_overview", "inventory")]); }) as typeof generateStructured });
  const response = await next(request({ ...first, messageId: randomUUID(), text: "Compare it with the other low stock" }));
  assert.equal(response.status, 200); assert.ok(prompt.includes(first.text)); assert.ok(prompt.includes(stock.id));
  assert.equal(prompt.includes("@example.com"), false);
  const loaded = await next(new Request(`http://localhost/api/tactical/assistant?restaurantId=${dataset.profile.id}&threadId=${first.threadId}`));
  assert.equal((await loaded.json()).thread.messages.length, 4);
});
test("Apply updates dataset and saved chat atomically; replay does not double-apply; stale changes conflict", async () => {
  const { repo, handle } = setup(proposalPlan), first = input();
  const result = await (await handle(request(first))).json();
  assert.equal((await repo.dataset()).revision, 5);
  const message = result.thread.messages[1];
  const apply = { action: "apply", restaurantId: dataset.profile.id, threadId: first.threadId, messageId: message.id, proposalId: message.proposals[0].id, value: 43 };
  const applied = await (await handle(request(apply))).json();
  assert.equal(applied.dataset.operations.inventory.find((row: { id: string }) => row.id === stock.id).current, 43);
  assert.equal(applied.datasetRevision, 6); assert.equal(applied.thread.messages[1].proposals[0].status, "applied");
  assert.equal((await (await handle(request(apply))).json()).datasetRevision, 6);
  const stale = setup(proposalPlan); const a = input(), b = input();
  const one = await (await stale.handle(request(a))).json(), two = await (await stale.handle(request(b))).json();
  const mutation = (value: typeof one, id: string) => ({ ...apply, threadId: id, messageId: value.thread.messages[1].id, proposalId: value.thread.messages[1].proposals[0].id });
  assert.equal((await stale.handle(request(mutation(one, a.threadId)))).status, 200);
  assert.equal((await stale.handle(request(mutation(two, b.threadId)))).status, 409);
  assert.equal((await stale.repo.read(b.threadId, dataset.profile.id))!.messages[1].proposals[0].status, "pending");
});
test("assistant enforces origin, access, restaurant binding, generic provider failures and no fabricated finance narration", async () => {
  const { repo, handle } = setup(), body = input();
  assert.equal((await handle(request(body, "https://wrong.example"))).status, 403);
  assert.equal((await handle(request({ ...body, restaurantId: "other" }))).status, 403);
  const locked = createAssistantHandler({ repository: () => repo, authorize: () => false });
  assert.equal((await locked(new Request(`http://localhost/api/tactical/assistant?restaurantId=${dataset.profile.id}`))).status, 401);
  const unavailable = createAssistantHandler({ repository: () => repo, authorize: () => true, budget: () => true, generate: (async () => { throw new Error("private provider credentials"); }) as typeof generateStructured });
  assert.deepEqual(await (await unavailable(request(body))).json(), { ok: false, error: "Something is wrong" });
  assert.equal((await repo.list(dataset.profile.id)).length, 0);
  const invented = setup({ ...plan([]), message: "Your profit is $999999." });
  assert.equal((await invented.handle(request(body))).status, 503);
});
test("persistence failure never reports a saved answer or mutates data", async () => {
  const { repo } = setup();
  const handle = createAssistantHandler({ repository: () => ({ ...repo, save: async () => { throw new Error("Database offline"); } }), authorize: () => true, budget: () => true, generate: generated(proposalPlan) });
  assert.equal((await handle(request(input()))).status, 503); assert.equal((await repo.dataset()).revision, 5); assert.equal((await repo.list(dataset.profile.id)).length, 0);
});
