/**
 * Shared MongoDB Atlas connection helper (server-only).
 *
 * Reads MONGODB_URI from the environment (see .env / .env.local). The URI
 * embeds the credentials, so it must never be prefixed with NEXT_PUBLIC_
 * and must never be imported from a client component.
 *
 * This is connection infrastructure, not a data adapter. Features that read
 * business data through MongoDB should still follow the repo adapter rule:
 * a provider interface plus a clearly labeled demo-data fallback.
 */
import { z } from "zod";
import { MongoClient, type Db } from "mongodb";

// Fail fast if this module ever ends up in a client bundle.
if (typeof window !== "undefined") {
  throw new Error("src/lib/mongodb.ts is server-only and must not be imported from client code.");
}

const mongoEnvSchema = z.object({
  MONGODB_URI: z
    .string()
    .min(1, "is missing; add it to .env or .env.local")
    .regex(/^mongodb(\+srv)?:\/\//, "must start with mongodb:// or mongodb+srv://"),
});

export type MongoEnv = z.infer<typeof mongoEnvSchema>;

/**
 * Validates the MongoDB environment. Throws with every schema problem listed
 * (without ever echoing the URI) so misconfiguration is visible at the call site.
 */
export function parseMongoEnv(env: Partial<NodeJS.ProcessEnv> = process.env): MongoEnv {
  const parsed = mongoEnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid MongoDB environment: ${problems}`);
  }
  return parsed.data;
}

const globalForMongo = globalThis as unknown as {
  __mongoClientPromise?: Promise<MongoClient>;
};

function connectMongo(): Promise<MongoClient> {
  const { MONGODB_URI } = parseMongoEnv();
  const client = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    appName: "restaurant-os",
  });
  return client.connect().catch((error) => {
    // Never cache a rejected client: a transient network error or a later
    // .env fix would otherwise stay broken for the lifetime of the process.
    globalForMongo.__mongoClientPromise = undefined;
    throw error;
  });
}

/** Shared MongoClient singleton (cached across dev hot reloads via globalThis). */
export function getMongoClient(): Promise<MongoClient> {
  globalForMongo.__mongoClientPromise ??= connectMongo();
  return globalForMongo.__mongoClientPromise;
}

/** The connected client's database for a named database. */
export async function getDb(dbName: string): Promise<Db> {
  if (!dbName.trim()) {
    throw new Error("getDb requires a non-empty database name.");
  }
  const client = await getMongoClient();
  return client.db(dbName);
}

export type MongoConnectionCheck = {
  ok: true;
  latencyMs: number;
  serverVersion: string;
};

/** Pings the Atlas deployment and returns proof-of-connectivity details. */
export async function checkMongoConnection(): Promise<MongoConnectionCheck> {
  const client = await getMongoClient();
  const admin = client.db("admin");
  const startedAt = performance.now();
  await admin.command({ ping: 1 });
  const latencyMs = Math.round(performance.now() - startedAt);
  const buildInfo = await admin.admin().buildInfo();
  return { ok: true, latencyMs, serverVersion: buildInfo.version };
}
