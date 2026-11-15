/**
 * Recover stale agent runs after a host or worker restart.
 *
 *   npm run expansion:recover
 *
 * Scans EXPANSION_AGENT_RUNS_DIR (default src/features/expansion/data/data/runs)
 * and marks every queued/running run whose worker exited, never started or
 * stalled as `failed` with an actionable code (completed artifacts are kept,
 * a cancel flag stops any zombie worker). Terminal runs are never modified.
 * The readiness endpoint (`/api/expansion/health?ready=1`) runs the same sweep.
 */
import { recoverStaleAgentRuns } from "./agent.ts";

if (process.argv.includes("--help")) {
  console.log("Recover stale Expansion agent runs (worker exited / never started / stalled).\nUsage: npm run expansion:recover");
} else {
  console.log(JSON.stringify({ ok: true, ...recoverStaleAgentRuns({}) }));
}
