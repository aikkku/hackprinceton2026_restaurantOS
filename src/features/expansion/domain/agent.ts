import { z } from "zod";
import { intakeSchema } from "./intake.ts";
import { searchRequirementsSchema } from "./requirements.ts";
import {
  assessedCandidateSchema,
  assessmentSchema,
  candidateSchema,
  factSchema,
  MATCHING_MODEL_VERSION,
} from "./matching.ts";

/**
 * Deep Agents run/artifact/event contracts (Rain-owned, Phase 3).
 *
 * Pure Zod schemas mirroring the Python worker's Pydantic models under
 * src/features/expansion/agent/worker. The committed JSON fixtures under
 * src/features/expansion/agent/fixtures round-trip through both validators.
 * Unknown versions, unknown fields, unknown candidate IDs and invalid
 * numbers are rejected on both sides — schema changes require a version
 * bump and a migration note in the ledger, never silent drift.
 */

export const AGENT_RUN_VERSION = "expansion-agent-run-v1";
export const AGENT_ARTIFACT_VERSION = "expansion-agent-artifact-v1";
export const AGENT_EVENT_VERSION = "expansion-agent-event-v1";
export const READINESS_TOOL_VERSION = "expansion-readiness-tool-v1";
export const MARKET_TOOL_VERSION = "expansion-market-tool-v1";
export const INSPECTION_TOOL_VERSION = "expansion-inspection-tool-v1";

const id = z.string().min(1).max(300);
const iso = z.iso.datetime();
const nonnegative = z.number().finite().nonnegative();

export const agentRunStatuses = [
  "queued",
  "running",
  "completed",
  "completed_with_gaps",
  "failed",
  "cancelled",
] as const;
export type AgentRunStatus = (typeof agentRunStatuses)[number];

export const agentStages = [
  "readiness",
  "market",
  "site_scout",
  "space_inspector",
  "finance",
] as const;
export type AgentStage = (typeof agentStages)[number];
export const AGENT_STAGE_LABELS: Record<AgentStage, string> = {
  readiness: "Readiness",
  market: "Market",
  site_scout: "Site scout",
  space_inspector: "Space inspector",
  finance: "Finance",
};

export const agentStageStatuses = [
  "completed",
  "unavailable",
  "failed",
  "not_run",
] as const;
export type AgentStageStatus = (typeof agentStageStatuses)[number];

export const executionModes = ["live", "scripted"] as const;
export type ExecutionMode = (typeof executionModes)[number];

// ---------------------------------------------------------------------------
// Run request + record

export const agentFinanceInputsSchema = z.object({
  fixedCostsMonthly: nonnegative.nullable(),
  contributionMargin: z.number().finite().min(0).max(1).nullable(),
  origin: z.enum(["derived", "unavailable"]),
  reasons: z.array(z.string().min(1)),
});
export type AgentFinanceInputs = z.infer<typeof agentFinanceInputsSchema>;

/** profile.json — written once by the server at run creation. */
export const profileArtifactSchema = z
  .object({
    artifactVersion: z.literal(AGENT_ARTIFACT_VERSION),
    modelVersion: z.literal("expansion-requirements-v1"),
    intakeSchemaVersion: z.literal("1.0"),
    revisionId: id,
    revisionNumber: z.number().int().nonnegative(),
    cityId: id,
    intake: intakeSchema,
    requirements: searchRequirementsSchema,
    followUpQuestions: z.array(
      z.object({
        field: z.string().min(1),
        question: z.string().min(1),
        neededFor: z.string().min(1),
        blocksInitialSearch: z.boolean(),
      }),
    ),
    financeInputs: agentFinanceInputsSchema,
  })
  .superRefine((artifact, ctx) => {
    if (artifact.requirements.revisionId !== artifact.revisionId) {
      ctx.addIssue({ code: "custom", message: "Requirements revision id does not match the artifact." });
    }
    if (artifact.requirements.revisionNumber !== artifact.revisionNumber) {
      ctx.addIssue({ code: "custom", message: "Requirements revision number does not match the artifact." });
    }
  });
export type ProfileArtifact = z.infer<typeof profileArtifactSchema>;

export const agentRunRecordSchema = z.object({
  version: z.literal(AGENT_RUN_VERSION),
  runId: id,
  sessionId: id,
  status: z.enum(agentRunStatuses),
  executionMode: z.enum(executionModes),
  createdAt: iso,
  updatedAt: iso,
  completedAt: iso.nullable(),
  cancelledAt: iso.nullable(),
  cityId: id,
  datasetId: z.string().min(1).nullable(),
  datasetDate: z.string().nullable(),
  profile: z.object({
    revisionId: id,
    revisionNumber: z.number().int().nonnegative(),
  }),
  requirementsHash: z.string().min(1),
  model: z
    .object({
      framework: z.string().min(1),
      provider: z.string().min(1).nullable(),
      modelId: z.string().min(1).nullable(),
      label: z.string().min(1),
    })
    .nullable(),
  toolCalls: z.record(z.string().min(1), z.number().int().nonnegative()),
  stages: z.record(z.enum(agentStages), z.enum(agentStageStatuses)),
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }).nullable(),
});
export type AgentRunRecord = z.infer<typeof agentRunRecordSchema>;

