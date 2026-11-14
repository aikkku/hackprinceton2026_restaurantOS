import { importLocalDataset } from "./local-dataset.ts";

if(process.argv.includes("--help")) {
  console.log("Import/rebuild Expansion local cache. Required env: EXPANSION_COSTAR_ROOT (extracted kit), EXPANSION_DB_PATH (dedicated .sqlite cache). Optional: EXPANSION_DATASET_ID, EXPANSION_DATASET_DATE (documented YYYY-MM-DD). Streams source JSONL/JSON and atomically rebuilds; prints aggregate counts only. Node >=22.18. Use node --env-file-if-exists=.env.local src/features/expansion/backend/import-local.ts");
} else {
  try {console.log(JSON.stringify(await importLocalDataset(),null,2));}
  catch(error) {console.error(error instanceof Error?error.message:"Local import failed");process.exitCode=1;}
}
