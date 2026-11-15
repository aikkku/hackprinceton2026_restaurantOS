import { z } from "zod";

export const AGENT_VERSION = "expansion-agent-v1";
export const scopeSchema = z.strictObject({
  runId: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  revisionId: z.string().min(1).max(200),
  datasetId: z.string().min(1).max(200),
  snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
});
export type AgentScope = z.infer<typeof scopeSchema>;
