import { readFile, writeFile } from "node:fs/promises";
import { datasetSchema } from "../domain/dataset.ts";
import { mongoDatasets } from "./mongodb.ts";

const command = process.argv[2] ?? "validate";
const file = process.argv[3];
try {
  const raw = JSON.parse(await readFile(file ?? new URL("../frontend/data/demo-restaurant.json", import.meta.url), "utf8"));
  const dataset = datasetSchema.parse(raw);
  if (Buffer.byteLength(JSON.stringify({ expectedRevision: 0, dataset })) > 1_048_576) throw new Error("Dataset exceeds API size limit");
  if (command === "validate") console.log(`Valid mock dataset: ${dataset.profile.id}; ${dataset.operations.transactions.length} ledger records.`);
  else if (command === "export") {
    await writeFile("/tmp/restaurantos-dataset-upload.json", JSON.stringify({ expectedRevision: 0, dataset }, null, 2));
    console.log("Created /tmp/restaurantos-dataset-upload.json for the authenticated upload API.");
  } else if (command === "seed") {
    const saved = await mongoDatasets.save(dataset, 0);
    if (saved) console.log(`Created ${saved._id}, revision ${saved.revision}. Mock data only.`);
    else console.log("Dataset already exists; seed preserved it. Use the API with its current revision to update.");
  } else throw new Error("Use validate, export or seed");
} catch {
  console.error("Dataset operation failed. Check fixture validation, MongoDB environment and Atlas access. Credentials are not logged.");
  process.exitCode = 1;
} finally {
  const state = globalThis as typeof globalThis & { tacticalMongo?: { promise: Promise<import("mongodb").MongoClient> } };
  if (state.tacticalMongo) await state.tacticalMongo.promise.then(client => client.close()).catch(() => undefined);
}
