import assert from "node:assert/strict";
import test from "node:test";
import { parseMongoEnv } from "./mongodb.ts";

test("mongo env accepts mongodb:// and mongodb+srv:// URIs", () => {
  const srv = parseMongoEnv({ MONGODB_URI: "mongodb+srv://user:pass@cluster.example.net" });
  assert.equal(srv.MONGODB_URI, "mongodb+srv://user:pass@cluster.example.net");
  const plain = parseMongoEnv({ MONGODB_URI: "mongodb://localhost:27017" });
  assert.equal(plain.MONGODB_URI, "mongodb://localhost:27017");
});

test("mongo env fails with a clear message when MONGODB_URI is missing or empty", () => {
  assert.throws(() => parseMongoEnv({}), /MONGODB_URI:/);
  assert.throws(() => parseMongoEnv({ MONGODB_URI: "" }), /MONGODB_URI: is missing/);
});

test("mongo env rejects non-MongoDB URI schemes", () => {
  assert.throws(
    () => parseMongoEnv({ MONGODB_URI: "postgres://host/db" }),
    /must start with mongodb:\/\/ or mongodb\+srv:\/\//
  );
});
