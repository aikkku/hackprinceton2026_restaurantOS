import type { DecisionBrief, InvestigationRun } from "../../domain/decision-brief.ts";
import { EVIDENCE_VERSION, sourceSnapshotSchema, type SourceSnapshot } from "../../domain/evidence.ts";
import { applyRequirementPreferences, evaluateCandidate, groupFor, type AssessedCandidate } from "../../domain/matching.ts";
import { loadRunNeighborhoods, mergeOfficialNeighborhood } from "../data/neighborhoods.ts";
import type { RentEstimate } from "../../domain/rent-estimate.ts";
import type { SearchRequirements } from "../../domain/requirements.ts";
import { loadAgentEvidence } from "../data/account-client.ts";
import { loadInvestigationRun } from "../data/investigation-client.ts";
import { getProfileRun, getRunCandidatesRequest } from "../data/local-market.ts";
import { loadRentEstimates } from "../data/rent-estimates.ts";

/**
 * One read model for every screen after the search: built from a finished
 * Deep Agents run, a deterministic fallback run, or a saved plan's frozen
 * snapshot. Candidates and assessments are always the validated server
 * records; nothing here derives or invents candidate facts.
 */
export type Workspace = {
  source: "agent" | "deterministic" | "saved_plan";
  runId: string;
  cityId: string;
  cityLabel: string;
  restaurantName: string;
  requirements: SearchRequirements;
  profileRevisionId: string;
  profileRevisionNumber: number;
  candidates: AssessedCandidate[];
  /** Full agent bundle; required to save a plan (decision brief). */
  bundle: InvestigationRun | null;
  evidence: Map<string, SourceSnapshot>;
  tasks: Map<string, string[]>;
  /** Derived base-rent estimates for unlisted-rent candidates (enhancement only). */
  rentEstimates: Map<string, RentEstimate>;
  datasetId: string | null;
  datasetDate: string | null;
  executionMode: "live" | "scripted" | null;
  isSynthetic: boolean;
  included: number;
  examined: number;
};

const cityLabelFor = (requirements: SearchRequirements, fallback: string) => {
  const target = requirements.requirements.find((item) => item.id === "market.target")?.value;
  return target?.kind === "market" ? target.market.city : fallback;
};
const byRank = (items: AssessedCandidate[], requirements: SearchRequirements) => items.map(item => {
  const assessments = applyRequirementPreferences(item.assessments, requirements);
  return { ...item, assessments, group: groupFor(assessments) };
}).sort((a, b) => a.rank - b.rank);

export function workspaceFromBundle(
  bundle: InvestigationRun,
  evidence: Map<string, SourceSnapshot>,
  source: Workspace["source"] = "agent",
  rentEstimates: Map<string, RentEstimate> = new Map(),
): Workspace {
  const requirements = bundle.profile.requirements;
  return {
    source,
    runId: bundle.run.runId,
    cityId: bundle.run.cityId,
    cityLabel: cityLabelFor(requirements, bundle.run.cityId),
    restaurantName: bundle.profile.intake.restaurant.name,
    requirements,
    profileRevisionId: bundle.profile.revisionId,
    profileRevisionNumber: bundle.profile.revisionNumber,
    candidates: byRank(bundle.search.candidates, requirements),
    bundle,
    evidence,
    tasks: new Map((bundle.inspection?.candidates ?? []).map((item) => [item.candidateId, item.verificationTasks])),
    rentEstimates,
    datasetId: bundle.run.datasetId,
    datasetDate: bundle.run.datasetDate,
    executionMode: bundle.run.executionMode,
    isSynthetic: bundle.search.candidates.some((item) => item.candidate.isDemo) || /^synthetic[-_]/.test(bundle.run.datasetId ?? ""),
    included: bundle.search.counts.included,
    examined: bundle.search.counts.examined,
  };
}

