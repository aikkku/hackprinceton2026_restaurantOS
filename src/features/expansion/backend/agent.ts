import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import {
  agentCapabilitiesSchema,
  agentEventSchema,
  agentRunRecordSchema,
  agentRunRequestFileSchema,
  financeArtifactSchema,
  inspectionArtifactSchema,
  inspectionToolOutputSchema,
  marketArtifactSchema,
  marketToolOutputSchema,
  profileArtifactSchema,
  readinessToolOutputSchema,
  scoutToolOutputSchema,
  searchArtifactSchema,
  summaryArtifactSchema,
  AGENT_ARTIFACT_VERSION,
  AGENT_RUN_VERSION,
  type AgentArtifactName,
  type AgentEvent,
  type AgentRunRecord,
  type ExecutionMode,
  type ProfileArtifact,
} from "../domain/agent.ts";
import { intakeSchema, type RestaurantIntake } from "../domain/intake.ts";
import { normalizeRequirements } from "../domain/requirements.ts";
import {
  assessCandidates,
  factSchema,
  MATCHING_MODEL_VERSION,
  serviceInclusion,
  type CandidateFact,
} from "../domain/matching.ts";
import { financeInputsFromBaseline } from "../domain/scenario.ts";
import { sourceSnapshotSchema, type SourceSnapshot } from "../domain/evidence.ts";
import type { SpaceCandidate } from "../domain/matching.ts";
import { collectCandidateSources } from "./investigation-sources.ts";
import { invokeTool } from "../domain/tools.ts";
import { requirementsHashOf, RunError } from "./runs.ts";
import {
  openDatabase,
  type LocalConfig,
} from "./local-dataset.ts";
import {
  metadataFor,
  searchOfferedSpaces,
  SEARCH_MODEL_VERSION,
} from "./candidate-search.ts";
import {
  agentModeFromEnv,
  defaultAgentMode,
  defaultScriptFile,
  providerConfigured,
  resolveWorkerPython,
  spawnWorker,
  WorkerSpawnError,
} from "./worker.ts";

/**
 * Deep Agents run service (Rain-owned backend).
 *
 * One agent run = one run-scoped directory under the session directory:
 * request.json + profile.json (server-written, validated), run.json +
 * events.jsonl (worker-owned, worker-written), market.json/candidates.json/
 * inspection.json (server-written by the tool bridge), finance.json/
 * summary.json (worker-assembled from validated tool outputs). The worker
 * is a detached per-run process that talks back over the authenticated
 * tool bridge; terminal runs are immutable and stale running runs recover
 * as failed, exactly like Phase 2 runs.
 */

export const AGENT_RUN_STALE_MS = 5 * 60 * 1000;
export const INSPECT_MAX_CANDIDATES = 20;
export const SCOUT_TOP_CANDIDATES = 100;
/**
 * Excluded rows the model sees from scout.search_city. The full list stays in
 * candidates.json; the model already gets exact exclusion counts by reason.
 * On the real Houston snapshot the full list is ~2,200 rows (~135k tokens),
 * which made live Gemini calls time out (504 DEADLINE_EXCEEDED).
 */
export const SCOUT_EXCLUDED_SAMPLE = 20;

export type AgentServiceConfig = {
  db?: LocalConfig;
  runsDir: string;
  bridgeBaseUrl?: string;
  pythonPath?: string;
  defaultMode?: ExecutionMode;
  /** Test hook: false skips spawning the detached worker. */
  spawn?: boolean;
  scriptPath?: string;
};

export const defaultAgentRunsDir = () =>
  resolve(
    process.cwd(),
    process.env.EXPANSION_AGENT_RUNS_DIR ??
      process.env.EXPANSION_RUNS_DIR ??
      "src/features/expansion/data/data/runs",
  );

function serviceConfig(config: Partial<AgentServiceConfig>): AgentServiceConfig {
  return {
    db: config.db,
    runsDir: resolve(config.runsDir ?? defaultAgentRunsDir()),
    bridgeBaseUrl: config.bridgeBaseUrl ?? process.env.EXPANSION_AGENT_BRIDGE_URL ?? "http://127.0.0.1:3000",
    pythonPath: config.pythonPath ?? resolveWorkerPython(),
    defaultMode: config.defaultMode ?? defaultAgentMode(),
    spawn: config.spawn ?? true,
    scriptPath: config.scriptPath,
  };
}

function sessionDir(config: AgentServiceConfig, sessionId: string) {
  return resolve(config.runsDir, sessionId);
}
function runDir(config: AgentServiceConfig, sessionId: string, runId: string) {
  return resolve(sessionDir(config, sessionId), `agent-${runId}`);
}
function artifactPath(config: AgentServiceConfig, sessionId: string, runId: string, name: string) {
  return resolve(runDir(config, sessionId, runId), name);
}

function atomicWrite(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  if (existsSync(temporary)) rmSync(temporary);
  writeFileSync(temporary, content);
  // Windows: a concurrent reader (SSE/status polls) can hold the destination
  // for a moment; retry the rename within a short bounded window.
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(temporary, path);
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : "";
      if (!["EPERM", "EACCES", "EBUSY"].includes(String(code)) || attempt >= 10) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1));
    }
  }
}

function stableHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return `${Math.abs(hash).toString(36)}-${value.length.toString(36)}`;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readRunFile(config: AgentServiceConfig, sessionId: string, runId: string): AgentRunRecord {
  const path = artifactPath(config, sessionId, runId, "run.json");
  if (!existsSync(path)) throw new RunError("not_found", "This agent run does not exist in the current session.");
  let record: AgentRunRecord;
  try {
    record = agentRunRecordSchema.parse(readJson(path));
  } catch {
    throw new RunError("invalid_run", "The stored agent run is unreadable.");
  }
  return record;
}

function writeRunFile(config: AgentServiceConfig, record: AgentRunRecord) {
  atomicWrite(artifactPath(config, record.sessionId, record.runId, "run.json"), JSON.stringify(record));
}

function cancelledFlag(config: AgentServiceConfig, sessionId: string, runId: string) {
  return artifactPath(config, sessionId, runId, "run.cancel");
}

function emptyStages(): AgentRunRecord["stages"] {
  return {
    readiness: "not_run",
    market: "not_run",
    site_scout: "not_run",
    space_inspector: "not_run",
    finance: "not_run",
  };
}

function initialRunRecord(input: {
  runId: string;
  sessionId: string;
  cityId: string;
  executionMode: ExecutionMode;
  revisionId: string;
  revisionNumber: number;
  requirementsHash: string;
}): AgentRunRecord {
  const now = new Date().toISOString();
  return agentRunRecordSchema.parse({
    version: AGENT_RUN_VERSION,
    runId: input.runId,
    sessionId: input.sessionId,
    status: "queued",
    executionMode: input.executionMode,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    cancelledAt: null,
    cityId: input.cityId,
    datasetId: null,
    datasetDate: null,
    profile: { revisionId: input.revisionId, revisionNumber: input.revisionNumber },
    requirementsHash: input.requirementsHash,
    model: null,
    toolCalls: {},
    stages: emptyStages(),
    error: null,
  });
}

export type CreateAgentRunInput = {
  runId: string;
  sessionId: string;
  cityId: string;
  intake: RestaurantIntake;
  revisionId: string;
  revisionNumber: number;
  facts?: CandidateFact[];
  executionMode?: ExecutionMode;
};

/** Canonical requirements hash + execution mode (idempotency and duplicate detection). */
export function agentRequestHash(
  rawConfig: Partial<AgentServiceConfig>,
  input: Omit<CreateAgentRunInput, "runId" | "sessionId">,
): string {
  const config = serviceConfig(rawConfig);
  const mode = input.executionMode ?? config.defaultMode ?? "live";
  const facts = z.array(factSchema).parse(input.facts ?? []);
  const baseHash = requirementsHashOf({
    intake: intakeSchema.parse(input.intake),
    revisionId: input.revisionId,
    revisionNumber: input.revisionNumber,
    cityId: input.cityId,
    facts,
  });
  return stableHash(`${baseHash}~${mode}`);
}

/**
 * Create (idempotently) an agent run and spawn the detached Python worker.
 * The same run id with the same requirement hash + mode returns the existing
 * run; a different payload conflicts. Terminal runs never change status.
 */
export async function createAgentRun(
  rawConfig: Partial<AgentServiceConfig>,
  input: CreateAgentRunInput,
): Promise<{ record: AgentRunRecord; created: boolean }> {
  const config = serviceConfig(rawConfig);
  const mode = input.executionMode ?? config.defaultMode ?? "live";
  const parsedIntake = intakeSchema.parse(input.intake);
  const requirements = normalizeRequirements(parsedIntake, {
    revisionId: input.revisionId,
    revisionNumber: input.revisionNumber,
    createdAt: new Date().toISOString(),
  });
  const hash = agentRequestHash(config, input);

  const existingPath = artifactPath(config, input.sessionId, input.runId, "run.json");
  if (existsSync(existingPath)) {
    const existing = readRunFile(config, input.sessionId, input.runId);
    if (existing.requirementsHash === hash) return { record: existing, created: false };
    throw new RunError(
      "conflict",
      "This agent run id already exists with different requirements in the current session.",
    );
  }

  const profile: ProfileArtifact = profileArtifactSchema.parse({
    artifactVersion: AGENT_ARTIFACT_VERSION,
    modelVersion: "expansion-requirements-v1",
    intakeSchemaVersion: "1.0",
    revisionId: input.revisionId,
    revisionNumber: input.revisionNumber,
    cityId: input.cityId,
    intake: parsedIntake,
    requirements,
    followUpQuestions: parsedIntake.followUpQuestions,
    financeInputs: financeInputsFromBaseline(parsedIntake.financialBaseline),
  });

  const directory = runDir(config, input.sessionId, input.runId);
  mkdirSync(directory, { recursive: true });
  atomicWrite(
    artifactPath(config, input.sessionId, input.runId, "request.json"),
    JSON.stringify(agentRunRequestFileSchema.parse({
      requestVersion: AGENT_RUN_VERSION,
      runId: input.runId,
      sessionId: input.sessionId,
      cityId: input.cityId,
      executionMode: mode,
      createdAt: new Date().toISOString(),
      datasetId: null,
      datasetDate: null,
      profile,
    })),
  );
  atomicWrite(
    artifactPath(config, input.sessionId, input.runId, "profile.json"),
    JSON.stringify(profile),
  );
  let record = initialRunRecord({
    runId: input.runId,
    sessionId: input.sessionId,
    cityId: input.cityId,
    executionMode: mode,
    revisionId: input.revisionId,
    revisionNumber: input.revisionNumber,
    requirementsHash: hash,
  });
  writeRunFile(config, record);

  if (config.spawn === false || process.env.EXPANSION_AGENT_SPAWN === "0") {
    return { record, created: true };
  }

  const token = randomBytes(32).toString("hex");
  atomicWrite(
    artifactPath(config, input.sessionId, input.runId, "tool.token.sha256"),
    createHash("sha256").update(token).digest("hex"),
  );
  try {
    spawnWorker({
      runDir: directory,
      runId: input.runId,
      sessionId: input.sessionId,
      token,
      bridgeUrl: config.bridgeBaseUrl ?? "http://127.0.0.1:3000",
      mode: agentModeFromEnv(mode),
      scriptPath:
        config.scriptPath ??
        (mode === "scripted" ? defaultScriptFile() : undefined),
      pythonPath: config.pythonPath ?? resolveWorkerPython(),
    });
  } catch (error) {
    const message = error instanceof WorkerSpawnError || error instanceof Error
      ? error.message
      : "The Deep Agents worker could not be started.";
    record = agentRunRecordSchema.parse({
      ...record,
      status: "failed",
      updatedAt: new Date().toISOString(),
      error: { code: "worker_spawn_failed", message },
    });
    writeRunFile(config, record);
    return { record, created: true };
  }
  return { record, created: true };
}

