import { z } from "zod";
import {
  agentEventSchema,
  agentRunRecordSchema,
  searchArtifactSchema,
  type AgentArtifactName,
  type AgentEvent,
  type AgentRunRecord,
} from "../domain/agent.ts";
import { decisionBriefSchema, type DecisionBrief } from "../domain/decision-brief.ts";
import { sourceSnapshotSchema, type SourceSnapshot } from "../domain/evidence.ts";
import { assessedCandidateSchema } from "../domain/matching.ts";
import { profileDraftEnvelopeSchema, type ProfileDraftEnvelope } from "../frontend/storage.ts";
import { getAgentArtifact, getAgentEvidence, getAgentRun, readAgentEvents, type AgentServiceConfig } from "./agent.ts";
import { canonicalJson, contentHash, docId, PersistenceError, type ExpansionRepository, type InsertResult, type StoredDoc } from "./store.ts";

/**
 * Durable Expansion records on top of the owner-scoped repository.
 *
 * The run directory stays the worker's working store while a run executes
 * (Phase 3 contract, unchanged). This module mirrors each owner's runs into
 * the repository, and once a run is terminal copies its events, candidate
 * assessments and validated artifacts so reload/restore works even when the
 * run directory is gone (new host, ephemeral disk). Nothing here recomputes
 * matching or finance: briefs are validated by the Phase 4 schema, which
 * re-derives assessments/finance with the canonical TypeScript functions.
 */

export const DURABLE_VERSION = "expansion-durable-v1";
const TERMINAL = new Set(["completed", "completed_with_gaps", "failed", "cancelled"]);
const ARTIFACTS: AgentArtifactName[] = ["profile", "market", "inspection", "finance", "summary"];

// ---------------------------------------------------------------------------
// Profiles

export type ProfileSaveReport = { profileId: string; revisions: { revisionId: string; revisionNumber: number; result: InsertResult }[] };

export async function saveProfileEnvelope(repo: ExpansionRepository, ownerId: string, rawEnvelope: unknown, provenance: "app" | "browser_import"): Promise<ProfileSaveReport> {
  const envelope = profileDraftEnvelopeSchema.parse(rawEnvelope);
  const ordered = [...envelope.revisions].sort((a, b) => a.revisionNumber - b.revisionNumber);
  const profileId = ordered[0].revisionId;
  const report: ProfileSaveReport = { profileId, revisions: [] };
  for (const revision of ordered) {
    const hash = contentHash(revision);
    const result = await repo.insertImmutable("profileRevisions", {
      _id: docId(ownerId, revision.revisionId), ownerId, profileId, revisionId: revision.revisionId,
      revisionNumber: revision.revisionNumber, parentRevisionId: revision.parentRevisionId,
      modelVersion: revision.requirements.modelVersion ?? null, intakeSchemaVersion: revision.intakeSchemaVersion,
      revision, contentHash: hash, provenance, storedAt: new Date(),
    });
    if (result === "conflict") throw new PersistenceError("conflict", `Profile revision ${revision.revisionNumber} already exists with different content; saved revisions are immutable.`);
    report.revisions.push({ revisionId: revision.revisionId, revisionNumber: revision.revisionNumber, result });
  }
  const latest = ordered[ordered.length - 1];
  const existing = await repo.get("profiles", ownerId, docId(ownerId, profileId));
  if (!existing || Number(existing.latestRevisionNumber) < latest.revisionNumber) {
    await repo.upsert("profiles", {
      _id: docId(ownerId, profileId), ownerId, profileId, restaurantName: latest.intakeSnapshot.restaurant?.name ?? null,
      isDemo: latest.isDemo, latestRevisionNumber: latest.revisionNumber, latestRevisionId: latest.revisionId,
      createdAt: (existing?.createdAt as string | undefined) ?? new Date().toISOString(), updatedAt: new Date().toISOString(), version: DURABLE_VERSION,
    });
  }
  return report;
}

