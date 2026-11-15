import { z } from "zod";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  INTAKE_SCHEMA_VERSION,
  intakeSchema,
  type RestaurantIntake,
} from "../domain/intake.ts";
import { normalizeRequirements } from "../domain/requirements.ts";
import {
  assessCandidates,
  assessedCandidateSchema,
  candidateGroups,
  factSchema,
  MATCHING_MODEL_VERSION,
  type CandidateFact,
  type CandidateGroup,
} from "../domain/matching.ts";
import {
  excludedCandidateSchema,
  intakeValidationResponseSchema,
  RUN_STORAGE_VERSION,
  runCandidatesPageSchema,
  runSchema,
  type RunCounts,
  type RunRecord,
} from "../domain/runs.ts";
import { searchRequirementsSchema } from "../domain/requirements.ts";
import {
  SEARCH_MODEL_VERSION,
  searchOfferedSpaces,
} from "./candidate-search.ts";
import {
  LocalDataError,
  openDatabase,
  type LocalConfig,
} from "./local-dataset.ts";

/**
 * Persisted, cancellable, session-scoped run service (Rain-owned backend).
 *
 * A run snapshots the explicit profile revision, evaluates every offered
 * space in the snapshot city with the pure matching engine, and stores the
 * assessment report in ignored local storage. Terminal runs can never change
 * back to success; cancellation is checked between search batches.
 */

export const RUN_STALE_MS = 5 * 60 * 1000;
export const MAX_EXCLUDED_ROWS = 1000;
export {
  RUN_STORAGE_VERSION,
  runStatuses,
  runSchema,
  runCandidatesPageSchema,
  intakeValidationResponseSchema,
} from "../domain/runs.ts";

export class RunError extends Error {
  code: "not_found" | "conflict" | "invalid_run";
  constructor(code: RunError["code"], message: string) {
    super(message);
    this.name = "RunError";
    this.code = code;
  }
}

export type RunServiceConfig = { db?: LocalConfig; runsDir: string };

export const defaultRunsDir = () =>
  resolve(
    process.cwd(),
    process.env.EXPANSION_E2E_RUNS_DIR ?? process.env.EXPANSION_RUNS_DIR ?? "src/features/expansion/data/data/runs",
  );

function serviceConfig(config: Partial<RunServiceConfig> = {}): RunServiceConfig {
  return {
    db: config.db,
    runsDir: resolve(config.runsDir ?? defaultRunsDir()),
  };
}

function sessionDir(config: RunServiceConfig, sessionId: string) {
  return resolve(config.runsDir, sessionId);
}
function runFile(config: RunServiceConfig, sessionId: string, runId: string) {
  return resolve(sessionDir(config, sessionId), `${runId}.json`);
}
function candidatesFile(config: RunServiceConfig, sessionId: string, runId: string) {
  return resolve(sessionDir(config, sessionId), `${runId}.candidates.json`);
}
function cancelFile(config: RunServiceConfig, sessionId: string, runId: string) {
  return resolve(sessionDir(config, sessionId), `${runId}.cancel`);
}

function atomicWrite(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  if (existsSync(temporary)) rmSync(temporary);
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

function readRun(config: RunServiceConfig, sessionId: string, runId: string): RunRecord {
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(runId) || !/^[a-zA-Z0-9_-]{1,64}$/.test(sessionId)) {
    throw new RunError("invalid_run", "Invalid run or session identifier.");
  }
  const path = runFile(config, sessionId, runId);
  if (!existsSync(path)) throw new RunError("not_found", "This run does not exist in the current session.");
  let record: RunRecord;
  try {
    record = runSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    throw new RunError("invalid_run", "The stored run is unreadable.");
  }
  return record;
}

function writeRun(config: RunServiceConfig, record: RunRecord) {
  atomicWrite(runFile(config, record.sessionId, record.runId), JSON.stringify(record));
}

function emptyCounts(): RunCounts {
  return {
    examined: 0,
    included: 0,
    excluded: 0,
    offMarket: 0,
    unknownMarketingStatus: 0,
    incompatibleUse: 0,
    useUnknown: 0,
    scanCapped: false,
    meets: 0,
    needsVerification: 0,
    doesNotMeet: 0,
  };
}

function redact(error: unknown): { code: string; message: string } {
  if (error instanceof LocalDataError) return { code: error.code, message: error.message };
  if (error instanceof RunError) return { code: error.code, message: error.message };
  return { code: "run_failed", message: "The run failed; no source details were exposed." };
}

export function requirementsHashOf(input: {
  intake: RestaurantIntake;
  revisionId: string;
  revisionNumber: number;
  cityId: string;
  facts?: CandidateFact[];
}): string {
  // Stable canonical hash for idempotent create. No external dependency.
  const canonical = JSON.stringify({
    intake: input.intake,
    revisionId: input.revisionId,
    revisionNumber: input.revisionNumber,
    cityId: input.cityId,
    facts: input.facts ?? [],
  });
  let hash = 0;
  for (let index = 0; index < canonical.length; index += 1) {
    hash = (hash * 31 + canonical.charCodeAt(index)) | 0;
  }
  return `${Math.abs(hash).toString(36)}-${canonical.length.toString(36)}`;
}