/** A worker that exited without a terminal write is recovered after this grace. */
export const WORKER_EXIT_GRACE_MS = 30 * 1000;
/** A queued run whose worker never wrote a heartbeat is recovered after this. */
export const WORKER_START_GRACE_MS = 2 * 60 * 1000;
/** Even a live worker process is recovered when it makes no progress this long. */
export const AGENT_RUN_HARD_STALE_MS = 20 * 60 * 1000;

type WorkerHeartbeat = { pid: number | null; updatedAt: number | null; alive: boolean | null };

function workerHeartbeat(config: AgentServiceConfig, sessionId: string, runId: string): WorkerHeartbeat {
  const path = artifactPath(config, sessionId, runId, "run.worker.json");
  if (!existsSync(path)) return { pid: null, updatedAt: null, alive: null };
  try {
    const raw = z.object({ pid: z.number().int().positive(), updatedAt: z.string() }).parse(readJson(path));
    let alive: boolean | null = null;
    try {
      process.kill(raw.pid, 0);
      alive = true;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : "";
      alive = code === "EPERM" ? true : code === "ESRCH" ? false : null;
    }
    const updatedAt = Date.parse(raw.updatedAt);
    return { pid: raw.pid, updatedAt: Number.isFinite(updatedAt) ? updatedAt : null, alive };
  } catch {
    return { pid: null, updatedAt: null, alive: null };
  }
}

/**
 * Decide whether a non-terminal run must be recovered. Recovery is honest:
 * the run becomes `failed` with an actionable code, completed artifacts are
 * kept, and a cancel flag stops any zombie worker at its next tool boundary.
 * The worker itself never overwrites a terminal run.json (orchestrator guard).
 */
export function staleRunReason(
  record: AgentRunRecord,
  heartbeat: WorkerHeartbeat,
  now = Date.now(),
): { code: string; message: string } | null {
  if (record.status !== "running" && record.status !== "queued") return null;
  const lastProgress = Math.max(Date.parse(record.updatedAt), heartbeat.updatedAt ?? 0);
  const idle = now - lastProgress;
  if (heartbeat.alive === false && idle > WORKER_EXIT_GRACE_MS) {
    return {
      code: "worker_exited",
      message: "The Deep Agents worker stopped before finishing (it crashed or the host restarted). Completed stage results are kept; start a new run to retry, or continue with the deterministic search.",
    };
  }
  if (record.status === "queued" && heartbeat.pid === null && now - Date.parse(record.createdAt) > WORKER_START_GRACE_MS && idle > WORKER_START_GRACE_MS) {
    return {
      code: "worker_not_started",
      message: "The Deep Agents worker never started. Check the worker setup (EXPANSION_AGENT_PYTHON / worker venv) and the health endpoint, then start a new run.",
    };
  }
  if (idle > AGENT_RUN_STALE_MS && heartbeat.alive !== true) {
    return {
      code: "interrupted",
      message: "The agent run was interrupted and recovered as failed. Start a new run to retry.",
    };
  }
  if (idle > AGENT_RUN_HARD_STALE_MS) {
    return {
      code: "stalled",
      message: "The agent run made no progress for 20 minutes and was stopped. Start a new run to retry.",
    };
  }
  return null;
}

export function getAgentRun(
  rawConfig: Partial<AgentServiceConfig>,
  sessionId: string,
  runId: string,
): AgentRunRecord {
  const config = serviceConfig(rawConfig);
  const record = readRunFile(config, sessionId, runId);
  const reason = staleRunReason(record, workerHeartbeat(config, sessionId, runId));
  if (reason) {
    const now = new Date().toISOString();
    // Stop a zombie worker at its next tool boundary; the bridge rejects
    // cancelled runs and the worker's terminal guard leaves run.json alone.
    try {
      atomicWrite(cancelledFlag(config, sessionId, runId), JSON.stringify({ requestedAt: now, reason: reason.code }));
    } catch {
      /* best effort */
    }
    const recovered = agentRunRecordSchema.parse({
      ...record,
      status: "failed",
      updatedAt: now,
      error: reason,
    });
    writeRunFile(config, recovered);
    return recovered;
  }
  return record;
}

