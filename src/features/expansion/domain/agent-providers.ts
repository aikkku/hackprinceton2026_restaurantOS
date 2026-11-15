import { z } from "zod";
import { scopeSchema } from "./agent-scope.ts";
import { candidateSchema, factSchema } from "./matching.ts";
import { evidenceSchema, originSchema } from "./schemas.ts";
import { requiredSalesInputSchema } from "./scenario.ts";

/** Phase 3/4 boundary only. Implementations and source credentials belong to Phase 4. */
export const PROVIDER_CONTRACT_VERSION = "expansion-agent-providers-v1";
const common = { version: z.literal(PROVIDER_CONTRACT_VERSION), scope: scopeSchema };
const result = { ...common, status: z.enum(["available", "partial", "unavailable"]), evidence: z.array(evidenceSchema).max(100), gaps: z.array(z.string()).max(50) };
export const marketContextItemSchema = z.strictObject({
  label: z.string().min(1).max(200), value: z.string().max(1000).nullable(), origin: originSchema,
  evidenceIds: z.array(z.string().min(1)).max(20),
});
export const marketProviderRequestSchema = z.strictObject({ ...common, cityId: z.string().min(1) });
export const marketProviderResultSchema = z.strictObject({ ...result, cityId: z.string().min(1), context: z.array(marketContextItemSchema).max(30) });
export const inspectionProviderRequestSchema = z.strictObject({ ...common, candidate: candidateSchema, evidenceIds: z.array(z.string().min(1)).max(100) });
export const inspectionProviderResultSchema = z.strictObject({ ...result, candidateId: z.string().min(1), facts: z.array(factSchema).max(100) });
export const financeProviderRequestSchema = z.strictObject({ ...common, candidateId: z.string().min(1), evidenceIds: z.array(z.string().min(1)).max(100) });
export const financeProviderResultSchema = z.strictObject({
  ...result, candidateId: z.string().min(1), inputs: requiredSalesInputSchema.nullable(),
  inputEvidenceIds: z.array(z.string().min(1)).max(100), assumptions: z.array(z.string()).max(30),
});
export type AgentProviderAdapters = {
  market?: (request: z.infer<typeof marketProviderRequestSchema>, signal: AbortSignal) => Promise<z.infer<typeof marketProviderResultSchema>>;
  inspect?: (request: z.infer<typeof inspectionProviderRequestSchema>, signal: AbortSignal) => Promise<z.infer<typeof inspectionProviderResultSchema>>;
  financeInputs?: (request: z.infer<typeof financeProviderRequestSchema>, signal: AbortSignal) => Promise<z.infer<typeof financeProviderResultSchema>>;
};
