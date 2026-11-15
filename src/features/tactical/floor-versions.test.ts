import assert from "node:assert/strict";
import test from "node:test";
import demo from "./frontend/data/demo-restaurant.json" with { type: "json" };
import { createFloorVersionsHandler } from "./backend/floor-versions.ts";
import type { DatasetRecord, DatasetRepository } from "./backend/mongodb.ts";
import { datasetSchema } from "./domain/dataset.ts";

test("MongoDB-backed floor saving appends immutable versions and rebases concurrent additions", async () => {
  const dataset = datasetSchema.parse(demo);
  const original = dataset.layoutConfigurations;
  const newPlan = { id: "second", layout: { ...dataset.layout, name: "Alternate table setup", objects: dataset.layout.objects.map(object => object.id === "south-two" ? { ...object, x: 5.35 } : object) } };
  const concurrent = { id: "other", layout: { ...dataset.layout, name: "Another client's setup" } };
  let record: DatasetRecord = { _id: dataset.profile.id, revision: 3, updatedAt: dataset.layout.updatedAt, dataset };
  let writes = 0;
  const repository: DatasetRepository = {
    list: async () => [],
    read: async () => record,
    save: async (next, expected) => {
      assert.equal(expected, record.revision);
      if (++writes === 1) {
        record = { ...record, revision: 4, dataset: { ...record.dataset, layoutConfigurations: { ...original, entries: [...original.entries, concurrent] } } };
        return null;
      }
      record = { ...record, revision: expected + 1, dataset: next };
      return record;
    },
  };
  const handler = createFloorVersionsHandler({ repository, restaurantId: () => dataset.profile.id, authorize: () => true });
  const request = (library: unknown, origin = "http://localhost") => new Request("http://localhost/api/tactical/floor-versions", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ library }) });
  const proposal = { ...original, activeId: newPlan.id, entries: [...original.entries, newPlan] };
  assert.equal((await handler(request(proposal, "https://foreign.example"))).status, 401);
  const saved = await handler(request(proposal));
  assert.equal(saved.status, 200);
  const { library } = await saved.json();
  assert.deepEqual(library.entries.map((item: { id: string }) => item.id), [original.activeId, concurrent.id, newPlan.id]);
  assert.equal(library.entries[2].layout.objects.find((item: { id: string }) => item.id === "south-two").x, 5.35);
  assert.deepEqual(record.dataset.operations, dataset.operations);
  assert.deepEqual(record.dataset.scenarioSnapshots, dataset.scenarioSnapshots);
  assert.equal((await handler(request(proposal))).status, 200);
  assert.equal(writes, 2);
  assert.equal((await handler(request({ ...proposal, entries: [{ ...original.entries[0], layout: { ...dataset.layout, name: "Overwrite" } }, newPlan] }))).status, 409);
  assert.equal((await handler(request({ ...proposal, entries: [{ ...newPlan, layout: { ...newPlan.layout, restaurantId: "other-restaurant" } }], baselineId: newPlan.id }))).status, 422);
});