/** Find a non-terminal run of the same owner with the same requirements hash and mode. */
export function findActiveAgentRun(
  rawConfig: Partial<AgentServiceConfig>,
  sessionId: string,
  input: Omit<CreateAgentRunInput, "runId" | "sessionId">,
): AgentRunRecord | null {
  const config = serviceConfig(rawConfig);
  const hash = agentRequestHash(config, input);
  const directory = sessionDir(config, sessionId);
  if (!existsSync(directory)) return null;
  for (const entry of readdirSync(directory)) {
    if (!entry.startsWith("agent-")) continue;
    const runId = entry.slice("agent-".length);
    try {
      const record = getAgentRun(config, sessionId, runId);
      if (record.requirementsHash === hash && (record.status === "queued" || record.status === "running")) return record;
    } catch {
      /* unreadable runs never block a new submission */
    }
  }
  return null;
}

/** List an owner's agent runs (newest first), recovering stale ones on read. */
export function listAgentRuns(rawConfig: Partial<AgentServiceConfig>, sessionId: string, limit = 50): AgentRunRecord[] {
  const config = serviceConfig(rawConfig);
  const directory = sessionDir(config, sessionId);
  if (!existsSync(directory)) return [];
  const records: AgentRunRecord[] = [];
  for (const entry of readdirSync(directory)) {
    if (!entry.startsWith("agent-")) continue;
    try {
      records.push(getAgentRun(config, sessionId, entry.slice("agent-".length)));
    } catch {
      /* skip unreadable */
    }
  }
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

/** Startup/readiness sweep: recover every stale run across owners. */
export function recoverStaleAgentRuns(rawConfig: Partial<AgentServiceConfig> = {}): { scanned: number; recovered: number; active: number } {
  const config = serviceConfig(rawConfig);
  const result = { scanned: 0, recovered: 0, active: 0 };
  if (!existsSync(config.runsDir)) return result;
  for (const owner of readdirSync(config.runsDir)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(owner)) continue;
    const directory = sessionDir(config, owner);
    let entries: string[] = [];
    try { entries = readdirSync(directory); } catch { continue; }
    for (const entry of entries) {
      if (!entry.startsWith("agent-")) continue;
      const runId = entry.slice("agent-".length);
      try {
        const before = readRunFile(config, owner, runId);
        if (before.status !== "running" && before.status !== "queued") { result.scanned += 1; continue; }
        const after = getAgentRun(config, owner, runId);
        result.scanned += 1;
        if (after.status === "failed") result.recovered += 1;
        else result.active += 1;
      } catch {
        /* unreadable run directories are reported by their own reads */
      }
    }
  }
  return result;
}

export function cancelAgentRun(
  rawConfig: Partial<AgentServiceConfig>,
  sessionId: string,
  runId: string,
): AgentRunRecord {
  const config = serviceConfig(rawConfig);
  const record = readRunFile(config, sessionId, runId);
  if (["completed", "completed_with_gaps", "failed", "cancelled"].includes(record.status)) {
    throw new RunError("conflict", `The agent run is already ${record.status.replaceAll("_", " ")}; a terminal run cannot change status.`);
  }
  const now = new Date().toISOString();
  atomicWrite(cancelledFlag(config, sessionId, runId), JSON.stringify({ requestedAt: now }));
  if (record.status === "queued") {
    const cancelledRecord = agentRunRecordSchema.parse({
      ...record,
      status: "cancelled",
      cancelledAt: now,
      updatedAt: now,
    });
    writeRunFile(config, cancelledRecord);
    return cancelledRecord;
  }
  return { ...record, updatedAt: now };
}

// ---------------------------------------------------------------------------
// Events

export function readAgentEvents(
  rawConfig: Partial<AgentServiceConfig>,
  sessionId: string,
  runId: string,
  afterSeq = 0,
): { events: AgentEvent[]; lastSeq: number } {
  const config = serviceConfig(rawConfig);
  const path = artifactPath(config, sessionId, runId, "events.jsonl");
  if (!existsSync(path)) return { events: [], lastSeq: 0 };
  const events: AgentEvent[] = [];
  const seen = new Set<number>();
  let lastSeq = afterSeq;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = agentEventSchema.parse(JSON.parse(trimmed));
      if (event.seq > afterSeq && !seen.has(event.seq)) {
        seen.add(event.seq);
        events.push(event);
        lastSeq = Math.max(lastSeq, event.seq);
      }
    } catch {
      // A torn trailing line never blocks replay.
    }
  }
  events.sort((a, b) => a.seq - b.seq);
  return { events, lastSeq };
}

// ---------------------------------------------------------------------------
// Artifacts

const ARTIFACT_FILES: Record<AgentArtifactName, { file: string; schema: z.ZodType }> = {
  profile: { file: "profile.json", schema: profileArtifactSchema },
  market: { file: "market.json", schema: marketArtifactSchema },
  candidates: { file: "candidates.json", schema: searchArtifactSchema },
  inspection: { file: "inspection.json", schema: inspectionArtifactSchema },
  finance: { file: "finance.json", schema: financeArtifactSchema },
  summary: { file: "summary.json", schema: summaryArtifactSchema },
};

export function getAgentArtifact(
  rawConfig: Partial<AgentServiceConfig>,
  sessionId: string,
  runId: string,
  name: AgentArtifactName,
): unknown {
  const config = serviceConfig(rawConfig);
  const record = readRunFile(config, sessionId, runId);
  const entry = ARTIFACT_FILES[name];
  const path = artifactPath(config, sessionId, runId, entry.file);
  if (!existsSync(path)) {
    throw new RunError(
      record.status === "running" || record.status === "queued" ? "conflict" : "not_found",
      record.status === "running" || record.status === "queued"
        ? `The ${name} artifact has not been produced yet.`
        : `This agent run has no ${name} artifact.`,
    );
  }
  try {
    return entry.schema.parse(readJson(path));
  } catch {
    throw new RunError("invalid_run", `The stored ${name} artifact is invalid.`);
  }
}

