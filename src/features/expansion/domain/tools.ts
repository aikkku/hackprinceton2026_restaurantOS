import { z } from "zod";
import {
  assessCandidates,
  assessmentReportSchema,
  assessmentSchema,
  candidateSchema,
  evaluateCandidate,
  factSchema,
  groupFor,
  MATCHING_MODEL_VERSION,
  monthlyOccupancyRange,
  serviceInclusion,
  type RequirementAssessment,
  type ServiceInclusion,
  type SpaceCandidate,
} from "./matching.ts";
import { searchRequirementsSchema, type SearchRequirements } from "./requirements.ts";
import {
  requiredSalesInputSchema,
  requiredSalesMonthly,
  requiredSalesOutputSchema,
  FINANCE_TOOL_VERSION,
} from "./scenario.ts";

/**
 * Callable deterministic tool catalog (Rain-owned).
 *
 * Phase 3's Python Deep Agents worker invokes these tools through the
 * documented JSON contracts; the model proposes inputs and explains outputs
 * but never calculates canonical results. Tools are pure TypeScript and
 * schema-validate both sides of the boundary.
 */

export const TOOL_CATALOG_VERSION = "expansion-tools-v1";

export class ToolError extends Error {
  code: "unknown_tool" | "invalid_input" | "tool_failed";
  constructor(code: ToolError["code"], message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}

export type ToolDefinition<Input, Output> = {
  name: string;
  version: string;
  description: string;
  input: z.ZodType<Input>;
  output: z.ZodType<Output>;
  invoke: (input: Input) => Output;
};

export const evaluateSpaceTool: ToolDefinition<
  {
    candidate: SpaceCandidate;
    requirements: SearchRequirements;
    facts?: z.infer<typeof factSchema>[];
  },
  { modelVersion: string; assessments: RequirementAssessment[]; group: string }
> = {
  name: "match.evaluate_space",
  version: MATCHING_MODEL_VERSION,
  description:
    "Assess one offered space against a normalized profile revision and return per-requirement pass/fail/unknown assessments with reason codes plus the candidate group. Hard failures reject; hard unknowns need verification.",
  input: z.object({
    candidate: candidateSchema,
    requirements: searchRequirementsSchema,
    facts: z.array(factSchema).max(100).default([]),
  }),
  output: z.object({
    modelVersion: z.string().min(1),
    assessments: z.array(assessmentSchema).min(1),
    group: z.string().min(1),
  }),
  invoke({ candidate, requirements, facts }) {
    const assessments = evaluateCandidate(candidate, requirements, facts ?? []);
    return {
      modelVersion: MATCHING_MODEL_VERSION,
      assessments,
      group: groupFor(assessments),
    };
  },
};

export const evaluateCandidatesTool: ToolDefinition<
  {
    candidates: SpaceCandidate[];
    requirements: SearchRequirements;
    facts?: z.infer<typeof factSchema>[];
  },
  z.infer<typeof assessmentReportSchema>
> = {
  name: "match.evaluate_candidates",
  version: MATCHING_MODEL_VERSION,
  description:
    "Assess every supplied offered space, group them (meets assessed requirements / needs verification / does not meet) and return the deterministic explained ordering with counts.",
  input: z.object({
    candidates: z.array(candidateSchema).max(5000),
    requirements: searchRequirementsSchema,
    facts: z.array(factSchema).max(10000).default([]),
  }),
  output: assessmentReportSchema,
  invoke({ candidates, requirements, facts }) {
    return assessCandidates(candidates, requirements, facts ?? []);
  },
};

export const requiredSalesTool: ToolDefinition<
  z.infer<typeof requiredSalesInputSchema>,
  z.infer<typeof requiredSalesOutputSchema>
> = {
  name: "finance.required_sales",
  version: FINANCE_TOOL_VERSION,
  description:
    "Compute required monthly sales from known fixed monthly costs and a positive contribution margin. A zero margin or missing inputs are unavailable with a reason, never defaults.",
  input: requiredSalesInputSchema,
  output: requiredSalesOutputSchema,
  invoke: requiredSalesMonthly,
};

export const occupancyRangeToolOutputSchema = z.discriminatedUnion("known", [
  z.object({
    known: z.literal(true),
    low: z.number().finite().nonnegative(),
    high: z.number().finite().nonnegative().nullable(),
    notes: z.array(z.string()),
    serviceInclusion: z.enum(["included", "not_included", "unknown"]),
  }),
  z.object({
    known: z.literal(false),
    reasonCode: z.string().min(1),
    reason: z.string().min(1),
    serviceInclusion: z.enum(["included", "not_included", "unknown"]),
  }),
]);

export const occupancyRangeTool: ToolDefinition<
  {
    candidate: SpaceCandidate;
    extrasMonthly: number | null;
    inclusion: ServiceInclusion;
  },
  z.infer<typeof occupancyRangeToolOutputSchema>
> = {
  name: "finance.monthly_occupancy",
  version: FINANCE_TOOL_VERSION,
  description:
    "Normalize a space's quoted rent into a monthly total-occupancy range. Included charges are never added twice; unsupported units and unknown components stay unknown.",
  input: z.object({
    candidate: candidateSchema,
    extrasMonthly: z.number().finite().nonnegative().nullable(),
    inclusion: z.enum(["included", "not_included", "unknown"]),
  }),
  output: occupancyRangeToolOutputSchema,
  invoke({ candidate, extrasMonthly, inclusion }) {
    const result = monthlyOccupancyRange(candidate, extrasMonthly, inclusion);
    if ("unknown" in result) {
      return occupancyRangeToolOutputSchema.parse({
        known: false as const,
        reasonCode: result.reasonCode,
        reason: result.reason,
        serviceInclusion: inclusion,
      });
    }
    return occupancyRangeToolOutputSchema.parse({
      known: true as const,
      low: result.known.low,
      high: result.known.high,
      notes: result.notes,
      serviceInclusion: inclusion,
    });
  },
};

export const TOOLS = [
  evaluateSpaceTool,
  evaluateCandidatesTool,
  requiredSalesTool,
  occupancyRangeTool,
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

/**
 * Manifest without functions, for documentation and cross-language consumers.
 * Python must not reimplement the arithmetic; it calls these contracts.
 */
export const toolsManifest = TOOLS.map(({ name, version, description, input, output }) => ({
  name,
  version,
  description,
  input: input.description ?? name,
  output: output.description ?? name,
}));

export function invokeTool(name: string, input: unknown) {
  const tool = TOOLS.find((entry) => entry.name === name);
  if (!tool) {
    throw new ToolError("unknown_tool", `Unknown tool "${name}". Available: ${TOOLS.map((entry) => entry.name).join(", ")}.`);
  }
  let parsed: unknown;
  try {
    parsed = tool.input.parse(input);
  } catch (error) {
    throw new ToolError(
      "invalid_input",
      error instanceof Error ? error.message : "Tool input failed validation.",
    );
  }
  try {
    const invoke = (tool as { invoke: (value: unknown) => unknown }).invoke;
    return invoke(parsed);
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw new ToolError(
      "tool_failed",
      error instanceof Error ? error.message : "The tool failed.",
    );
  }
}

export { serviceInclusion };
