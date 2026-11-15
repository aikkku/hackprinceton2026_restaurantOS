import { existsSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

/**
 * Spawns the isolated Python Deep Agents worker for one run.
 *
 * The worker is a detached per-run process: stdio is ignored (its durable
 * output is the run directory: events.jsonl, artifacts and run.json), so no
 * pipes are shared and the run outlives a request. Environment names are
 * documented in the ledger; values (bridge URL, run token) are injected at
 * spawn time and never logged.
 */

export type WorkerMode = "live" | "scripted" | "offline";

export const workerMainDir = () =>
  resolve(/* turbopackIgnore: true */ process.cwd(), "src/features/expansion/agent/worker");

export const defaultScriptFile = () =>
  resolve(workerMainDir(), "fixtures", "cedar-kitchen-run.script.json");

export function resolveWorkerPython(): string {
  const configured = process.env.EXPANSION_AGENT_PYTHON;
  if (configured) return configured;
  // The Python environment is provisioned on the host, not bundled into the
  // Next.js app. Tracing its absolute interpreter symlink breaks Turbopack.
  const venv = resolve(
    /* turbopackIgnore: true */ workerMainDir(),
    "..",
    process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python",
  );
  if (existsSync(venv)) return venv;
  return "python";
}

export class WorkerSpawnError extends Error {
  code: "worker_spawn_failed";
  constructor(message: string) {
    super(message);
    this.name = "WorkerSpawnError";
    this.code = "worker_spawn_failed";
  }
}

export type SpawnWorkerInput = {
  runDir: string;
  runId: string;
  sessionId: string;
  token: string;
  bridgeUrl: string;
  mode: WorkerMode;
  scriptPath?: string;
  pythonPath?: string;
};

export function spawnWorker(input: SpawnWorkerInput): { pid: number | undefined } {
  const python = input.pythonPath ?? resolveWorkerPython();
  // `-m` keeps restaurantos_worker a real package (relative imports work);
  // the working directory is the worker package root.
  const args = [
    "-m",
    "restaurantos_worker.cli",
    "run",
    "--run-dir",
    input.runDir,
  ];
  const env = {
    ...process.env,
    EXPANSION_AGENT_RUN_TOKEN: input.token,
    EXPANSION_AGENT_BRIDGE_URL: input.bridgeUrl,
    EXPANSION_AGENT_MODEL: input.mode,
    ...(input.scriptPath ? { EXPANSION_AGENT_SCRIPT: input.scriptPath } : {}),
  };
  let child;
  try {
    const spawnOptions: import("node:child_process").SpawnOptions = {
      cwd: workerMainDir(),
      env,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    };
    const logPath = process.env.EXPANSION_AGENT_WORKER_LOG;
    if (logPath) {
      const fd = openSync(logPath, "a");
      spawnOptions.stdio = ["ignore", fd, fd];
    }
    child = spawn(python, args, spawnOptions);
  } catch (error) {
    throw new WorkerSpawnError(
      `The Deep Agents worker could not be started (${error instanceof Error ? error.message : "unknown spawn error"}).`,
    );
  }
  child.on("error", () => {
    // The run record is marked failed by the stale-run recovery when the
    // worker never reports progress; this handler only prevents crashes.
  });
  child.unref();
  return { pid: child.pid };
}

export function agentModeFromEnv(requested: "live" | "scripted"): WorkerMode {
  const e2eForceOffline = process.env.EXPANSION_AGENT_E2E_FORCE_OFFLINE === "1";
  if (requested === "scripted") return "scripted";
  if (e2eForceOffline) return "offline";
  return "live";
}

export function defaultAgentMode(): "live" | "scripted" {
  return process.env.EXPANSION_AGENT_DEFAULT_MODE === "scripted" ? "scripted" : "live";
}

export function providerConfigured(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_API_KEY,
  );
}
