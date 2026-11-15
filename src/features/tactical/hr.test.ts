import test from "node:test";
import assert from "node:assert/strict";
import demo from "./frontend/data/demo-restaurant.json" with { type: "json" };
import { datasetSchema } from "./domain/dataset.ts";
import { workforceMetrics, hrContext, validateHrResult, hrCardIds } from "./domain/hr.ts";
import { createHrHandler, type HrAnalysisRecord } from "./backend/hr-service.ts";
import type { generateStructured } from "./backend/gemini.ts";
const dataset = datasetSchema.parse(demo);
const overview = { cards: hrCardIds.map(id => ({ id, status: "yellow" as const, reason: "The supplied schedule has gaps.", evidenceIds: ["workforce"], limitation: "Synthetic demand is not a forecast." })) };
const request = (method = "POST") => new Request(`http://localhost/api/tactical/hr?restaurantId=${dataset.profile.id}`, { method, headers: { origin: "http://localhost", "content-type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify({ restaurantId: dataset.profile.id, task: "overview" }) } : {}) });
test("HR fixture has seven employees and reconciles shifts, item sales and order volume", () => {
  assert.equal(dataset.operations.employees.length, 7);
  const metrics = workforceMetrics(dataset);
  assert.equal(metrics.hours, 255);
  assert.equal(metrics.hoursAboveGuide, 10);
  assert.equal(metrics.salesCents, metrics.menuSales.reduce((sum, item) => sum + item.salesCents, 0));
  assert.equal(metrics.orders, metrics.days.reduce((sum, day) => sum + day.orders, 0));
  assert.equal(metrics.laborCents, dataset.operations.employees.reduce((sum, employee) => sum + employee.hoursThisWeek * employee.hourlyRateCents, 0));
});
test("HR schedule rejects overlaps, foreign references, mismatched hours and invalid demand", () => {
  for (const mutate of [
    (d: typeof dataset) => d.operations.workforce!.shifts.push({ ...d.operations.workforce!.shifts[0], id: "overlap" }),
    (d: typeof dataset) => { d.operations.workforce!.shifts[0].employeeId = "unknown"; },
    (d: typeof dataset) => { d.operations.employees[0].hoursThisWeek = 1; },
    (d: typeof dataset) => { d.operations.workforce!.demand[0].items[0].menuItemId = "unknown"; },
    (d: typeof dataset) => { d.operations.workforce!.demand[0].peakOrders = 9999; },
  ]) { const value = structuredClone(dataset); mutate(value); assert.equal(datasetSchema.safeParse(value).success, false); }
  const legacy = structuredClone(dataset); delete legacy.operations.workforce; assert.equal(datasetSchema.safeParse(legacy).success, true);
});
test("zero sales has no labor ratio and uncovered peak intervals use union coverage", () => {
  const value = structuredClone(dataset);
  for (const day of value.operations.workforce!.demand) { day.orders = 0; day.peakOrders = 0; for (const item of day.items) item.quantity = 0; }
  const metrics = workforceMetrics(datasetSchema.parse(value));
  assert.equal(metrics.laborFraction, null); assert.equal(metrics.averageOrderCents, null);
  const monday = metrics.days[0];
  assert.equal(monday.peakCoverage.find(row => row.station === "Floor")?.staffHours, 3);
  assert.equal(monday.peakCoverage.find(row => row.station === "Floor")?.uncoveredMinutes, 60);
  assert.equal(monday.peakCoverage.find(row => row.station === "Bar")?.uncoveredMinutes, 180);
});
test("HR AI sees role aggregates and evidence, never employee profiles or performance", () => {
  const context = hrContext(dataset); const text = JSON.stringify(context);
  for (const employee of dataset.operations.employees) { assert.ok(!text.includes(employee.name)); assert.ok(!text.includes(employee.email)); }
  assert.ok(!text.includes('"mood"')); assert.ok(!text.includes('"rating":"Excellent"'));
  assert.equal(context.evidence.filter(row => row.id.startsWith("menu:")).length, 24);
  assert.equal(context.evidence.filter(row => row.id.startsWith("review:")).length, 30);
  assert.throws(() => validateHrResult("overview", { cards: overview.cards.map(card => ({ ...card, id: "coverage" })) }, context.evidence));
  assert.throws(() => validateHrResult("overview", { cards: overview.cards.map(card => ({ ...card, evidenceIds: ["invented"] })) }, context.evidence));
});
test("HR analysis persists, reuses identical evidence and invalidates changed demand", async () => {
  let current = structuredClone(dataset); let calls = 0;
  const values = new Map<string, HrAnalysisRecord>();
  const options = { load: async () => current, store: { read: async (key: string) => values.get(key) ?? null, write: async (key: string, value: HrAnalysisRecord) => { values.set(key, value); } }, generate: (async () => { calls++; return overview; }) as typeof generateStructured, authorize: () => true, budget: () => true };
  let handler = createHrHandler(options);
  assert.equal((await (await handler(request("GET"))).json()).result, null); assert.equal(calls, 0);
  assert.equal((await handler(request())).status, 200); assert.equal(calls, 1);
  handler = createHrHandler(options);
  assert.equal((await (await handler(request())).json()).cached, true); assert.equal(calls, 1);
  current = structuredClone(dataset); current.operations.workforce!.demand[0].items[0].quantity++;
  assert.equal((await handler(request())).status, 200); assert.equal(calls, 2);
});
test("HR failures are generic and unauthorized requests never generate", async () => {
  const handler = createHrHandler({ load: async () => dataset, authorize: () => false });
  assert.equal((await handler(request())).status, 401);
  const broken = createHrHandler({ load: async () => dataset, authorize: () => true, budget: () => true, generate: (async () => { throw new Error("private provider detail"); }) as typeof generateStructured });
  const response = await broken(request());
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, error: "Something is wrong" });
});
