/**
 * Standalone Atlas connectivity check. Run with: npm run db:check
 * Required env: MONGODB_URI (.env or .env.local). Prints JSON only;
 * never prints the URI or credentials.
 */
import type { MongoClient } from "mongodb";
import { checkMongoConnection, getMongoClient } from "./mongodb.ts";

if (process.argv.includes("--help")) {
  console.log(
    "Verify the MongoDB Atlas connection from MONGODB_URI (.env / .env.local) and print a JSON result.\nUsage: npm run db:check"
  );
} else {
  let client: MongoClient | null = null;
  try {
    client = await getMongoClient();
    console.log(JSON.stringify(await checkMongoConnection(), null, 2));
  } catch (error) {
    console.error(
      error instanceof Error ? `MongoDB check failed: ${error.message}` : "MongoDB check failed"
    );
    process.exitCode = 1;
  } finally {
    // Release sockets so the script process can exit.
    if (client) {
      await client.close().catch(() => {});
    }
  }
}
