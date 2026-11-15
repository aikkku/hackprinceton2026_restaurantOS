import { getAgentArtifact, getAgentRun } from "./agent.ts";
import { searchArtifactSchema } from "../domain/agent.ts";
import type { SpaceCandidate } from "../domain/matching.ts";
import { getRun, getStoredRunReport } from "./runs.ts";

/** Only persisted, session-owned, successfully finished candidates can be probed. */
export function investigationCandidate(runId: string, candidateId: string, sessionId: string): SpaceCandidate {
  return investigationTarget(runId, candidateId, sessionId).candidate;
}
/** Candidate plus the run's dataset identity (used to gate labeled synthetic fixtures). */
export function investigationTarget(runId: string, candidateId: string, sessionId: string): { candidate: SpaceCandidate; datasetId: string | null } {
  let run;
  try { run = getAgentRun({}, sessionId, runId); }
  catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "not_found")) throw error;
    const basic = getRun({}, sessionId, runId);
    if (!["completed", "completed_with_gaps"].includes(basic.status)) throw Object.assign(new Error("Run has not finished."), { code: "conflict" });
    const search = getStoredRunReport({}, sessionId, runId);
    const item = search.report.candidates.find(x => x.candidate.id === candidateId);
    if (!item) throw Object.assign(new Error("Candidate is not in this run."), { code: "not_found" });
    return { candidate: item.candidate, datasetId: basic.datasetId };
  }
  if (!["completed", "completed_with_gaps"].includes(run.status)) throw Object.assign(new Error("Run has not finished."), { code: "conflict" });
  const search = searchArtifactSchema.parse(getAgentArtifact({}, sessionId, runId, "candidates"));
  const item = search.candidates.find(x => x.candidate.id === candidateId);
  if (!item) throw Object.assign(new Error("Candidate is not in this run."), { code: "not_found" });
  return { candidate: item.candidate, datasetId: search.datasetId ?? run.datasetId ?? null };
}
