import test from "node:test";
import assert from "node:assert/strict";
import demo from "./frontend/data/demo-restaurant.json" with { type: "json" };
import { datasetSchema } from "./domain/dataset.ts";
test("inventory expiration dates survive validation and reject impossible dates without breaking legacy records", () => {
  const parsed = datasetSchema.parse(demo);
  assert.ok(parsed.operations.inventory.every(item => item.expirationDate !== undefined));
  assert.equal(parsed.operations.inventory.find(item => item.category === "Packaging")!.expirationDate, null);
  const changed = structuredClone(parsed);
  changed.operations.inventory[0].expirationDate = "2026-02-30";
  assert.equal(datasetSchema.safeParse(changed).success, false);
  delete changed.operations.inventory[0].expirationDate;
  assert.equal(datasetSchema.safeParse(changed).success, true);
});
