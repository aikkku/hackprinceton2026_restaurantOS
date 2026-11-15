import type { DecisionBrief, InvestigationRun } from "../../domain/decision-brief.ts";
import type { SourceSnapshot } from "../../domain/evidence.ts";
import type { AssessedCandidate } from "../../domain/matching.ts";
import type { SearchRequirements } from "../../domain/requirements.ts";
import { loadAgentEvidence } from "../data/account-client.ts";
import { loadInvestigationRun } from "../data/investigation-client.ts";
import { getProfileRun, getRunCandidatesRequest } from "../data/local-market.ts";

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
const byRank = (items: AssessedCandidate[]) => [...items].sort((a, b) => a.rank - b.rank);

export function workspaceFromBundle(bundle: InvestigationRun, evidence: Map<string, SourceSnapshot>, source: Workspace["source"] = "agent"): Workspace {
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
    candidates: byRank(bundle.search.candidates),
    bundle,
    evidence,
    tasks: new Map((bundle.inspection?.candidates ?? []).map((item) => [item.candidateId, item.verificationTasks])),
    datasetId: bundle.run.datasetId,
    datasetDate: bundle.run.datasetDate,
    executionMode: bundle.run.executionMode,
    isSynthetic: bundle.search.candidates.some((item) => item.candidate.isDemo) || /^synthetic[-_]/.test(bundle.run.datasetId ?? ""),
    included: bundle.search.counts.included,
    examined: bundle.search.counts.examined,
  };
}

export async function loadAgentWorkspace(runId: string, signal?: AbortSignal): Promise<Workspace> {
  const [bundle, evidence] = await Promise.all([loadInvestigationRun(runId, signal), loadAgentEvidence(runId, signal)]);
  return workspaceFromBundle(bundle, evidence);
}

export async function loadDeterministicWorkspace(runId: string, signal?: AbortSignal): Promise<Workspace> {
  const run = await getProfileRun(runId, signal);
  if (run.status !== "completed" && run.status !== "completed_with_gaps") throw new Error("This search hasn’t finished.");
  const candidates: AssessedCandidate[] = [];
  for (let offset = 0; offset < 2000;) {
    const page = await getRunCandidatesRequest(runId, { offset, limit: 200 }, signal);
    candidates.push(...page.candidates);
    offset += page.returned;
    if (!page.returned || offset >= page.total) break;
  }
  const requirements = run.profile.requirements;
  return {
    source: "deterministic",
    runId,
    cityId: run.cityId,
    cityLabel: cityLabelFor(requirements, run.cityId),
    restaurantName: run.profile.intake.restaurant.name,
    requirements,
    profileRevisionId: run.profile.revisionId,
    profileRevisionNumber: run.profile.revisionNumber,
    candidates: byRank(candidates),
    bundle: null,
    evidence: new Map(),
    tasks: new Map(),
    datasetId: run.datasetId,
    datasetDate: run.datasetDate,
    executionMode: null,
    isSynthetic: candidates.some((item) => item.candidate.isDemo) || /^synthetic[-_]/.test(run.datasetId ?? ""),
    included: run.counts.included,
    examined: run.counts.examined,
  };
}

export function workspaceFromBrief(brief: DecisionBrief): Workspace {
  const evidence = new Map(brief.choices.map((choice) => [choice.candidateId, choice.assessment.sources]));
  return workspaceFromBundle(brief.runSnapshot, evidence, "saved_plan");
}