export type CreateRunInput = {
  runId: string;
  sessionId: string;
  cityId: string;
  intake: RestaurantIntake;
  revisionId: string;
  revisionNumber: number;
  facts?: CandidateFact[];
  /** Test hook to interleave between search batches. */
  yieldLoop?: () => Promise<void>;
};

/**
 * Create (idempotently) and execute a bounded citywide run. The same run id
 * with the same requirement hash returns the existing run; a different
 * payload conflicts. Terminal runs never change status afterwards.
 */
export async function createRun(
  rawConfig: Partial<RunServiceConfig>,
  input: CreateRunInput,
): Promise<{ record: RunRecord; created: boolean }> {
  const config = serviceConfig(rawConfig);
  const parsedIntake = intakeSchema.parse(input.intake);
  const requirements = normalizeRequirements(parsedIntake, {
    revisionId: input.revisionId,
    revisionNumber: input.revisionNumber,
    createdAt: new Date().toISOString(),
  });
  const facts = z.array(factSchema).parse(input.facts ?? []);
  const hash = requirementsHashOf({ ...input, intake: parsedIntake, facts });

  const existingPath = runFile(config, input.sessionId, input.runId);
  if (existsSync(existingPath)) {
    const existing = readRun(config, input.sessionId, input.runId);
    if (existing.requirementsHash === hash) return { record: existing, created: false };
    throw new RunError(
      "conflict",
      "This run id already exists with different requirements in the current session.",
    );
  }

  const now = new Date().toISOString();
  let record: RunRecord = {
    version: RUN_STORAGE_VERSION,
    runId: input.runId,
    sessionId: input.sessionId,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    cancelledAt: null,
    cityId: input.cityId,
    dataMode: "local",
    datasetId: null,
    datasetDate: null,
    requirementsHash: hash,
    profile: {
      revisionId: input.revisionId,
      revisionNumber: input.revisionNumber,
      intake: parsedIntake,
      requirements,
    },
    counts: emptyCounts(),
    searchedAt: null,
    error: null,
  };
  writeRun(config, record);

  const cancelled = () => existsSync(cancelFile(config, input.sessionId, input.runId));
  const yieldLoop = input.yieldLoop ?? (() => Promise.resolve());
  record = { ...record, status: "running", updatedAt: new Date().toISOString() };
  writeRun(config, record);

  let db: DatabaseSync | null = null;
  try {
    db = openDatabase(config.db);
    const search = await searchOfferedSpaces(db, input.cityId, {
      yieldLoop,
      shouldCancel: cancelled,
    });
    record = { ...record, updatedAt: new Date().toISOString() };
    writeRun(config, record);
    const report = assessCandidates(search.candidates, requirements, facts);
    const terminal = cancelled();
    const counts: RunCounts = {
      ...emptyCounts(),
      ...search.counts,
      meets: report.counts.meets,
      needsVerification: report.counts.needsVerification,
      doesNotMeet: report.counts.doesNotMeet,
    };
    const finished = new Date().toISOString();
    record = {
      ...record,
      status: terminal
        ? "cancelled"
        : search.counts.scanCapped
          ? "completed_with_gaps"
          : "completed",
      updatedAt: finished,
      completedAt: terminal ? null : finished,
      cancelledAt: terminal ? finished : null,
      datasetId: search.datasetId,
      datasetDate: search.datasetDate,
      counts,
      searchedAt: search.searchedAt,
      error: null,
    };
    writeRun(config, record);
    atomicWrite(
      candidatesFile(config, input.sessionId, input.runId),
      JSON.stringify({
        version: RUN_STORAGE_VERSION,
        runId: input.runId,
        modelVersion: MATCHING_MODEL_VERSION,
        searchModelVersion: SEARCH_MODEL_VERSION,
        requirements,
        report,
        excluded: search.excluded,
        excludedTruncated: search.excluded.length > MAX_EXCLUDED_ROWS,
        cancelled: search.cancelled,
      }),
    );
    return { record, created: true };
  } catch (error) {
    const failed = { ...record, status: "failed" as const, updatedAt: new Date().toISOString(), error: redact(error) };
    writeRun(config, failed);
    return { record: failed, created: true };
  } finally {
    try {
      db?.close();
    } catch {
      /* already closed */
    }
  }
}

export function getRun(
  rawConfig: Partial<RunServiceConfig>,
  sessionId: string,
  runId: string,
): RunRecord {
  const config = serviceConfig(rawConfig);
  const record = readRun(config, sessionId, runId);
  if (
    (record.status === "running" || record.status === "queued") &&
    Date.now() - Date.parse(record.updatedAt) > RUN_STALE_MS
  ) {
    // Interrupted-run recovery: a stale nonterminal run is a failed run.
    const recovered = {
      ...record,
      status: "failed" as const,
      updatedAt: new Date().toISOString(),
      error: { code: "interrupted", message: "The run was interrupted and recovered as failed. Create a new run to retry." },
    };
    writeRun(config, recovered);
    return recovered;
  }
  return record;
}