// ---------------------------------------------------------------------------
// Specialized artifacts

export const marketArtifactSchema = z.object({
  artifactVersion: z.literal(AGENT_ARTIFACT_VERSION),
  modelVersion: z.literal(MARKET_TOOL_VERSION),
  runId: id,
  cityId: id,
  sourced: z.boolean(),
  dataset: z
    .object({
      datasetId: z.string().min(1),
      datasetDate: z.string().nullable(),
      propertyCount: z.number().int().nonnegative(),
      listingCount: z.number().int().nonnegative(),
      spaceCount: z.number().int().nonnegative(),
      mappableCount: z.number().int().nonnegative(),
    })
    .nullable(),
  sourceCapabilities: z.array(
    z.object({
      source: z.string().min(1),
      status: z.enum(["available", "configured", "not_configured", "unavailable"]),
      reason: z.string().min(1),
      detail: z.string().min(1).nullable(),
    }),
  ),
  unavailableReasons: z.array(z.string().min(1)),
});
export type MarketArtifact = z.infer<typeof marketArtifactSchema>;

export const searchCountsSchema = z.object({
  examined: z.number().int().nonnegative(),
  included: z.number().int().nonnegative(),
  excluded: z.number().int().nonnegative(),
  offMarket: z.number().int().nonnegative(),
  unknownMarketingStatus: z.number().int().nonnegative(),
  incompatibleUse: z.number().int().nonnegative(),
  useUnknown: z.number().int().nonnegative(),
  scanCapped: z.boolean(),
  meets: z.number().int().nonnegative(),
  needsVerification: z.number().int().nonnegative(),
  doesNotMeet: z.number().int().nonnegative(),
});
export type AgentSearchCounts = z.infer<typeof searchCountsSchema>;

export const excludedCandidateSchema = z.object({
  id: id,
  name: z.string().min(1),
  reasonCode: z.enum(["off_market", "unknown_marketing_status", "incompatible_space_use"]),
  reason: z.string().min(1),
});
export type AgentExcludedCandidate = z.infer<typeof excludedCandidateSchema>;

/** candidates.json — written by the scout.search_city tool. */
export const searchArtifactSchema = z.object({
  artifactVersion: z.literal(AGENT_ARTIFACT_VERSION),
  modelVersion: z.literal("expansion-search-v1"),
  matchingModelVersion: z.literal(MATCHING_MODEL_VERSION),
  requirementsModelVersion: z.literal("expansion-requirements-v1"),
  runId: id,
  cityId: id,
  datasetId: z.string().min(1).nullable(),
  datasetDate: z.string().nullable(),
  searchedAt: iso,
  cancelled: z.boolean(),
  requirements: searchRequirementsSchema,
  counts: searchCountsSchema,
  candidates: z.array(assessedCandidateSchema),
  excluded: z.array(excludedCandidateSchema),
  excludedTruncated: z.boolean(),
});
export type SearchArtifact = z.infer<typeof searchArtifactSchema>;

/** inspection.json — written by the inspector.evidence tool. */
export const inspectionArtifactSchema = z.object({
  artifactVersion: z.literal(AGENT_ARTIFACT_VERSION),
  modelVersion: z.literal(INSPECTION_TOOL_VERSION),
  runId: id,
  inspectedAt: iso,
  candidates: z.array(
    z.object({
      candidateId: id,
      name: z.string().min(1),
      candidate: candidateSchema,
      assessments: z.array(assessmentSchema),
      gaps: z.array(assessmentSchema),
      verificationTasks: z.array(z.string().min(1)),
    }),
  ),
  notFoundIds: z.array(id),
});
export type InspectionArtifact = z.infer<typeof inspectionArtifactSchema>;

