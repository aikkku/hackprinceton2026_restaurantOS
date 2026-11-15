import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Db, Document } from "mongodb";

/**
 * Expansion durable repository (server-only).
 *
 * One small owner-scoped document interface with three implementations:
 * - `mongodb`: the shared `restaurantos` database (MONGODB_URI / MONGODB_DB)
 *   through the existing src/lib/mongodb.ts connection helper, with
 *   Expansion-owned `expansion_*` collections, $jsonSchema validators and
 *   indexes (migration `expansion-mongo-v1`). No other collection is touched.
 * - `file`: single-host development fallback under the git-ignored data dir.
 * - `memory`: tests.
 *
 * Every read and write takes an `ownerId`; a document id alone never reaches
 * another owner's data. Immutable records (profile revisions, briefs, events,
 * evidence snapshots) are insert-only and compared by content hash.
 */

if (typeof window !== "undefined") throw new Error("backend/store.ts is server-only.");

export const COLLECTIONS = {
  profiles: "expansion_profiles",
  profileRevisions: "expansion_profile_revisions",
  runs: "expansion_runs",
  runEvents: "expansion_run_events",
  assessments: "expansion_candidate_assessments",
  evidence: "expansion_evidence",
  scenarios: "expansion_scenarios",
  briefs: "expansion_decision_briefs",
} as const;
export type CollectionKey = keyof typeof COLLECTIONS;
export const MIGRATION_ID = "expansion-mongo-v1";
export const MIGRATIONS_COLLECTION = "expansion_migrations";
/** Raw run events are bounded; briefs keep their own frozen snapshots. */
export const EVENT_RETENTION_S = 180 * 24 * 60 * 60;

export type StoredDoc = { _id: string; ownerId: string; [key: string]: unknown };
export type InsertResult = "inserted" | "duplicate" | "conflict";
export type Scalar = string | number | boolean | null;

export class PersistenceError extends Error {
  code: "persistence_unavailable" | "conflict" | "invalid" | "not_found";
  constructor(code: PersistenceError["code"], message: string) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
  }
}

export interface ExpansionRepository {
  readonly mode: "mongodb" | "file" | "memory";
  insertImmutable(collection: CollectionKey, doc: StoredDoc): Promise<InsertResult>;
  upsert(collection: CollectionKey, doc: StoredDoc): Promise<void>;
  get(collection: CollectionKey, ownerId: string, id: string): Promise<StoredDoc | null>;
  list(collection: CollectionKey, ownerId: string, filter?: Record<string, Scalar>, options?: { sort?: [string, 1 | -1]; limit?: number }): Promise<StoredDoc[]>;
  ping(): Promise<{ ok: boolean; latencyMs: number | null; detail: string }>;
}

const OWNER = /^[a-zA-Z0-9_-]{1,64}$/;
export const docId = (ownerId: string, ...parts: string[]) => [ownerId, ...parts].join(":");
export function contentHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}
function assertOwned(doc: StoredDoc) {
  if (!OWNER.test(doc.ownerId) || typeof doc._id !== "string" || !doc._id.startsWith(`${doc.ownerId}:`)) {
    throw new PersistenceError("invalid", "Stored documents must be namespaced by their owner.");
  }
}
const matches = (doc: StoredDoc, filter: Record<string, Scalar>) => Object.entries(filter).every(([key, value]) => doc[key] === value);
function sortAndLimit(docs: StoredDoc[], options: { sort?: [string, 1 | -1]; limit?: number } = {}) {
  const [field, direction] = options.sort ?? ["_id", 1];
  const value = (doc: StoredDoc) => { const item = doc[field]; return item instanceof Date ? item.toISOString() : item as string | number; };
  docs.sort((a, b) => (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0) * direction);
  return docs.slice(0, Math.min(options.limit ?? 200, 1000));
}
const clone = <T>(value: T): T => structuredClone(value);

// ---------------------------------------------------------------------------
// Memory (tests)

export function createMemoryRepository(): ExpansionRepository {
  const data = new Map<CollectionKey, Map<string, StoredDoc>>();
  const bucket = (collection: CollectionKey) => { let map = data.get(collection); if (!map) data.set(collection, (map = new Map())); return map; };
  return {
    mode: "memory",
    async insertImmutable(collection, doc) {
      assertOwned(doc);
      const map = bucket(collection);
      const existing = map.get(doc._id);
      if (existing) return existing.contentHash === doc.contentHash ? "duplicate" : "conflict";
      map.set(doc._id, clone(doc));
      return "inserted";
    },
    async upsert(collection, doc) { assertOwned(doc); bucket(collection).set(doc._id, clone(doc)); },
    async get(collection, ownerId, id) {
      const doc = bucket(collection).get(id);
      return doc && doc.ownerId === ownerId ? clone(doc) : null;
    },
    async list(collection, ownerId, filter = {}, options) {
      return sortAndLimit([...bucket(collection).values()].filter(doc => doc.ownerId === ownerId && matches(doc, filter)).map(clone), options);
    },
    async ping() { return { ok: true, latencyMs: 0, detail: "in-memory test repository" }; },
  };
}

