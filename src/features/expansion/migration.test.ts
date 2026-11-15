import test from "node:test";
import assert from "node:assert/strict";
import { BSON, type Db, type Document } from "mongodb";
import { COLLECTIONS, EVENT_RETENTION_S, MIGRATIONS_COLLECTION, migrateMongo } from "./backend/store.ts";

test("migration sends boolean uniqueness over BSON and reruns after partial initialization", async () => {
  // A previous failed migration may already have created the first collection.
  const collections = new Set<string>([COLLECTIONS.profiles]);
  const indexes = new Map<string, Document>();
  let completions = 0;
  const db = {
    databaseName: "synthetic_migration_test",
    listCollections: () => ({ toArray: async () => [...collections].map(name => ({ name })) }),
    createCollection: async (name: string) => {
      assert.ok(!collections.has(name), "existing collections must not be recreated");
      collections.add(name);
    },
    collection: (name: string) => ({
      createIndex: async (key: Document, options: Document) => {
        // Match the driver's default: undefined options become BSON null.
        const wire = BSON.deserialize(BSON.serialize({ key, ...options }, { ignoreUndefined: false }));
        assert.equal(typeof wire.unique, "boolean", `${name}/${wire.name}: MongoDB rejects unique:null (code 14)`);
        assert.ok(Object.values(COLLECTIONS).includes(name as typeof COLLECTIONS[keyof typeof COLLECTIONS]));
        const id = `${name}/${wire.name}`;
        if (indexes.has(id)) assert.deepEqual(wire, indexes.get(id), "reruns retain the same index options");
        indexes.set(id, wire);
      },
      updateOne: async () => {
        assert.equal(name, MIGRATIONS_COLLECTION);
        assert.equal(indexes.size, 11, "record completion only after every index succeeds");
        completions++;
      },
    }),
  } as unknown as Db;

  const first = await migrateMongo(db);
  assert.equal(first.created.length, 7);
  assert.deepEqual(first.existing, [COLLECTIONS.profiles]);
  assert.equal([...indexes.values()].filter(index => index.unique === true).length, 4);
  assert.equal([...indexes.values()].filter(index => index.unique === false).length, 7);
  assert.equal(indexes.get(`${COLLECTIONS.runEvents}/retention_ttl`)?.expireAfterSeconds, EVENT_RETENTION_S);

  const second = await migrateMongo(db);
  assert.deepEqual(second.created, []);
  assert.equal(second.existing.length, 8);
  assert.equal(second.indexes, 11);
  assert.equal(completions, 2);
});