export const financeArtifactSchema = z.object({
  artifactVersion: z.literal(AGENT_ARTIFACT_VERSION),
  modelVersion: z.literal("expansion-finance-tool-v1"),
  runId: id,
  evaluatedAt: iso,
  occupancy: z.array(
    z.union([
      z.object({
        candidateId: id,
        known: z.literal(true),
        low: nonnegative,
        high: nonnegative.nullable(),
        notes: z.array(z.string()),
        reasonCode: z.null(),
        reason: z.null(),
        serviceInclusion: z.enum(["included", "not_included", "unknown"]),
      }),
      z.object({
        candidateId: id,
        known: z.literal(false),
        low: z.null(),
        high: z.null(),
        notes: z.array(z.string()),
        reasonCode: z.string().min(1),
        reason: z.string().min(1),
        serviceInclusion: z.enum(["included", "not_included", "unknown"]),
      }),
    ]),
  ),
  requiredSales: z
    .object({
      status: z.enum(["available", "unavailable"]),
      requiredSalesMonthly: nonnegative.nullable(),
      reason: z.string().min(1).nullable(),
      fixedCostsMonthly: nonnegative.nullable(),
      contributionMargin: z.number().finite().min(0).max(1).nullable(),
      inputOrigin: z.enum(["derived", "unavailable"]),
    })
    .nullable(),
  missingInputs: z.array(z.string().min(1)),
  assumptions: z.array(z.string().min(1)),
});
export type FinanceArtifact = z.infer<typeof financeArtifactSchema>;

export const summaryArtifactSchema = z.object({
  artifactVersion: z.literal(AGENT_ARTIFACT_VERSION),
  modelVersion: z.literal(AGENT_RUN_VERSION),
  runId: id,
  executionMode: z.enum(executionModes),
  terminalStatus: z.enum(["completed", "completed_with_gaps"]),
  stageReports: z.array(
    z.object({
      stage: z.enum(agentStages),
      status: z.enum(agentStageStatuses),
      digest: z.string().min(1),
      candidateIds: z.array(id),
      missing: z.array(z.string().min(1)),
    }),
  ),
  summaryText: z.string().min(1),
  missingEvidence: z.array(z.string().min(1)),
  followUps: z.array(z.string().min(1)),
  assumptions: z.array(z.string().min(1)),
  groundedCandidateIds: z.array(id),
  completedAt: iso,
});
export type SummaryArtifact = z.infer<typeof summaryArtifactSchema>;

/**
 * Cross-artifact grounding rule (mirrors the Python worker's validation):
 * every candidate ID a summary carries must exist in the run's persisted
 * search artifact. Text from a model can never create a candidate record.
 */
export function validateSummaryAgainstSearch(
  summary: SummaryArtifact,
  search: SearchArtifact,
): void {
  if (summary.runId !== search.runId) {
    throw new Error("Summary and search artifacts belong to different runs.");
  }
  const known = new Set(search.candidates.map((item) => item.candidate.id));
  const unknown = summary.groundedCandidateIds.filter((id) => !known.has(id));
  if (unknown.length) {
    throw new Error(`Summary references candidate IDs missing from the run's search artifact: ${unknown.slice(0, 5).join(", ")}`);
  }
  for (const report of summary.stageReports) {
    const bad = report.candidateIds.filter((id) => !known.has(id));
    if (bad.length) {
      throw new Error(`Stage ${report.stage} references candidate IDs missing from the search artifact: ${bad.slice(0, 5).join(", ")}`);
    }
  }
}

export const agentArtifactNames = [
  "profile",
  "market",
  "candidates",
  "inspection",
  "finance",
  "summary",
] as const;
export type AgentArtifactName = (typeof agentArtifactNames)[number];

// ---------------------------------------------------------------------------
// Events

export const agentEventTypes = [
  "run.started",
  "stage.started",
  "stage.completed",
  "stage.incomplete",
  "tool.completed",
  "unavailable",
  "run.completed",
  "run.cancelled",
  "run.failed",
] as const;
export type AgentEventType = (typeof agentEventTypes)[number];

export const agentEventSchema = z.object({
  eventVersion: z.literal(AGENT_EVENT_VERSION),
  seq: z.number().int().positive(),
  runId: id,
  ts: iso,
  type: z.enum(agentEventTypes),
  stage: z.enum([...agentStages, "planner"]).nullable(),
  payload: z.record(z.string(), z.unknown()).nullable(),
});
export type AgentEvent = z.infer<typeof agentEventSchema>;

// ---------------------------------------------------------------------------
// Wire DTOs for the API routes

export const agentRunCreateSchema = z.object({
  runId: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
  cityId: z.string().min(1).max(100),
  intake: intakeSchema,
  revisionId: z.string().min(1).max(200),
  revisionNumber: z.number().int().nonnegative(),
  facts: z.array(factSchema).max(10000).optional(),
  executionMode: z.enum(executionModes).optional(),
});

export const agentCapabilitiesSchema = z.object({
  agentEnabled: z.boolean(),
  workerReady: z.boolean(),
  modelConfigured: z.boolean(),
  defaultMode: z.enum(executionModes),
  framework: z.string().min(1),
  labels: z.object({
    live: z.string().min(1),
    scripted: z.string().min(1),
    unavailable: z.string().min(1),
  }),
  reason: z.string().min(1).nullable(),
});

