import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { datasetSchema } from "./domain/dataset.ts";
import { channelContribution, summarizeLedger, stockStatus } from "./domain/finance.ts";
import { createDataApi, maxDatasetBytes } from "./backend/data-api.ts";
import type { DatasetRecord, DatasetRepository } from "./backend/mongodb.ts";
const raw = JSON.parse(readFileSync(new URL("./frontend/data/demo-restaurant.json", import.meta.url), "utf8"));
const dataset = datasetSchema.parse(raw);

test("central mock dataset validates relationships and forbids real-data claims", () => {
  assert.equal(dataset.operations.transactions.length, 90);
  assert.equal(dataset.operations.employees.length, 8);
  assert.equal(dataset.operations.inventory.length, 15);
  assert.equal(datasetSchema.safeParse({ ...raw, isDemo: false }).success, false);
  assert.equal(datasetSchema.safeParse({ ...raw, provenance: { ...raw.provenance, origin: "observed" } }).success, false);
  assert.equal(datasetSchema.safeParse({ ...raw, operations: { ...raw.operations, inventory: [{ ...raw.operations.inventory[0], supplierId: "missing" }] } }).success, false);
  assert.equal(datasetSchema.safeParse({ ...raw, operations: { ...raw.operations, transactions: [raw.operations.transactions[0], raw.operations.transactions[0]] } }).success, false);
  assert.equal(datasetSchema.safeParse({ ...raw, operations: { ...raw.operations, competitors: [{ ...raw.operations.competitors[0], menuItemId: "missing" }] } }).success, false);
});

test("ledger totals reconcile and channel costs affect contribution", () => {
  const rows = dataset.operations.transactions;
  const totals = summarizeLedger(rows);
  assert.equal(totals.revenueCents, totals.dineInCents + totals.deliveryCents);
  assert.equal(totals.netRecordedCents, totals.revenueCents - totals.expenseCents);
  assert.equal(summarizeLedger([]).netRecordedCents, 0);
  const item = dataset.operations.menu[0];
  const delivery = channelContribution(item, "delivery");
  assert.equal(delivery.contributionCents, item.deliveryPriceCents - Math.round(item.deliveryPriceCents * .25) - item.packagingCostCents - item.ingredientCostCents);
  assert.equal(channelContribution(item, "dine-in", 0).contributionCents, -item.ingredientCostCents);
  assert.throws(() => channelContribution(item, "delivery", NaN));
  assert.throws(() => channelContribution(item, "delivery", -1));
  assert.equal(stockStatus(1, 4), "critical");
  assert.equal(stockStatus(4, 4), "good");
  assert.equal(stockStatus(7, 4), "overstock");
});

test("dataset API authenticates, validates, creates, reads and rejects stale revisions", async () => {
  const original = process.env.TACTICAL_API_TOKEN;
  const token = "a".repeat(48);
  process.env.TACTICAL_API_TOKEN = token;
  let record: DatasetRecord | null = null;
  let writes = 0;
  const repository: DatasetRepository = {
    async list() { return record ? [{ id: record._id, name: record.dataset.profile.name, revision: record.revision, updatedAt: record.updatedAt }] : []; },
    async read(id) { return record?._id === id ? record : null; },
    async save(data, expected) { if ((record?.revision ?? 0) !== expected) return null; writes++; record = { _id: data.profile.id, revision: expected + 1, updatedAt: new Date().toISOString(), dataset: data }; return record; },
  };
  const handle = createDataApi(repository);
  const req = (method: string, body?: unknown, auth = true) => new Request("http://localhost/api", { method, headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    assert.equal((await handle(req("PUT", { expectedRevision: 0, dataset }, false), "juniper-table")).status, 401);
    assert.equal((await handle(req("GET"), "missing")).status, 404);
    assert.equal((await handle(req("PUT", { expectedRevision: 0, dataset }), "another")).status, 422);
    assert.equal((await handle(req("PUT", { expectedRevision: 0, dataset: {} }), "juniper-table")).status, 422);
    assert.equal((await handle(req("POST", { expectedRevision: 0, dataset }), undefined, true)).status, 200);
    assert.equal(writes, 0);
    assert.equal((await handle(req("PUT", { expectedRevision: 0, dataset }), "juniper-table")).status, 201);
    assert.equal((await handle(req("PUT", { expectedRevision: 0, dataset }), "juniper-table")).status, 409);
    const read = await (await handle(req("GET"), "juniper-table")).json();
    assert.equal(read.revision, 1);
    assert.equal(read.dataset.profile.name, dataset.profile.name);
    assert.equal((await handle(req("PUT", { expectedRevision: 1, dataset }), "juniper-table")).status, 200);
    assert.equal(writes, 2);
    const oversized = new Request("http://localhost/api", { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "x".repeat(maxDatasetBytes + 1) });
    assert.equal((await handle(oversized, "juniper-table")).status, 413);
    const broken = createDataApi({ ...repository, read: async () => { throw new Error("private connection URI"); } });
    const failed = await broken(req("GET"), "juniper-table");
    assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes("private connection URI"));
    delete process.env.TACTICAL_API_TOKEN;
    assert.equal((await handle(req("GET"))).status, 503);
  } finally {
    if (original === undefined) delete process.env.TACTICAL_API_TOKEN; else process.env.TACTICAL_API_TOKEN = original;
  }
});