export type ProfileSummary = {
  profileId: string;
  restaurantName: string | null;
  isDemo: boolean;
  latestRevisionNumber: number;
  latestRevisionId: string;
  createdAt: string;
  updatedAt: string;
};

const summaryFrom = (doc: StoredDoc): ProfileSummary => ({
  profileId: String(doc.profileId),
  restaurantName: typeof doc.restaurantName === "string" ? doc.restaurantName : null,
  isDemo: doc.isDemo === true,
  latestRevisionNumber: Number(doc.latestRevisionNumber),
  latestRevisionId: String(doc.latestRevisionId),
  createdAt: String(doc.createdAt ?? doc.updatedAt),
  updatedAt: String(doc.updatedAt),
});

/** The owner's stored restaurant profiles, most recently updated first. */
export async function listProfiles(repo: ExpansionRepository, ownerId: string, limit = 50): Promise<ProfileSummary[]> {
  const rows = await repo.list("profiles", ownerId, {}, { sort: ["updatedAt", -1], limit });
  return rows.map(summaryFrom);
}

/** Rebuild the owner's most recently updated profile envelope from immutable revisions. */
export async function loadLatestProfile(repo: ExpansionRepository, ownerId: string): Promise<ProfileDraftEnvelope | null> {
  const [profile] = await repo.list("profiles", ownerId, {}, { sort: ["updatedAt", -1], limit: 1 });
  return profile ? envelopeFor(repo, ownerId, profile) : null;
}

/** Rebuild one owner profile's envelope; null when the owner has no such profile. */
export async function loadProfile(repo: ExpansionRepository, ownerId: string, profileId: string): Promise<ProfileDraftEnvelope | null> {
  const profile = await repo.get("profiles", ownerId, docId(ownerId, profileId));
  return profile ? envelopeFor(repo, ownerId, profile) : null;
}