export async function loadAgentWorkspace(runId: string, signal?: AbortSignal): Promise<Workspace> {
  const [bundle, evidence, rentEstimates] = await Promise.all([
    loadInvestigationRun(runId, signal),
    loadAgentEvidence(runId, signal),
    // Estimates are an enhancement, never a gate: failures yield an empty map.
    loadRentEstimates(runId, "agent", signal).catch(() => new Map<string, RentEstimate>()),
  ]);
  return populateOfficialNeighborhoods(workspaceFromBundle(bundle, evidence, "agent", rentEstimates), signal);
}

export async function loadDeterministicWorkspace(runId: string, signal?: AbortSignal): Promise<Workspace> {
  const [run, rentEstimates] = await Promise.all([
    getProfileRun(runId, signal),
    loadRentEstimates(runId, "deterministic", signal).catch(() => new Map<string, RentEstimate>()),
  ]);
  if (run.status !== "completed" && run.status !== "completed_with_gaps") throw new Error("This search hasn’t finished.");
  const candidates: AssessedCandidate[] = [];
  for (let offset = 0; offset < 2000;) {
    const page = await getRunCandidatesRequest(runId, { offset, limit: 200 }, signal);
    candidates.push(...page.candidates);
    offset += page.returned;
    if (!page.returned || offset >= page.total) break;
  }
  const requirements = run.profile.requirements;
  return populateOfficialNeighborhoods({
    source: "deterministic",
    runId,
    cityId: run.cityId,
    cityLabel: cityLabelFor(requirements, run.cityId),
    restaurantName: run.profile.intake.restaurant.name,
    requirements,
    profileRevisionId: run.profile.revisionId,
    profileRevisionNumber: run.profile.revisionNumber,
    candidates: byRank(candidates, requirements),
    bundle: null,
    evidence: new Map(),
    tasks: new Map(),
    rentEstimates,
    datasetId: run.datasetId,
    datasetDate: run.datasetDate,
    executionMode: null,
    isSynthetic: candidates.some((item) => item.candidate.isDemo) || /^synthetic[-_]/.test(run.datasetId ?? ""),
    included: run.counts.included,
    examined: run.counts.examined,
  }, signal);
}

async function populateOfficialNeighborhoods(workspace: Workspace, signal?: AbortSignal): Promise<Workspace> {
  if (workspace.source === "saved_plan" || workspace.isSynthetic) return workspace;
  let snapshots: SourceSnapshot[];
  try {
    const result = await loadRunNeighborhoods(workspace.runId, workspace.source, signal);
    snapshots = result.snapshots;
  } catch (error) {
    if (signal?.aborted) throw error;
    const now = new Date().toISOString();
    snapshots = workspace.candidates.map(item => sourceSnapshotSchema.parse({ version: EVIDENCE_VERSION, candidateId: item.candidate.id, refreshedAt: now,
      observations: [], gaps: ["Official City neighborhood source unavailable; legacy labels are not substituted."],
      statuses: [{ provider: "neighborhood", status: "unavailable", mode: "unavailable", checkedAt: now, capabilities: [], reason: "Official City neighborhood source unavailable; no neighborhood guessed." }] }));
  }
  const evidence = new Map(workspace.evidence);
  for (const snapshot of snapshots) evidence.set(snapshot.candidateId, mergeOfficialNeighborhood(evidence.get(snapshot.candidateId), snapshot));
  const candidates = workspace.candidates.map(item => {
    const facts = evidence.get(item.candidate.id)?.observations.filter(o => o.provider === "neighborhood").flatMap(o => o.facts) ?? [];
    const neighborhood = evaluateCandidate(item.candidate, workspace.requirements, facts).find(a => a.requirementId === "market.neighborhoodPreference")!;
    const assessments = item.assessments.map(a => a.requirementId === neighborhood.requirementId ? neighborhood : a);
    return { ...item, assessments, group: groupFor(assessments) };
  });
  return { ...workspace, evidence, candidates };
}

export function workspaceFromBrief(brief: DecisionBrief): Workspace {
  const evidence = new Map(brief.choices.map((choice) => [choice.candidateId, choice.assessment.sources]));
  // Frozen plans never re-fetch: a plan's estimate provenance lives in its
  // choices' financeInputs.occupancyEstimate, not in this live-only map.
  return workspaceFromBundle(brief.runSnapshot, evidence, "saved_plan", new Map());
}
