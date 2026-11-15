import { localResponse } from "../../../../features/expansion/backend/http.ts";
import { agentCapabilities, recoverStaleAgentRuns } from "../../../../features/expansion/backend/agent.ts";
import { getRepository, persistenceMode } from "../../../../features/expansion/backend/store.ts";
import { openDatabase } from "../../../../features/expansion/backend/local-dataset.ts";
import { accessCodeRequired, sessionSecret } from "../../../../features/expansion/backend/owner.ts";

export const dynamic = "force-dynamic";

/**
 * Liveness: `GET /api/expansion/health` → 200 while the server responds.
 * Readiness: `GET /api/expansion/health?ready=1` → 200 only when owner
 * sessions, durable storage, the worker runtime, the dataset and the run
 * store are usable; otherwise 503 with per-check reasons. Never returns
 * secret values or filesystem paths. Readiness also sweeps stale runs so a
 * restart cannot leave permanent fake "running" runs.
 */
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("ready") !== "1") {
    return localResponse({ status: "ok", checkedAt: new Date().toISOString() });
  }
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  try {
    sessionSecret();
    checks.sessions = { ok: true, detail: accessCodeRequired() ? "signed owner cookies; access code required" : "signed owner cookies; anonymous device-bound owners" };
  } catch (error) {
    checks.sessions = { ok: false, detail: error instanceof Error ? error.message : "owner sessions unavailable" };
  }

  const repo = await getRepository().catch(() => null);
  if (!repo) checks.storage = { ok: false, detail: `durable storage is "${persistenceMode()}": set MONGODB_URI (or EXPANSION_PERSISTENCE=file for single-host development)` };
  else {
    const ping = await repo.ping();
    checks.storage = { ok: ping.ok, detail: `${repo.mode}: ${ping.detail}` };
  }

  const capabilities = agentCapabilities({});
  checks.worker = { ok: capabilities.workerReady, detail: capabilities.workerReady ? "Python Deep Agents worker runtime found" : (capabilities.reason ?? "worker runtime missing") };
  // Informational: a configured key is not proof that the provider works.
  checks.model = { ok: true, detail: capabilities.modelConfigured ? "a live model provider key is configured (not proven by this check)" : "no live model provider key: live runs fail honestly; deterministic search stays available" };

  try {
    openDatabase().close();
    checks.dataset = { ok: true, detail: "local dataset cache (expansion-local-v2) opened read-only" };
  } catch (error) {
    checks.dataset = { ok: false, detail: error instanceof Error ? error.message : "dataset unavailable: set EXPANSION_DB_PATH and run npm run expansion:import" };
  }

  try {
    const recovery = recoverStaleAgentRuns({});
    checks.runs = { ok: true, detail: `${recovery.scanned} agent runs scanned, ${recovery.recovered} recovered as failed, ${recovery.active} active` };
  } catch {
    checks.runs = { ok: false, detail: "run directory unreadable: check EXPANSION_AGENT_RUNS_DIR permissions" };
  }

  const ok = ["sessions", "storage", "worker", "dataset", "runs"].every((name) => checks[name]?.ok);
  return localResponse({ status: ok ? "ready" : "not_ready", checks, checkedAt: new Date().toISOString() }, ok ? 200 : 503);
}
