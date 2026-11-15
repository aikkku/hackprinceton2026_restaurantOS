/** Bounded live source proof. No private records, image bytes or credentials printed.
 * node --env-file-if-exists=.env --env-file-if-exists=.env.local src/features/expansion/backend/investigation-proof.ts
 */
import { openDatabase } from "./local-dataset.ts";
import { searchOfferedSpaces } from "./candidate-search.ts";
import { collectCandidateSources } from "./investigation-sources.ts";
import { resolve } from "node:path";

const database = openDatabase({ dbPath: process.env.EXPANSION_DB_PATH ?? resolve("src/features/expansion/data/data/expansion.sqlite") });
try {
  const search = await searchOfferedSpaces(database, "houston");
  const candidate = search.candidates.find(x => x.latitude !== null && x.longitude !== null);
  if (!candidate) throw new Error("No sourced candidate available for bounded proof.");
  process.env.EXPANSION_VEXCEL_DISPLAY = "1";
  const snapshot = await collectCandidateSources(candidate, { currentAddress: null, priceLevel: null }, { network: true });
  console.log(JSON.stringify({ timestamp: snapshot.refreshedAt, localSearch: search.counts, providers: snapshot.statuses,
    supported: snapshot.observations.map(x => ({ provider: x.provider, scope: x.scope, sourceDateKnown: x.sourceDate !== null, facts: x.facts.length, viewerPermitted: x.viewerUrl !== null })),
    gaps: snapshot.gaps, note: "One authorized local candidate; no private payloads logged. Verified source access does not verify hard requirements." }, null, 2));
} finally { database.close(); }