// ---------------------------------------------------------------------------
// File (single-host development fallback)

const encode = (id: string) => Buffer.from(id).toString("base64url");
function revive(value: unknown): StoredDoc {
  const doc = value as StoredDoc;
  for (const key of Array.isArray(doc.__dates) ? doc.__dates as string[] : []) if (typeof doc[key] === "string") doc[key] = new Date(doc[key] as string);
  delete doc.__dates;
  return doc;
}
function serialize(doc: StoredDoc): string {
  const dates = Object.entries(doc).filter(([, value]) => value instanceof Date).map(([key]) => key);
  return JSON.stringify({ ...doc, __dates: dates });
}

export function createFileRepository(root: string): ExpansionRepository {
  const base = resolve(root);
  const path = (collection: CollectionKey, ownerId: string, id?: string) =>
    id === undefined ? resolve(base, COLLECTIONS[collection], ownerId) : resolve(base, COLLECTIONS[collection], ownerId, `${encode(id)}.json`);
  const read = (file: string): StoredDoc | null => {
    if (!existsSync(file)) return null;
    try { return revive(JSON.parse(readFileSync(file, "utf8"))); } catch { return null; }
  };
  const write = (file: string, content: string, exclusive: boolean) => {
    mkdirSync(dirname(file), { recursive: true });
    if (exclusive) { writeFileSync(file, content, { flag: "wx" }); return; }
    const temporary = `${file}.tmp-${process.pid}`;
    if (existsSync(temporary)) rmSync(temporary);
    writeFileSync(temporary, content);
    for (let attempt = 0; ; attempt += 1) {
      try { renameSync(temporary, file); return; } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (!["EPERM", "EACCES", "EBUSY"].includes(code) || attempt >= 10) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
      }
    }
  };
  return {
    mode: "file",
    async insertImmutable(collection, doc) {
      assertOwned(doc);
      const file = path(collection, doc.ownerId, doc._id);
      try { write(file, serialize(doc), true); return "inserted"; } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
        return read(file)?.contentHash === doc.contentHash ? "duplicate" : "conflict";
      }
    },
    async upsert(collection, doc) { assertOwned(doc); write(path(collection, doc.ownerId, doc._id), serialize(doc), false); },
    async get(collection, ownerId, id) {
      if (!OWNER.test(ownerId)) return null;
      const doc = read(path(collection, ownerId, id));
      return doc && doc.ownerId === ownerId && doc._id === id ? doc : null;
    },
    async list(collection, ownerId, filter = {}, options) {
      if (!OWNER.test(ownerId)) return [];
      const directory = path(collection, ownerId);
      if (!existsSync(directory)) return [];
      const docs = readdirSync(directory).filter(name => name.endsWith(".json")).map(name => read(resolve(directory, name))).filter((doc): doc is StoredDoc => !!doc && doc.ownerId === ownerId && matches(doc, filter));
      return sortAndLimit(docs, options);
    },
    async ping() { return { ok: true, latencyMs: 0, detail: "file repository (single-host development fallback)" }; },
  };
}

// ---------------------------------------------------------------------------
// MongoDB

const ownerProp = { bsonType: "string", pattern: "^[a-zA-Z0-9_-]{1,64}$" };
const str = { bsonType: "string" };
const intish = { bsonType: ["int", "long", "double"] };
const objectProp = { bsonType: "object" };
const dateProp = { bsonType: "date" };
const schema = (required: string[], properties: Record<string, unknown>) => ({
  $jsonSchema: { bsonType: "object", required: ["_id", "ownerId", ...required], properties: { _id: str, ownerId: ownerProp, ...properties } },
});