export const toolBridgeRequestSchema = z.object({
  runId: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
  tool: z.string().min(1).max(120),
  input: z.record(z.string(), z.unknown()),
});

/** What the worker is allowed to call; everything else is unknown_tool. */
export const AGENT_BRIDGE_TOOLS = [
  "profile.readiness_report",
  "market.context",
  "scout.search_city",
  "inspector.evidence",
  "finance.monthly_occupancy",
  "finance.required_sales",
] as const;
export type AgentBridgeTool = (typeof AGENT_BRIDGE_TOOLS)[number];

// ---------------------------------------------------------------------------
// Tool bridge DTOs (what the Python worker receives for each call)

export const agentRunRequestFileSchema = z.object({
  requestVersion: z.literal(AGENT_RUN_VERSION),
  runId: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  cityId: z.string().min(1).max(100),
  executionMode: z.enum(executionModes),
  createdAt: iso,
  datasetId: z.string().min(1).nullable(),
  datasetDate: z.string().nullable(),
  profile: profileArtifactSchema,
});
export type AgentRunRequestFile = z.infer<typeof agentRunRequestFileSchema>;

export const readinessToolOutputSchema = z.object({
  modelVersion: z.literal(READINESS_TOOL_VERSION),
  intakeSchemaVersion: z.literal("1.0"),
  requirementsModelVersion: z.literal("expansion-requirements-v1"),
  revisionId: id,
  revisionNumber: z.number().int().nonnegative(),
  followUpQuestions: z.array(
    z.object({
      field: z.string().min(1),
      question: z.string().min(1),
      neededFor: z.string().min(1),
      blocksInitialSearch: z.boolean(),
    }),
  ),
  completeness: z.object({
    known: z.array(z.string().min(1)),
    unknown: z.array(z.string().min(1)),
    missing: z.array(
      z.object({
        requirementId: z.string().min(1),
        label: z.string().min(1),
        neededFor: z.string().min(1),
      }),
    ),
  }),
  tacticalReport: z.null(),
  note: z.string().min(1),
});

export const marketToolOutputSchema = z.object({
  modelVersion: z.literal(MARKET_TOOL_VERSION),
  cityId: id,
  sourced: z.boolean(),
  dataset: z
    .object({
      datasetId: z.string().min(1),
      datasetDate: z.string().nullable(),
      propertyCount: z.number().int().nonnegative(),
      listingCount: z.number().int().nonnegative(),
      spaceCount: z.number().int().nonnegative(),
      mappableCount: z.number().int().nonnegative(),
    })
    .nullable(),
  sourceCapabilities: z.array(
    z.object({
      source: z.string().min(1),
      status: z.enum(["available", "configured", "not_configured", "unavailable"]),
      reason: z.string().min(1),
      detail: z.string().min(1).nullable(),
    }),
  ),
  unavailableReasons: z.array(z.string().min(1)),
});

export const scoutToolOutputSchema = z.object({
  modelVersion: z.literal("expansion-search-v1"),
  matchingModelVersion: z.literal(MATCHING_MODEL_VERSION),
  requirementsModelVersion: z.literal("expansion-requirements-v1"),
  cityId: id,
  datasetId: z.string().min(1).nullable(),
  datasetDate: z.string().nullable(),
  searchedAt: iso,
  cancelled: z.boolean(),
  counts: searchCountsSchema,
  candidateIds: z.array(id),
  /** Top-ranked candidate digests; full records live in candidates.json. */
  topCandidates: z.array(
    z.object({
      id: id,
      name: z.string().min(1),
      group: z.enum(["meets_assessed_requirements", "needs_verification", "does_not_meet"]),
      rank: z.number().int().nonnegative(),
      serviceInclusion: z.enum(["included", "not_included", "unknown"]),
      topAssessment: z.object({
        requirementId: z.string().min(1),
        status: z.enum(["pass", "fail", "unknown", "not_applicable"]),
        reasonCode: z.string().min(1),
        reason: z.string().min(1),
      }),
    }),
  ),
  excluded: z.array(excludedCandidateSchema),
  excludedTruncated: z.boolean(),
});

export const inspectionToolOutputSchema = z.object({
  modelVersion: z.literal(INSPECTION_TOOL_VERSION),
  inspected: z.array(
    z.object({
      candidateId: id,
      name: z.string().min(1),
      candidate: candidateSchema,
      assessments: z.array(assessmentSchema),
      gaps: z.array(assessmentSchema),
      verificationTasks: z.array(z.string().min(1)),
    }),
  ),
  notFoundIds: z.array(id),
});
