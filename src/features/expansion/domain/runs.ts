import { z } from "zod";
import { intakeSchema } from "./intake.ts";
import { searchRequirementsSchema } from "./requirements.ts";
import { assessedCandidateSchema, candidateGroups } from "./matching.ts";
import { agentStateSchema } from "./agent.ts";

/**
 * Run wire contracts (Rain-owned, shared by backend and frontend).
 * Pure Zod schemas only — no filesystem or server imports.
 */

export const RUN_STORAGE_VERSION = "expansion-run-v1";

export const runStatuses = [
  "queued",
  "running",
  "completed",
  "completed_with_gaps",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof runStatuses)[number];

const id = z.string().min(1);
const iso = z.iso.datetime();

export const runSchema = z.object({
  version: z.literal(RUN_STORAGE_VERSION),
  runId: id,
  sessionId: id,
  status: z.enum(runStatuses),
  createdAt: iso,
  updatedAt: iso,
  completedAt: iso.nullable(),
  cancelledAt: iso.nullable(),
  cityId: id,
  dataMode: z.literal("local"),
  datasetId: z.string().min(1).nullable(),
  datasetDate: z.string().nullable(),
  requirementsHash: z.string().min(1),
  profile: z.object({
    revisionId: id,
    revisionNumber: z.number().int().nonnegative(),
    intake: intakeSchema,
    requirements: searchRequirementsSchema,
  }),
  counts: z.object({
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
  }),
  searchedAt: iso.nullable(),
  error: z
    .object({ code: z.string().min(1), message: z.string().min(1) })
    .nullable(),
  executionMode: z.enum(["deterministic", "agent"]).optional(),
  agent: agentStateSchema.optional(),
});
export type RunRecord = z.infer<typeof runSchema>;
export type RunCounts = z.infer<typeof runSchema>["counts"];

export const excludedCandidateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  reasonCode: z.enum(["off_market", "unknown_marketing_status", "incompatible_space_use"]),
  reason: z.string().min(1),
});
export type ExcludedCandidate = z.infer<typeof excludedCandidateSchema>;

export const runCandidatesPageSchema = z.object({
  runId: id,
  status: z.enum(runStatuses),
  total: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  group: z.enum(candidateGroups).nullable(),
  candidates: z.array(assessedCandidateSchema),
  excluded: z.array(excludedCandidateSchema),
  excludedTruncated: z.boolean(),
  counts: z.object({
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
  }),
});
export type RunCandidatesPage = z.infer<typeof runCandidatesPageSchema>;

export const intakeValidationResponseSchema = z.object({
  modelVersion: z.string().min(1),
  intakeSchemaVersion: z.string().min(1),
  followUpQuestions: z.array(
    z.object({
      field: z.string().min(1),
      question: z.string().min(1),
      neededFor: z.string().min(1),
      blocksInitialSearch: z.boolean(),
    }),
  ),
  requirements: searchRequirementsSchema,
});
export type IntakeValidationResponse = z.infer<typeof intakeValidationResponseSchema>;