/** Collection validators (applied when the collection is created by this migration). */
export const MONGO_VALIDATORS: Record<CollectionKey, Document> = {
  profiles: schema(["profileId", "latestRevisionNumber", "latestRevisionId", "updatedAt"], { profileId: str, latestRevisionNumber: intish, latestRevisionId: str, updatedAt: str }),
  profileRevisions: schema(["profileId", "revisionId", "revisionNumber", "revision", "contentHash", "storedAt"], { profileId: str, revisionId: str, revisionNumber: intish, revision: objectProp, contentHash: str, storedAt: dateProp }),
  runs: schema(["runId", "status", "executionMode", "record", "updatedAt"], { runId: str, status: { enum: ["queued", "running", "completed", "completed_with_gaps", "failed", "cancelled"] }, executionMode: { enum: ["live", "scripted"] }, record: objectProp, updatedAt: str }),
  runEvents: schema(["runId", "seq", "event", "contentHash", "storedAt"], { runId: str, seq: intish, event: objectProp, contentHash: str, storedAt: dateProp }),
  assessments: schema(["runId", "candidateId", "position", "assessed", "contentHash"], { runId: str, candidateId: str, position: intish, assessed: objectProp, contentHash: str }),
  evidence: schema(["runId", "candidateId", "snapshot", "sourceMode", "contentHash", "storedAt"], { runId: str, candidateId: str, snapshot: objectProp, sourceMode: { enum: ["live", "synthetic", "agent", "brief"] }, contentHash: str, storedAt: dateProp }),
  scenarios: schema(["briefId", "runId", "candidateId", "inputs", "results", "contentHash"], { briefId: str, runId: str, candidateId: str, inputs: objectProp, results: objectProp, contentHash: str }),
  briefs: schema(["briefId", "brief", "contentHash", "createdAt", "provenance", "runVerified"], { briefId: str, brief: objectProp, contentHash: str, createdAt: str, provenance: { enum: ["app", "browser_import"] }, runVerified: { bsonType: "bool" } }),
};

/** Indexes created by migration `expansion-mongo-v1` (idempotent). */
export const MONGO_INDEXES: Record<CollectionKey, { key: Record<string, 1 | -1>; name: string; unique?: boolean; expireAfterSeconds?: number }[]> = {
  profiles: [{ key: { ownerId: 1, updatedAt: -1 }, name: "owner_updated" }],
  profileRevisions: [
    { key: { ownerId: 1, profileId: 1, revisionNumber: 1 }, name: "owner_profile_revision", unique: true },
    { key: { ownerId: 1, revisionId: 1 }, name: "owner_revision_id" },
  ],
  runs: [
    { key: { ownerId: 1, createdAt: -1 }, name: "owner_created" },
    { key: { ownerId: 1, requirementsHash: 1, status: 1 }, name: "owner_hash_status" },
  ],
  runEvents: [
    { key: { ownerId: 1, runId: 1, seq: 1 }, name: "owner_run_seq", unique: true },
    { key: { storedAt: 1 }, name: "retention_ttl", expireAfterSeconds: EVENT_RETENTION_S },
  ],
  assessments: [{ key: { ownerId: 1, runId: 1, position: 1 }, name: "owner_run_position", unique: true }],
  evidence: [{ key: { ownerId: 1, runId: 1, candidateId: 1, storedAt: -1 }, name: "owner_run_candidate_time" }],
  scenarios: [{ key: { ownerId: 1, briefId: 1, candidateId: 1 }, name: "owner_brief_candidate", unique: true }],
  briefs: [{ key: { ownerId: 1, createdAt: -1 }, name: "owner_created" }],
};

export type MigrationReport = { migrationId: string; database: string; created: string[]; existing: string[]; validatorsApplied: string[]; indexes: number };

/** Create Expansion collections (with validators) and indexes. Safe to re-run. */
export async function migrateMongo(db: Db): Promise<MigrationReport> {
  const present = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(item => item.name));
  const report: MigrationReport = { migrationId: MIGRATION_ID, database: db.databaseName, created: [], existing: [], validatorsApplied: [], indexes: 0 };
  for (const key of Object.keys(COLLECTIONS) as CollectionKey[]) {
    const name = COLLECTIONS[key];
    if (present.has(name)) report.existing.push(name);
    else {
      await db.createCollection(name, { validator: MONGO_VALIDATORS[key], validationLevel: "strict", validationAction: "error" });
      report.created.push(name);
      report.validatorsApplied.push(name);
    }
    for (const index of MONGO_INDEXES[key]) {
      // The driver serializes undefined as BSON null; MongoDB requires a boolean.
      await db.collection(name).createIndex(index.key, { name: index.name, unique: index.unique ?? false, ...(index.expireAfterSeconds ? { expireAfterSeconds: index.expireAfterSeconds } : {}) });
      report.indexes += 1;
    }
  }
  await db.collection(MIGRATIONS_COLLECTION).updateOne(
    { _id: MIGRATION_ID as never },
    { $set: { appliedAt: new Date(), collections: Object.values(COLLECTIONS), indexes: report.indexes }, $setOnInsert: { firstAppliedAt: new Date() } },
    { upsert: true },
  );
  return report;
}

export function mongoDatabaseName(): string {
  const name = process.env.EXPANSION_MONGODB_DB || process.env.MONGODB_DB || "restaurantos";
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new PersistenceError("persistence_unavailable", "The configured MongoDB database name is invalid.");
  return name;
}