async function envelopeFor(repo: ExpansionRepository, ownerId: string, profile: StoredDoc): Promise<ProfileDraftEnvelope> {
  const revisions = await repo.list("profileRevisions", ownerId, { profileId: String(profile.profileId) }, { sort: ["revisionNumber", 1], limit: 1000 });
  const parsed = profileDraftEnvelopeSchema.safeParse({ schemaVersion: 1, revisions: revisions.map(doc => doc.revision), updatedAt: profile.updatedAt });
  if (!parsed.success) throw new PersistenceError("invalid", "The stored profile revisions are inconsistent; they were preserved unchanged.");
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Runs

const syncedTerminal = new Set<string>();

function runDoc(ownerId: string, record: AgentRunRecord, extra: Record<string, unknown> = {}): StoredDoc {
  return {
    _id: docId(ownerId, record.runId), ownerId, runId: record.runId, kind: "agent", status: record.status,
    executionMode: record.executionMode, executionLabel: executionLabel(record), profileRevisionId: record.profile.revisionId,
    profileRevisionNumber: record.profile.revisionNumber, requirementsHash: record.requirementsHash, datasetId: record.datasetId,
    datasetDate: record.datasetDate, model: record.model, createdAt: record.createdAt, updatedAt: record.updatedAt,
    record, version: DURABLE_VERSION, ...extra,
  };
}

/** Honest label: a scripted double or a fallback is never a live Deep Agents success. */
export function executionLabel(record: AgentRunRecord): string {
  if (record.executionMode === "scripted") return "Deep Agents · scripted test model (not a live model run)";
  if (record.status === "failed") return "Deep Agents · live model — failed (deterministic search is separate)";
  if (record.status === "cancelled") return "Deep Agents · live model — cancelled";
  if (record.status === "completed" || record.status === "completed_with_gaps") return `Deep Agents · live model${record.model?.provider ? ` (${record.model.provider}/${record.model.modelId ?? "?"})` : ""}`;
  return "Deep Agents · live model — in progress";
}

/**
 * Mirror one owner-visible run into the repository. Non-terminal runs only
 * update the run document; terminal runs additionally copy events,
 * candidate assessments and validated artifacts exactly once per process.
 */
export async function syncAgentRun(repo: ExpansionRepository, config: Partial<AgentServiceConfig>, ownerId: string, runId: string): Promise<AgentRunRecord> {
  const record = getAgentRun(config, ownerId, runId);
  const key = `${repo.mode}:${ownerId}:${runId}`;
  if (!TERMINAL.has(record.status)) {
    await repo.upsert("runs", runDoc(ownerId, record, { terminalSynced: false }));
    return record;
  }
  if (syncedTerminal.has(key)) return record;
  const existing = await repo.get("runs", ownerId, docId(ownerId, runId));
  if (existing?.terminalSynced === true && existing.status === record.status) { syncedTerminal.add(key); return record; }

  const { events } = readAgentEvents(config, ownerId, runId, 0);
  for (const event of events) {
    await repo.insertImmutable("runEvents", { _id: docId(ownerId, runId, String(event.seq)), ownerId, runId, seq: event.seq, event, contentHash: contentHash(event), storedAt: new Date() });
  }
  const artifacts: Record<string, unknown> = {};
  for (const name of ARTIFACTS) {
    try { artifacts[name] = getAgentArtifact(config, ownerId, runId, name); } catch { artifacts[name] = null; }
  }
  try {
    const evidence = getAgentEvidence(config, ownerId, runId);
    artifacts.evidence = evidence;
    for (const snapshot of evidence?.snapshots ?? []) await recordEvidence(repo, ownerId, runId, snapshot, "agent");
  } catch { artifacts.evidence = null; }
  let searchMeta: unknown = null;
  try {
    const search = searchArtifactSchema.parse(getAgentArtifact(config, ownerId, runId, "candidates"));
    const { candidates, ...rest } = search;
    searchMeta = rest;
    for (const [position, assessed] of candidates.entries()) {
      await repo.upsert("assessments", {
        _id: docId(ownerId, runId, assessed.candidate.id), ownerId, runId, candidateId: assessed.candidate.id, position,
        rank: assessed.rank, group: assessed.group, datasetId: search.datasetId, datasetDate: search.datasetDate,
        profileRevisionId: search.requirements.revisionId, matchingModelVersion: search.matchingModelVersion, searchModelVersion: search.modelVersion,
        assessed, contentHash: contentHash(assessed),
      });
    }
  } catch { /* runs without a search artifact keep searchMeta null */ }
  await repo.upsert("runs", runDoc(ownerId, record, { terminalSynced: true, artifacts, searchMeta, eventCount: events.length, syncedAt: new Date().toISOString() }));
  syncedTerminal.add(key);
  return record;
}

export async function durableRun(repo: ExpansionRepository, ownerId: string, runId: string): Promise<AgentRunRecord | null> {
  const doc = await repo.get("runs", ownerId, docId(ownerId, runId));
  return doc ? agentRunRecordSchema.parse(doc.record) : null;
}

export async function durableArtifact(repo: ExpansionRepository, ownerId: string, runId: string, name: AgentArtifactName | "evidence"): Promise<unknown | null> {
  const doc = await repo.get("runs", ownerId, docId(ownerId, runId));
  if (!doc || doc.terminalSynced !== true) return null;
  if (name !== "candidates") return (doc.artifacts as Record<string, unknown> | undefined)?.[name] ?? null;
  if (!doc.searchMeta) return null;
  const rows = await repo.list("assessments", ownerId, { runId }, { sort: ["position", 1], limit: 1000 });
  return searchArtifactSchema.parse({ ...(doc.searchMeta as object), candidates: rows.map(row => assessedCandidateSchema.parse(row.assessed)) });
}

export async function durableEvents(repo: ExpansionRepository, ownerId: string, runId: string, afterSeq = 0): Promise<AgentEvent[]> {
  const rows = await repo.list("runEvents", ownerId, { runId }, { sort: ["seq", 1], limit: 1000 });
  return rows.map(row => agentEventSchema.parse(row.event)).filter(event => event.seq > afterSeq);
}

export async function listDurableRuns(repo: ExpansionRepository, ownerId: string, limit = 50): Promise<AgentRunRecord[]> {
  const rows = await repo.list("runs", ownerId, {}, { sort: ["createdAt", -1], limit });
  return rows.map(row => agentRunRecordSchema.parse(row.record));
}

// ---------------------------------------------------------------------------
// Evidence

export async function recordEvidence(repo: ExpansionRepository, ownerId: string, runId: string, rawSnapshot: unknown, sourceMode: "live" | "synthetic" | "agent" | "brief", briefId: string | null = null): Promise<InsertResult> {
  const snapshot: SourceSnapshot = sourceSnapshotSchema.parse(rawSnapshot);
  const hash = contentHash(snapshot);
  return repo.insertImmutable("evidence", {
    _id: docId(ownerId, runId, snapshot.candidateId, hash.slice(0, 24)), ownerId, runId, candidateId: snapshot.candidateId,
    sourceMode, briefId, version: snapshot.version, refreshedAt: snapshot.refreshedAt,
    synthetic: snapshot.observations.some(item => item.isSynthetic), snapshot, contentHash: hash, storedAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Decision briefs + scenarios

export type BriefRecord = { brief: DecisionBrief; provenance: "app" | "browser_import"; runVerified: boolean; storedAt: string };

/**
 * Compare the brief's frozen run snapshot with the owner's stored run. The
 * client cannot forge candidates, summaries or profile revisions into a brief
 * saved through the app: a mismatch is rejected.
 */
async function verifyRunSnapshot(repo: ExpansionRepository, config: Partial<AgentServiceConfig>, ownerId: string, brief: DecisionBrief): Promise<"verified" | "missing" | "mismatch"> {
  const runId = brief.runSnapshot.run.runId;
  const load = async (name: AgentArtifactName) => {
    try { return getAgentArtifact(config, ownerId, runId, name); } catch { return durableArtifact(repo, ownerId, runId, name); }
  };
  let record: AgentRunRecord | null = null;
  try { record = getAgentRun(config, ownerId, runId); } catch { record = await durableRun(repo, ownerId, runId); }
  if (!record) return "missing";
  const [profile, search, summary] = await Promise.all([load("profile"), load("candidates"), load("summary")]);
  if (!profile || !search || !summary) return "missing";
  const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
  const snapshot = brief.runSnapshot;
  const runMatches = record.runId === snapshot.run.runId && record.status === snapshot.run.status && record.executionMode === snapshot.run.executionMode && same(record.profile, snapshot.run.profile) && record.datasetId === snapshot.run.datasetId;
  return runMatches && same(profile, snapshot.profile) && same(search, snapshot.search) && same(summary, snapshot.summary) ? "verified" : "mismatch";
}

export async function saveBrief(repo: ExpansionRepository, config: Partial<AgentServiceConfig>, ownerId: string, rawBrief: unknown, provenance: "app" | "browser_import"): Promise<{ result: InsertResult; record: BriefRecord }> {
  const brief = decisionBriefSchema.parse(rawBrief);
  const verification = await verifyRunSnapshot(repo, config, ownerId, brief);
  if (verification === "mismatch") throw new PersistenceError("conflict", "The brief's run snapshot does not match your stored run; it was not saved.");
  if (verification === "missing" && provenance === "app") throw new PersistenceError("not_found", "The brief's run is not in your workspace; only your own runs can be saved.");
  const runVerified = verification === "verified";
  const hash = contentHash(brief);
  const storedAt = new Date().toISOString();
  const result = await repo.insertImmutable("briefs", {
    _id: docId(ownerId, brief.id), ownerId, briefId: brief.id, parentBriefId: brief.parentBriefId, title: brief.title,
    runId: brief.runSnapshot.run.runId, profileRevisionId: brief.runSnapshot.profile.revisionId, version: brief.version,
    financeModelVersion: brief.financeModelVersion, executionMode: brief.runSnapshot.run.executionMode,
    createdAt: brief.createdAt, provenance, runVerified, brief, contentHash: hash, storedAt,
  });
  if (result === "conflict") throw new PersistenceError("conflict", "A different brief already uses this id; saved briefs are immutable.");
  if (result === "inserted") {
    for (const choice of brief.choices) {
      await repo.upsert("scenarios", {
        _id: docId(ownerId, brief.id, choice.candidateId), ownerId, briefId: brief.id, runId: brief.runSnapshot.run.runId,
        candidateId: choice.candidateId, financeModelVersion: brief.financeModelVersion, assessmentRevisionId: choice.assessment.id,
        inputs: choice.financeInputs, results: choice.financeResults, contentHash: contentHash({ inputs: choice.financeInputs, results: choice.financeResults }),
      });
      for (const revision of [...choice.assessmentHistory, choice.assessment]) {
        if (revision.sources.observations.length || revision.sources.statuses.some(status => status.mode !== "unavailable")) {
          await recordEvidence(repo, ownerId, brief.runSnapshot.run.runId, revision.sources, "brief", brief.id);
        }
      }
    }
  }
  return { result, record: { brief, provenance, runVerified, storedAt } };
}

export async function listBriefs(repo: ExpansionRepository, ownerId: string, limit = 20): Promise<BriefRecord[]> {
  const rows = await repo.list("briefs", ownerId, {}, { sort: ["createdAt", -1], limit });
  const records: BriefRecord[] = [];
  for (const row of rows) {
    const parsed = decisionBriefSchema.safeParse(row.brief);
    if (parsed.success) records.push({ brief: parsed.data, provenance: row.provenance === "browser_import" ? "browser_import" : "app", runVerified: row.runVerified === true, storedAt: String(row.storedAt) });
  }
  return records;
}

// ---------------------------------------------------------------------------
// Explicit browser import (originals are never touched by the server; the
// client never deletes them either)

export const importRequestSchema = z.object({
  profileDraft: z.unknown().optional(),
  briefs: z.array(z.unknown()).max(10).optional(),
}).strict();
export type ImportItem = { kind: "profile" | "brief"; id: string | null; status: "imported" | "duplicate" | "rejected"; reason: string | null };

export async function importBrowserData(repo: ExpansionRepository, config: Partial<AgentServiceConfig>, ownerId: string, raw: unknown): Promise<ImportItem[]> {
  const request = importRequestSchema.parse(raw);
  const items: ImportItem[] = [];
  if (request.profileDraft !== undefined) {
    try {
      const report = await saveProfileEnvelope(repo, ownerId, request.profileDraft, "browser_import");
      items.push({ kind: "profile", id: report.profileId, status: report.revisions.every(item => item.result === "duplicate") ? "duplicate" : "imported", reason: null });
    } catch (error) {
      if (error instanceof PersistenceError && error.code === "persistence_unavailable") throw error;
      items.push({ kind: "profile", id: null, status: "rejected", reason: error instanceof PersistenceError ? error.message : "The browser profile draft failed validation; it was left untouched." });
    }
  }
  for (const rawBrief of request.briefs ?? []) {
    const id = rawBrief && typeof rawBrief === "object" && "id" in rawBrief && typeof rawBrief.id === "string" ? rawBrief.id : null;
    try {
      const saved = await saveBrief(repo, config, ownerId, rawBrief, "browser_import");
      items.push({ kind: "brief", id, status: saved.result === "duplicate" ? "duplicate" : "imported", reason: saved.record.runVerified ? null : "Imported; its run is not in your server workspace, so the frozen run snapshot is labeled unverified." });
    } catch (error) {
      if (error instanceof PersistenceError && error.code === "persistence_unavailable") throw error;
      items.push({ kind: "brief", id, status: "rejected", reason: error instanceof PersistenceError ? error.message : "The browser brief failed validation; it was left untouched." });
    }
  }
  return items;
}
