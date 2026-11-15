/**
 * Expansion MongoDB migration `expansion-mongo-v1` (idempotent, additive).
 *
 *   npm run expansion:db:migrate
 *
 * Creates the Expansion-owned `expansion_*` collections (with $jsonSchema
 * validators when the collection is new), their indexes, and an
 * `expansion_migrations` record in MONGODB_DB (default "restaurantos").
 * Never touches another feature's collections. Prints JSON only; never prints
 * the connection string or credentials. Re-running is safe.
 */
import type { MongoClient } from "mongodb";
import { getDb, getMongoClient } from "../../../lib/mongodb.ts";
import { migrateMongo, mongoDatabaseName } from "./store.ts";

if (process.argv.includes("--help")) {
  console.log("Apply the Expansion MongoDB collections/validators/indexes (migration expansion-mongo-v1).\nUsage: npm run expansion:db:migrate");
} else {
  let client: MongoClient | null = null;
  try {
    client = await getMongoClient();
    const report = await migrateMongo(await getDb(mongoDatabaseName()));
    console.log(JSON.stringify({ ok: true, ...report }, null, 2));
  } catch (error) {
    // The driver error text can include host names; keep only its class/code.
    const raw = error && typeof error === "object" && "code" in error ? (error as { code: unknown }).code : undefined;
    const code = raw === undefined || raw === null ? null : String(raw);
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.name : "Error", code, hint: "Check MONGODB_URI/MONGODB_DB and that this host is on the database network access list." }));
    process.exitCode = 1;
  } finally {
    if (client) await client.close().catch(() => {});
  }
}