export function createMongoRepository(getDatabase: () => Promise<Db>): ExpansionRepository {
  let ready: Promise<Db> | null = null;
  let failedUntil = 0;
  const database = async () => {
    if (Date.now() < failedUntil) throw new PersistenceError("persistence_unavailable", "MongoDB is unreachable (retrying shortly). Nothing was changed.");
    ready ??= getDatabase().then(async db => { await migrateMongo(db); return db; });
    try { return await ready; } catch {
      ready = null;
      failedUntil = Date.now() + 30_000;
      throw new PersistenceError("persistence_unavailable", "MongoDB is unreachable or rejected the connection. Check MONGODB_URI and that this computer's IP is on the Atlas network access list. Nothing was changed.");
    }
  };
  const guarded = async <T>(work: (db: Db) => Promise<T>): Promise<T> => {
    const db = await database();
    try { return await work(db); } catch (error) {
      if (error instanceof PersistenceError) throw error;
      const code = error && typeof error === "object" && "code" in error ? (error as { code: unknown }).code : null;
      if (code === 121) throw new PersistenceError("invalid", "MongoDB rejected the document (schema validation).");
      throw new PersistenceError("persistence_unavailable", "A MongoDB operation failed; no data was changed. Retry shortly.");
    }
  };
  return {
    mode: "mongodb",
    insertImmutable: (collection, doc) => guarded(async db => {
      assertOwned(doc);
      const target = db.collection<StoredDoc>(COLLECTIONS[collection]);
      try { await target.insertOne(doc); return "inserted"; } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
        const existing = await target.findOne({ _id: doc._id, ownerId: doc.ownerId });
        return existing?.contentHash === doc.contentHash ? "duplicate" : "conflict";
      }
    }),
    upsert: (collection, doc) => guarded(async db => {
      assertOwned(doc);
      await db.collection<StoredDoc>(COLLECTIONS[collection]).replaceOne({ _id: doc._id, ownerId: doc.ownerId }, doc, { upsert: true });
    }),
    get: (collection, ownerId, id) => guarded(async db => (await db.collection<StoredDoc>(COLLECTIONS[collection]).findOne({ _id: id, ownerId })) ?? null),
    list: (collection, ownerId, filter = {}, options = {}) => guarded(async db => {
      const [field, direction] = options.sort ?? ["_id", 1];
      return db.collection<StoredDoc>(COLLECTIONS[collection]).find({ ...filter, ownerId }).sort({ [field]: direction }).limit(Math.min(options.limit ?? 200, 1000)).toArray();
    }),
    async ping() {
      const started = performance.now();
      try {
        const db = await database();
        await db.command({ ping: 1 });
        return { ok: true, latencyMs: Math.round(performance.now() - started), detail: `MongoDB database "${db.databaseName}" reachable; migration ${MIGRATION_ID} applied` };
      } catch (error) {
        return { ok: false, latencyMs: null, detail: error instanceof PersistenceError ? error.message : "MongoDB unreachable." };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Selection

export type PersistenceMode = "mongodb" | "file" | "off";
export function persistenceMode(env: NodeJS.ProcessEnv = process.env): PersistenceMode {
  const requested = env.EXPANSION_PERSISTENCE;
  if (requested === "mongodb" || requested === "file" || requested === "off") return requested;
  if (env.MONGODB_URI) return "mongodb";
  return env.NODE_ENV === "production" ? "off" : "file";
}

const registry = globalThis as typeof globalThis & { __expansionRepository?: ExpansionRepository | null; __expansionRepositoryOverride?: ExpansionRepository };

/** Test hook: install a repository (pass undefined to clear). */
export function setRepositoryForTests(repository: ExpansionRepository | undefined) {
  registry.__expansionRepositoryOverride = repository;
  registry.__expansionRepository = undefined;
}

export async function getRepository(): Promise<ExpansionRepository | null> {
  if (registry.__expansionRepositoryOverride) return registry.__expansionRepositoryOverride;
  if (registry.__expansionRepository !== undefined) return registry.__expansionRepository;
  const mode = persistenceMode();
  if (mode === "off") return (registry.__expansionRepository = null);
  if (mode === "file") {
    return (registry.__expansionRepository = createFileRepository(resolve(process.cwd(), process.env.EXPANSION_STORE_DIR ?? "src/features/expansion/data/data/store")));
  }
  const { getDb } = await import("../../../lib/mongodb.ts");
  return (registry.__expansionRepository = createMongoRepository(() => getDb(mongoDatabaseName())));
}

export async function requireRepository(): Promise<ExpansionRepository> {
  const repository = await getRepository();
  if (!repository) throw new PersistenceError("persistence_unavailable", "Account storage is not configured on this server (set MONGODB_URI, or EXPANSION_PERSISTENCE=file for single-host development). Nothing was changed.");
  return repository;
}