export function cancelRun(
  rawConfig: Partial<RunServiceConfig>,
  sessionId: string,
  runId: string,
): RunRecord {
  const config = serviceConfig(rawConfig);
  const record = readRun(config, sessionId, runId);
  if (record.status === "completed" || record.status === "completed_with_gaps" || record.status === "failed" || record.status === "cancelled") {
    throw new RunError("conflict", `The run is already ${record.status.replaceAll("_", " ")}; a terminal run cannot change status.`);
  }
  const now = new Date().toISOString();
  atomicWrite(cancelFile(config, sessionId, runId), JSON.stringify({ requestedAt: now }));
  if (record.status === "queued") {
    const cancelledRecord = { ...record, status: "cancelled" as const, cancelledAt: now, updatedAt: now };
    writeRun(config, cancelledRecord);
    return cancelledRecord;
  }
  return { ...record, updatedAt: now };
}

export const storedCandidatesSchema = z.object({
  version: z.literal(RUN_STORAGE_VERSION),
  runId: z.string().min(1),
  modelVersion: z.string().min(1),
  searchModelVersion: z.string().min(1),
  requirements: searchRequirementsSchema,
  report: z.object({
    modelVersion: z.string().min(1),
    counts: z.object({
      examined: z.number().int().nonnegative(),
      meets: z.number().int().nonnegative(),
      needsVerification: z.number().int().nonnegative(),
      doesNotMeet: z.number().int().nonnegative(),
      useUnknown: z.number().int().nonnegative(),
    }),
    candidates: z.array(assessedCandidateSchema),
  }),
  excluded: z.array(excludedCandidateSchema),
  excludedTruncated: z.boolean(),
  cancelled: z.boolean(),
});
export type StoredRunReport = z.infer<typeof storedCandidatesSchema>;

/** Full stored report behind getRunCandidates (additive helper for other readers). */
export function getStoredRunReport(
  rawConfig: Partial<RunServiceConfig>,
  sessionId: string,
  runId: string,
): StoredRunReport {
  const config = serviceConfig(rawConfig);
  const record = readRun(config, sessionId, runId);
  const path = candidatesFile(config, sessionId, runId);
  if (!existsSync(path)) {
    throw new RunError(
      record.status === "running" || record.status === "queued" ? "conflict" : "invalid_run",
      record.status === "running" || record.status === "queued"
        ? "The run has not produced candidates yet."
        : "This run has no stored candidates.",
    );
  }
  return storedCandidatesSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function getRunCandidates(
  rawConfig: Partial<RunServiceConfig>,
  sessionId: string,
  runId: string,
  page: { offset?: number; limit?: number; group?: string | null } = {},
): z.infer<typeof runCandidatesPageSchema> {
  const config = serviceConfig(rawConfig);
  const record = readRun(config, sessionId, runId);
  const stored = getStoredRunReport(config, sessionId, runId);
  const candidates = stored.report.candidates;
  const offset = Math.max(0, Math.floor(page.offset ?? 0));
  const limit = Math.min(200, Math.max(1, Math.floor(page.limit ?? 100)));
  let filtered = candidates;
  const group = page.group && (candidateGroups as readonly string[]).includes(page.group)
    ? (page.group as CandidateGroup)
    : null;
  if (group) filtered = filtered.filter((item) => item.group === group);
  const total = filtered.length;
  const slice = filtered.slice(offset, offset + limit);
  return runCandidatesPageSchema.parse({
    runId,
    status: record.status,
    total,
    returned: slice.length,
    offset,
    limit,
    group,
    candidates: slice,
    excluded: stored.excluded.slice(0, MAX_EXCLUDED_ROWS),
    excludedTruncated: stored.excludedTruncated || stored.excluded.length > MAX_EXCLUDED_ROWS,
    counts: record.counts,
  });
}

export function validateIntakeForSearch(input: {
  intake: RestaurantIntake;
  revisionId?: string;
  revisionNumber?: number;
}): z.infer<typeof intakeValidationResponseSchema> {
  const parsed = intakeSchema.parse(input.intake);
  const requirements = normalizeRequirements(parsed, {
    revisionId: input.revisionId ?? `validate-${Date.now().toString(36)}`,
    revisionNumber: input.revisionNumber ?? 0,
    createdAt: new Date().toISOString(),
  });
  return intakeValidationResponseSchema.parse({
    modelVersion: MATCHING_MODEL_VERSION,
    intakeSchemaVersion: INTAKE_SCHEMA_VERSION,
    followUpQuestions: parsed.followUpQuestions,
    requirements,
  });
}