// ---------------------------------------------------------------------------
// Authenticated tool bridge (worker → TypeScript tools)

const candidateIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,299}$/);

export function verifyToolToken(
  rawConfig: Partial<AgentServiceConfig>,
  sessionId: string,
  runId: string,
  bearer: string | null,
): boolean {
  const config = serviceConfig(rawConfig);
  const token = bearer?.startsWith("Bearer ") ? bearer.slice(7) : bearer;
  if (!token) return false;
  const path = artifactPath(config, sessionId, runId, "tool.token.sha256");
  if (!existsSync(path)) return false;
  const stored = readFileSync(path, "utf8").trim();
  const actual = createHash("sha256").update(token).digest("hex");
  const left = Buffer.from(stored, "hex");
  const right = Buffer.from(actual, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export class AgentToolError extends Error {
  code: "unknown_tool" | "invalid_input" | "not_found" | "conflict" | "unauthorized";
  constructor(code: AgentToolError["code"], message: string) {
    super(message);
    this.name = "AgentToolError";
    this.code = code;
  }
}

const VERIFICATION_TASKS: Record<string, string> = {
  kitchen_unverified: "Verify suite kitchen equipment with the landlord or a walkthrough.",
  kitchen_absent: "No verified kitchen; a build-out quote is needed (reported, never assumed).",
  parking_unverified: "Confirm customer parking rights for the suite in the lease.",
  parking_absent: "No verified customer parking; confirm any shared or nearby arrangement.",
  missing_charges: "Collect a complete additional-charges breakdown from the landlord.",
  exceeds_cap: "Occupancy cost exceeds the cap; verify the quoted basis with the source.",
  range_crosses_cap: "Resolve the crossing occupancy range with the landlord before proceeding.",
  ambiguous_basis: "Verify the quoted rent basis, units and size with the source.",
  unsupported_units: "Verify the quoted rent basis, units and size with the source.",
  unknown_value: "Verify the missing value with the source record.",
  capacity_unknown: "Confirm the suite's operable seat capacity.",
  capacity_mismatch: "Confirm the suite's operable seat capacity.",
  neighborhood_unresolved: "Confirm the neighborhood with the source record.",
};
const DEFAULT_VERIFICATION_TASK = "Verify this requirement with an independent source.";

function verificationTasksFor(gaps: { reasonCode: string }[]): string[] {
  const tasks = new Set<string>();
  for (const gap of gaps) tasks.add(VERIFICATION_TASKS[gap.reasonCode] ?? DEFAULT_VERIFICATION_TASK);
  return [...tasks];
}

function requireRequest(
  config: AgentServiceConfig,
  sessionId: string,
  runId: string,
): z.infer<typeof agentRunRequestFileSchema> {
  const path = artifactPath(config, sessionId, runId, "request.json");
  if (!existsSync(path)) throw new AgentToolError("not_found", "This agent run does not exist in the current session.");
  try {
    return agentRunRequestFileSchema.parse(readJson(path));
  } catch {
    throw new AgentToolError("not_found", "The stored agent run request is unreadable.");
  }
}

function assertNotCancelled(config: AgentServiceConfig, sessionId: string, runId: string) {
  if (existsSync(cancelledFlag(config, sessionId, runId))) {
    throw new AgentToolError("conflict", "The agent run was cancelled.");
  }
}

function readCandidatesArtifact(
  config: AgentServiceConfig,
  sessionId: string,
  runId: string,
): z.infer<typeof searchArtifactSchema> {
  const path = artifactPath(config, sessionId, runId, "candidates.json");
  if (!existsSync(path)) {
    throw new AgentToolError("conflict", "The site scout has not produced candidates yet; run scout.search_city first.");
  }
  try {
    return searchArtifactSchema.parse(readJson(path));
  } catch {
    throw new AgentToolError("conflict", "The stored candidates artifact is invalid; re-run scout.search_city.");
  }
}

export async function invokeAgentTool(
  rawConfig: Partial<AgentServiceConfig>,
  sessionId: string,
  runId: string,
  tool: string,
  input: unknown,
): Promise<unknown> {
  const config = serviceConfig(rawConfig);
  const request = requireRequest(config, sessionId, runId);
  assertNotCancelled(config, sessionId, runId);

  switch (tool) {
    case "profile.readiness_report": {
      const parsed = z.object({
        revisionId: z.string().min(1).max(200),
        revisionNumber: z.number().int().nonnegative(),
      }).parse(input);
      if (
        parsed.revisionId !== request.profile.revisionId ||
        parsed.revisionNumber !== request.profile.revisionNumber
      ) {
        throw new AgentToolError("invalid_input", "The readiness report must target the run's profile revision.");
      }
      const requirements = request.profile.requirements.requirements;
      const unknown = requirements.filter((item) => item.state === "unknown");
      return readinessToolOutputSchema.parse({
        modelVersion: "expansion-readiness-tool-v1",
        intakeSchemaVersion: "1.0",
        requirementsModelVersion: "expansion-requirements-v1",
        revisionId: request.profile.revisionId,
        revisionNumber: request.profile.revisionNumber,
        followUpQuestions: request.profile.followUpQuestions,
        completeness: {
          known: requirements.filter((item) => item.state === "known").map((item) => item.id),
          unknown: unknown.map((item) => item.id),
          missing: unknown.map((item) => ({
            requirementId: item.id,
            label: item.label,
            neededFor: item.note || "search completeness",
          })),
        },
        tacticalReport: null,
        note: "No agreed Tactical report was provided for this run; readiness covers the Expansion profile only and never invents a readiness score.",
      });
    }

    case "market.context": {
      const parsed = z.object({ cityId: z.string().min(1).max(100) }).parse(input);
      if (parsed.cityId !== request.cityId) {
        throw new AgentToolError("invalid_input", "Market context must target the run's city.");
      }
      let db: DatabaseSync | null = null;
      try {
        db = openDatabase(config.db);
        const meta = metadataFor(db);
        const propertyCount = Number(db.prepare("SELECT COUNT(*) n FROM records WHERE city_id=?").get(request.cityId)!.n);
        const spaceCount = Number(db.prepare("SELECT COUNT(*) n FROM spaces WHERE city_id=?").get(request.cityId)!.n);
        const listingCount = Number(
          db.prepare("SELECT COUNT(DISTINCT listing_id) n FROM spaces WHERE city_id=?").get(request.cityId)!.n,
        );
        const mappableCount = Number(
          db.prepare("SELECT COUNT(*) n FROM records WHERE city_id=? AND h3 IS NOT NULL").get(request.cityId)!.n,
        );
        const capabilities = [
          {
            source: "CoStar local snapshot",
            status: "available" as const,
            reason: `Dated local snapshot "${meta.datasetId}" is loaded for ${request.cityId}.`,
            detail: meta.datasetDate ? `dataset date ${meta.datasetDate}` : "dataset date not supplied",
          },
          {
            source: "Matterport",
            status: process.env.MATTERPORT_API_KEY ? ("configured" as const) : ("not_configured" as const),
            reason: process.env.MATTERPORT_API_KEY
              ? "Model metadata helper and credentials are configured; imagery access is not verified for this run."
              : "No Matterport credentials are configured in this environment.",
            detail: null,
          },
          {
            source: "Vexcel",
            status: process.env.VEXCEL_API_KEY ? ("configured" as const) : ("not_configured" as const),
            reason: process.env.VEXCEL_API_KEY
              ? "Imagery helper and credentials are configured; permitted image access is not verified for this run."
              : "No Vexcel credentials are configured in this environment.",
            detail: null,
          },
          {
            source: "Neighborhood geography",
            status: "not_configured" as const,
            reason: "No sourced Heights neighborhood boundary is committed; geography-based market context is unavailable.",
            detail: null,
          },
          {
            source: "ACS demographics",
            status: "not_configured" as const,
            reason: "No ACS adapter is configured; demographic context is unavailable.",
            detail: null,
          },
          {
            source: "Competition data",
            status: "not_configured" as const,
            reason: "No permitted competition source is configured; competitive context is unavailable.",
            detail: null,
          },
        ];
        const output = marketToolOutputSchema.parse({
          modelVersion: "expansion-market-tool-v1",
          cityId: request.cityId,
          sourced: true,
          dataset: {
            datasetId: meta.datasetId,
            datasetDate: meta.datasetDate ?? null,
            propertyCount,
            listingCount,
            spaceCount,
            mappableCount,
          },
          sourceCapabilities: capabilities,
          unavailableReasons: capabilities
            .filter((item) => item.status !== "available")
            .map((item) => `${item.source}: ${item.reason}`),
        });
        const artifact = marketArtifactSchema.parse({
          artifactVersion: AGENT_ARTIFACT_VERSION,
          modelVersion: "expansion-market-tool-v1",
          runId,
          cityId: request.cityId,
          sourced: output.sourced,
          dataset: output.dataset,
          sourceCapabilities: output.sourceCapabilities,
          unavailableReasons: output.unavailableReasons,
        });
        atomicWrite(
          artifactPath(config, sessionId, runId, "market.json"),
          JSON.stringify(artifact),
        );
        return output;
      } finally {
        try {
          db?.close();
        } catch {
          /* already closed */
        }
      }
    }

    case "scout.search_city": {
      const parsed = z.object({ cityId: z.string().min(1).max(100) }).parse(input);
      if (parsed.cityId !== request.cityId) {
        throw new AgentToolError("invalid_input", "The site scout must search the run's city.");
      }
      let db: DatabaseSync | null = null;
      try {
        db = openDatabase(config.db);
        const cancelled = () => existsSync(cancelledFlag(config, sessionId, runId));
        const search = await searchOfferedSpaces(db, request.cityId, {
          shouldCancel: cancelled,
        });
        const report = assessCandidates(search.candidates, request.profile.requirements, []);
        const artifact = searchArtifactSchema.parse({
          artifactVersion: AGENT_ARTIFACT_VERSION,
          modelVersion: SEARCH_MODEL_VERSION,
          matchingModelVersion: MATCHING_MODEL_VERSION,
          requirementsModelVersion: "expansion-requirements-v1",
          runId,
          cityId: request.cityId,
          datasetId: search.datasetId,
          datasetDate: search.datasetDate,
          searchedAt: search.searchedAt,
          cancelled: search.cancelled,
          requirements: request.profile.requirements,
          counts: { ...search.counts, meets: report.counts.meets, needsVerification: report.counts.needsVerification, doesNotMeet: report.counts.doesNotMeet },
          candidates: report.candidates,
          excluded: search.excluded,
          excludedTruncated: search.excluded.length > 1000,
        });
        atomicWrite(
          artifactPath(config, sessionId, runId, "candidates.json"),
          JSON.stringify(artifact),
        );
        return scoutToolOutputSchema.parse({
          modelVersion: SEARCH_MODEL_VERSION,
          matchingModelVersion: MATCHING_MODEL_VERSION,
          requirementsModelVersion: "expansion-requirements-v1",
          cityId: request.cityId,
          datasetId: search.datasetId,
          datasetDate: search.datasetDate,
          searchedAt: search.searchedAt,
          cancelled: search.cancelled,
          counts: artifact.counts,
          candidateIds: report.candidates.map((item) => item.candidate.id),
          topCandidates: report.candidates.slice(0, SCOUT_TOP_CANDIDATES).map((item) => {
            const ordered = [...item.assessments].sort((left, right) => {
              const order = (assessment: { status: string }) =>
                assessment.status === "fail" ? -1 : assessment.status === "unknown" ? 0 : 1;
              return order(left) - order(right);
            });
            const top = ordered.find((assessment) => assessment.status !== "pass") ?? item.assessments[0];
            return {
              id: item.candidate.id,
              name: item.candidate.name,
              group: item.group,
              rank: item.rank,
              serviceInclusion: serviceInclusion(item.candidate.rent?.serviceTypeCode ?? null),
              topAssessment: {
                requirementId: top.requirementId,
                status: top.status,
                reasonCode: top.reasonCode,
                reason: top.reason,
              },
            };
          }),
          excluded: search.excluded.slice(0, SCOUT_EXCLUDED_SAMPLE),
          excludedTruncated: artifact.excludedTruncated || search.excluded.length > SCOUT_EXCLUDED_SAMPLE,
        });
      } finally {
        try {
          db?.close();
        } catch {
          /* already closed */
        }
      }
    }

    case "inspector.evidence": {
      const parsed = z.object({
        candidateIds: z.array(candidateIdSchema).min(1).max(INSPECT_MAX_CANDIDATES),
      }).parse(input);
      const artifact = readCandidatesArtifact(config, sessionId, runId);
      const byId = new Map(artifact.candidates.map((item) => [item.candidate.id, item]));
      const inspected: z.infer<typeof inspectionToolOutputSchema>["inspected"] = [];
      const notFoundIds: string[] = [];
      for (const candidateId of parsed.candidateIds) {
        const assessed = byId.get(candidateId);
        if (!assessed) {
          notFoundIds.push(candidateId);
          continue;
        }
        const gaps = assessed.assessments.filter((item) => item.status !== "pass");
        inspected.push({
          candidateId,
          name: assessed.candidate.name,
          candidate: assessed.candidate,
          assessments: assessed.assessments,
          gaps,
          verificationTasks: verificationTasksFor(gaps),
        });
      }
      const output = inspectionToolOutputSchema.parse({
        modelVersion: "expansion-inspection-tool-v1",
        inspected,
        notFoundIds,
      });
      // Merge into the persisted artifact keyed by candidate id.
      const existingPath = artifactPath(config, sessionId, runId, "inspection.json");
      let previous: z.infer<typeof inspectionArtifactSchema> | null = null;
      if (existsSync(existingPath)) {
        try {
          previous = inspectionArtifactSchema.parse(readJson(existingPath));
        } catch {
          previous = null;
        }
      }
      const merged = new Map(
        (previous?.candidates ?? []).map((item) => [item.candidateId, item]),
      );
      for (const item of inspected) merged.set(item.candidateId, item);
      const storedNotFounds = new Set([
        ...(previous?.notFoundIds ?? []),
        ...notFoundIds,
      ]);
      atomicWrite(
        existingPath,
        JSON.stringify(inspectionArtifactSchema.parse({
          artifactVersion: AGENT_ARTIFACT_VERSION,
          modelVersion: "expansion-inspection-tool-v1",
          runId,
          inspectedAt: new Date().toISOString(),
          candidates: [...merged.values()],
          notFoundIds: [...storedNotFounds],
        })),
      );
      // Phase 5 integration: attach Phase 4 live source evidence for the
      // inspected spaces as a server-written side artifact. The worker
      // contract (tool output, inspection.json) is unchanged.
      await collectAgentEvidence(config, sessionId, runId, inspected.map((item) => item.candidate));
      return output;
    }

    case "finance.monthly_occupancy": {
      const parsed = z.object({
        candidateId: candidateIdSchema,
        extrasMonthly: z.number().finite().nonnegative().nullable(),
      }).parse(input);
      const artifact = readCandidatesArtifact(config, sessionId, runId);
      const assessed = artifact.candidates.find((item) => item.candidate.id === parsed.candidateId);
      if (!assessed) {
        throw new AgentToolError("invalid_input", `Unknown candidate "${parsed.candidateId}" for this run.`);
      }
      if (parsed.extrasMonthly !== null) {
        throw new AgentToolError(
          "invalid_input",
          "This run has no verified additional-charges evidence; extrasMonthly must be null.",
        );
      }
      // The inclusion is derived deterministically from the stored candidate;
      // the worker can never supply it, so it can never be wrong or invented.
      const deterministic = serviceInclusion(assessed.candidate.rent?.serviceTypeCode ?? null);
      return invokeTool("finance.monthly_occupancy", {
        candidate: assessed.candidate,
        extrasMonthly: null,
        inclusion: deterministic,
      });
    }

    case "finance.required_sales": {
      const parsed = z.object({
        fixedCostsMonthly: z.number().finite().nonnegative().nullable(),
        contributionMargin: z.number().finite().min(0).max(1).nullable(),
      }).parse(input);
      const financeInputs = request.profile.financeInputs;
      if (financeInputs.origin === "unavailable") {
        return {
          status: "unavailable",
          requiredSalesMonthly: null,
          reason: financeInputs.reasons.join(" "),
        };
      }
      const matches =
        parsed.fixedCostsMonthly !== null &&
        parsed.contributionMargin !== null &&
        financeInputs.fixedCostsMonthly !== null &&
        financeInputs.contributionMargin !== null &&
        Math.abs(parsed.fixedCostsMonthly - financeInputs.fixedCostsMonthly) < 1e-9 &&
        Math.abs(parsed.contributionMargin - financeInputs.contributionMargin) < 1e-9;
      if (!matches) {
        throw new AgentToolError(
          "invalid_input",
          "Finance inputs must come from the run's profile snapshot; model-proposed numbers are rejected.",
        );
      }
      return invokeTool("finance.required_sales", {
        fixedCostsMonthly: financeInputs.fixedCostsMonthly,
        contributionMargin: financeInputs.contributionMargin,
      });
    }

    default:
      throw new AgentToolError("unknown_tool", `Unknown agent tool "${tool}".`);
  }
}

// ---------------------------------------------------------------------------
// Phase 4 evidence attached to agent runs (server-written `evidence.json`)

export const AGENT_EVIDENCE_VERSION = "expansion-agent-evidence-v1";
export const AGENT_EVIDENCE_MAX_CANDIDATES = 3;
export const AGENT_EVIDENCE_TIMEOUT_MS = 20_000;
export const agentEvidenceSchema = z.object({
  version: z.literal(AGENT_EVIDENCE_VERSION),
  runId: z.string().min(1),
  collectedAt: z.iso.datetime(),
  snapshots: z.array(sourceSnapshotSchema).max(AGENT_EVIDENCE_MAX_CANDIDATES),
  note: z.string(),
}).strict();
export type AgentEvidence = z.infer<typeof agentEvidenceSchema>;

/**
 * Live Phase 4 source collection for the first inspected spaces. Synthetic
 * fixtures are never used here (collectCandidateSources never injects them),
 * provider failures stay explicit `unavailable` statuses, and the whole step
 * is bounded so it can never stall the worker's tool call.
 */
async function collectAgentEvidence(config: AgentServiceConfig, sessionId: string, runId: string, candidates: SpaceCandidate[]) {
  if (process.env.EXPANSION_AGENT_EVIDENCE === "0" || candidates.length === 0) return;
  const path = artifactPath(config, sessionId, runId, "evidence.json");
  let previous: AgentEvidence | null = null;
  try { previous = existsSync(path) ? agentEvidenceSchema.parse(readJson(path)) : null; } catch { previous = null; }
  const known = new Set(previous?.snapshots.map((item) => item.candidateId) ?? []);
  const targets = candidates.filter((item) => !known.has(item.id)).slice(0, AGENT_EVIDENCE_MAX_CANDIDATES - known.size);
  if (targets.length === 0) return;
  const timeout = new Promise<null>((resolveTimeout) => setTimeout(() => resolveTimeout(null), AGENT_EVIDENCE_TIMEOUT_MS).unref?.());
  const collected = await Promise.race([
    Promise.all(targets.map((candidate) => collectCandidateSources(candidate, { currentAddress: null, priceLevel: null }).catch(() => null))),
    timeout,
  ]);
  const snapshots = [...(previous?.snapshots ?? []), ...(collected ?? []).filter((item): item is SourceSnapshot => item !== null)];
  atomicWrite(path, JSON.stringify(agentEvidenceSchema.parse({
    version: AGENT_EVIDENCE_VERSION,
    runId,
    collectedAt: new Date().toISOString(),
    snapshots,
    note: collected === null
      ? "Source collection exceeded its time budget; no evidence was substituted."
      : "Live Phase 4 source statuses for the inspected spaces. Unavailable sources are explicit; synthetic fixtures are never attached here.",
  })));
}

export function getAgentEvidence(rawConfig: Partial<AgentServiceConfig>, sessionId: string, runId: string): AgentEvidence | null {
  const config = serviceConfig(rawConfig);
  readRunFile(config, sessionId, runId); // ownership + existence
  const path = artifactPath(config, sessionId, runId, "evidence.json");
  if (!existsSync(path)) return null;
  try { return agentEvidenceSchema.parse(readJson(path)); } catch { throw new RunError("invalid_run", "The stored evidence artifact is invalid."); }
}

export function agentCapabilities(rawConfig: Partial<AgentServiceConfig>) {
  const config = serviceConfig(rawConfig);
  const python = config.pythonPath ?? resolveWorkerPython();
  const workerReady = existsSync(python);
  const modelConfigured = providerConfigured();
  return agentCapabilitiesSchema.parse({
    agentEnabled: true,
    workerReady,
    modelConfigured,
    defaultMode: config.defaultMode ?? defaultAgentMode(),
    framework: "deepagents",
    labels: {
      live: "Deep Agents · live model",
      scripted: "Deep Agents · scripted test model",
      unavailable: "Model unavailable — the deterministic search path stays available",
    },
    reason: workerReady
      ? null
      : "The Python worker environment is missing; run the documented worker setup command.",
  });
}
