import { z } from "zod";
import { agentRunRecordSchema, financeArtifactSchema, inspectionArtifactSchema, marketArtifactSchema, profileArtifactSchema, searchArtifactSchema, summaryArtifactSchema, validateSummaryAgainstSearch } from "./agent.ts";
import { assessmentRevisionSchema, reassessCandidate } from "./evidence.ts";
import { calculateDecisionFinance, decisionFinanceInputsSchema, decisionFinanceResultSchema, DECISION_FINANCE_VERSION } from "./decision-finance.ts";

export const BRIEF_VERSION = "expansion-decision-brief-v1";
export const investigationRunSchema = z.object({
  run: agentRunRecordSchema, profile: profileArtifactSchema, search: searchArtifactSchema,
  summary: summaryArtifactSchema, market: marketArtifactSchema.nullable(), inspection: inspectionArtifactSchema.nullable(), finance: financeArtifactSchema.nullable(),
}).superRefine((bundle, ctx) => {
  const { run, search, profile, summary } = bundle;
  if (!["completed", "completed_with_gaps"].includes(run.status)) ctx.addIssue({ code: "custom", message: "Investigate a successfully finished run." });
  if (run.runId !== search.runId || run.runId !== summary.runId || run.executionMode !== summary.executionMode || run.status !== summary.terminalStatus ||
      run.profile.revisionId !== profile.revisionId || profile.revisionId !== search.requirements.revisionId ||
      run.profile.revisionNumber !== profile.revisionNumber || profile.revisionNumber !== search.requirements.revisionNumber ||
      run.cityId !== search.cityId || run.cityId !== profile.cityId || run.datasetId !== search.datasetId || run.datasetDate !== search.datasetDate ||
      JSON.stringify(search.requirements) !== JSON.stringify(profile.requirements))
    ctx.addIssue({ code: "custom", message: "Run, dataset or profile revision mismatch." });
  const ids = new Set(search.candidates.map(x => x.candidate.id));
  if (ids.size !== search.candidates.length) ctx.addIssue({ code: "custom", message: "Duplicate run candidate IDs." });
  try { validateSummaryAgainstSearch(summary, search); } catch { ctx.addIssue({ code: "custom", message: "Ungrounded summary candidate references." }); }
  for (const artifact of [bundle.market, bundle.inspection, bundle.finance]) {
    if (artifact && artifact.runId !== run.runId) ctx.addIssue({ code: "custom", message: "Mixed-run supporting artifact." });
  }
  if (bundle.inspection?.candidates.some(x => !ids.has(x.candidateId) || x.candidateId !== x.candidate.id || JSON.stringify(x.candidate) !== JSON.stringify(search.candidates.find(y => y.candidate.id === x.candidateId)?.candidate)) || bundle.finance?.occupancy.some(x => !ids.has(x.candidateId)))
    ctx.addIssue({ code: "custom", message: "Supporting artifacts reference an unknown or different candidate." });
});
export type InvestigationRun = z.infer<typeof investigationRunSchema>;
export const briefChoiceSchema = z.object({
  candidateId: z.string().min(1), assessment: assessmentRevisionSchema,
  assessmentHistory: z.array(assessmentRevisionSchema),
  financeInputs: decisionFinanceInputsSchema, financeResults: decisionFinanceResultSchema,
});
export type BriefChoice = z.infer<typeof briefChoiceSchema>;
export const decisionBriefSchema = z.object({
  version: z.literal(BRIEF_VERSION), id: z.string().min(1), title: z.string().trim().min(1).max(160),
  createdAt: z.iso.datetime(), parentBriefId: z.string().nullable(),
  runSnapshot: investigationRunSchema, choices: z.array(briefChoiceSchema).min(2).max(3),
  nextQuestions: z.array(z.string().min(1)), financeModelVersion: z.literal(DECISION_FINANCE_VERSION),
}).superRefine((brief, ctx) => {
  if (new Set(brief.choices.map(x => x.candidateId)).size !== brief.choices.length) ctx.addIssue({ code: "custom", message: "Select distinct candidates." });
  for (const choice of brief.choices) {
    const base = brief.runSnapshot.search.candidates.find(x => x.candidate.id === choice.candidateId);
    if (!base || choice.assessment.profileRevisionId !== brief.runSnapshot.profile.revisionId || JSON.stringify(choice.assessment.candidate) !== JSON.stringify(base.candidate)) {
      ctx.addIssue({ code: "custom", message: "Mixed-profile or unknown candidate comparison." });
      continue;
    }
    const expected = reassessCandidate(base, brief.runSnapshot.profile.requirements, choice.assessment.notes, choice.assessment.sources, choice.assessment);
    if (JSON.stringify(expected) !== JSON.stringify(choice.assessment)) ctx.addIssue({ code: "custom", message: "Saved assessment differs from its evidence." });
    if (JSON.stringify(calculateDecisionFinance(base.candidate, choice.financeInputs)) !== JSON.stringify(choice.financeResults)) ctx.addIssue({ code: "custom", message: "Saved finance results differ from inputs." });
    const revisions = [...choice.assessmentHistory, choice.assessment];
    for (let index = 0; index < revisions.length; index++) {
      const revision = revisions[index];
      if (revision.revisionNumber !== index || revision.parentId !== (index ? revisions[index - 1].id : null) || revision.profileRevisionId !== brief.runSnapshot.profile.revisionId || JSON.stringify(revision.candidate) !== JSON.stringify(base.candidate))
        ctx.addIssue({ code: "custom", message: "Broken assessment revision chain." });
      if (JSON.stringify(reassessCandidate(base, brief.runSnapshot.profile.requirements, revision.notes, revision.sources, revision)) !== JSON.stringify(revision)) ctx.addIssue({ code: "custom", message: "Historical assessment differs from evidence." });
    }
  }
});
export type DecisionBrief = z.infer<typeof decisionBriefSchema>;

export function createDecisionBrief(input: Omit<DecisionBrief, "version" | "financeModelVersion">): DecisionBrief {
  return decisionBriefSchema.parse({ ...input, version: BRIEF_VERSION, financeModelVersion: DECISION_FINANCE_VERSION });
}
