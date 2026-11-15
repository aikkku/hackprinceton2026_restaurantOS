import { z } from "zod";
import { assessedCandidateSchema } from "./matching.ts";
import { occupancyRangeToolOutputSchema } from "./tools.ts";
import { requiredSalesOutputSchema } from "./scenario.ts";
import { AGENT_VERSION, scopeSchema } from "./agent-scope.ts";
import { marketProviderResultSchema, inspectionProviderResultSchema, financeProviderResultSchema } from "./agent-providers.ts";
export { AGENT_VERSION, scopeSchema, type AgentScope } from "./agent-scope.ts";

/** Additive, independently versioned extension; Phase 2 run-v1 remains readable. */
export const SPECIALISTS = ["readiness", "market", "site_scout", "space_inspector", "finance"] as const;
export const ARTIFACTS = ["profile.json", "market.json", "candidates.json", "inspection.json", "finance.json", "summary.json"] as const;
export const bridgeRequestSchema = z.strictObject({
  version: z.literal(AGENT_VERSION),
  id: z.number().int().positive().max(24),
  token: z.string().regex(/^[a-f0-9]{64}$/),
  scope: scopeSchema,
  operation: z.enum([...SPECIALISTS, "finalize"]),
  // No arbitrary queries, source text, paths, URLs, scores or numeric overrides.
  artifactRefs: z.array(z.enum(ARTIFACTS)).max(6),
});
export type BridgeRequest = z.infer<typeof bridgeRequestSchema>;
export const agentEventSchema = z.strictObject({
  version: z.literal(AGENT_VERSION),
  runId: z.string().min(1),
  seq: z.number().int().positive(),
  at: z.iso.datetime(),
  type: z.enum(["run_started", "stage_started", "tool_completed", "stage_completed", "unavailable", "error", "completed", "cancelled"]),
  stage: z.enum([...SPECIALISTS, "planner"]).nullable(),
  // Controlled server-authored summaries only, never model reasoning or payloads.
  message: z.string().min(1).max(500),
});
export type AgentEvent = z.infer<typeof agentEventSchema>;
const state = { status: z.enum(["available", "partial", "unavailable"]), evidenceIds: z.array(z.string().min(1)).max(100) };
export const profileArtifactSchema = z.strictObject({
  ...state,
  totalOccupancyCap: z.number().nonnegative(),
  emergencyReserve: z.number().nonnegative().nullable(),
  seats: z.strictObject({ minimum: z.number().nonnegative(), maximum: z.number().nonnegative(), isHardRequirement: z.boolean() }),
  kitchenRequired: z.boolean(), parkingRequired: z.boolean(),
  followUps: z.array(z.strictObject({ field: z.string(), question: z.string(), neededFor: z.string(), blocksInitialSearch: z.boolean() })),
  tacticalReport: z.literal("unavailable"),
});
export const marketArtifactSchema = z.strictObject({
  ...state, cityId: z.string(), propertyCount: z.number().int().nonnegative(), offeredSpaceCount: z.number().int().nonnegative(),
  limitations: z.array(z.string()),
  providerResult: marketProviderResultSchema.optional(),
});
export const candidatesArtifactSchema = z.strictObject({
  ...state, total: z.number().int().nonnegative(), examined: z.number().int().nonnegative(),
  finalists: z.array(assessedCandidateSchema).max(3), modelVersion: z.string(),
});
export const inspectionArtifactSchema = z.strictObject({
  ...state,
  spaces: z.array(z.strictObject({ candidateId: z.string(), evidenceIds: z.array(z.string()), gaps: z.array(z.string()), assessments: assessedCandidateSchema.shape.assessments, providerResult: inspectionProviderResultSchema.optional() })).max(3),
  limitations: z.array(z.string()),
});
export const financeArtifactSchema = z.strictObject({
  ...state,
  spaces: z.array(z.strictObject({ candidateId: z.string(), occupancy: occupancyRangeToolOutputSchema, sales: requiredSalesOutputSchema, providerResult: financeProviderResultSchema.optional() })).max(3),
  availableCash: z.number().finite().nonnegative().nullable(), missingInputs: z.array(z.string()), explanation: z.string(),
});
export const summaryArtifactSchema = z.strictObject({
  ...state, candidateIds: z.array(z.string()).max(3), gaps: z.array(z.string()), explanation: z.string(),
});
export const artifactsSchema = z.strictObject({
  "profile.json": profileArtifactSchema.optional(),
  "market.json": marketArtifactSchema.optional(),
  "candidates.json": candidatesArtifactSchema.optional(),
  "inspection.json": inspectionArtifactSchema.optional(),
  "finance.json": financeArtifactSchema.optional(),
  "summary.json": summaryArtifactSchema.optional(),
});
export const agentStateSchema = z.strictObject({
  version: z.literal(AGENT_VERSION),
  scope: scopeSchema.nullable(),
  events: z.array(agentEventSchema).max(128),
  artifacts: artifactsSchema,
  delegated: z.array(z.enum(SPECIALISTS)).max(5),
  toolCalls: z.number().int().nonnegative().max(24),
  model: z.string().max(100),
});
export type AgentState = z.infer<typeof agentStateSchema>;

/** SSE IDs are run-local; reject cursors that could suppress unseen events. */
export function replayEvents(events: AgentEvent[], cursor: number) {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > (events.at(-1)?.seq ?? 0)) throw new Error("Invalid event cursor");
  return events.filter((event) => event.seq > cursor);
}
export function encodeSSE(event: AgentEvent) {
  return `id: ${event.seq}\nevent: progress\ndata: ${JSON.stringify(event)}\n\n`;
}
