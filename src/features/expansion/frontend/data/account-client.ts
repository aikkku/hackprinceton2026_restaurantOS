import { z } from "zod";
import { decisionBriefSchema, type DecisionBrief } from "../../domain/decision-brief.ts";
import { sourceSnapshotSchema, type SourceSnapshot } from "../../domain/evidence.ts";
import type { ProfileDraftEnvelope } from "../storage.ts";

/**
 * Browser client for the owner session and durable workspace APIs.
 * The owner cookie is HttpOnly and issued by the server; this module never
 * sees or chooses an owner id. Every owner-scoped request first awaits
 * `ensureSession()` so concurrent first requests cannot mint two owners.
 */

export const sessionStatusSchema = z.object({
  authenticated: z.boolean(),
  issued: z.boolean().optional(),
  accessCodeRequired: z.boolean(),
  ownerHint: z.string().optional(),
  storage: z.object({ mode: z.string(), configured: z.boolean() }),
});
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export class AccountError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "AccountError";
    this.code = code;
    this.status = status;
  }
}

let sessionPromise: Promise<SessionStatus> | null = null;

export function ensureSession(): Promise<SessionStatus> {
  sessionPromise ??= fetch("/api/expansion/session", { cache: "no-store", credentials: "same-origin" })
    .then(async (response) => sessionStatusSchema.parse(await response.json()))
    .catch((error) => {
      sessionPromise = null;
      throw error;
    });
  return sessionPromise;
}

export async function unlockSession(accessCode: string): Promise<SessionStatus> {
  const response = await fetch("/api/expansion/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessCode }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new AccountError(body?.error?.code ?? "unauthenticated", body?.error?.message ?? "The access code was not accepted.", response.status);
  const status = sessionStatusSchema.parse(body);
  sessionPromise = Promise.resolve(status);
  return status;
}

async function call<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  await ensureSession().catch(() => null);
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AccountError(body?.error?.code ?? "request_failed", body?.error?.message ?? "Account storage could not be reached. Browser copies are kept.", response.status);
  }
  return schema.parse(body);
}

const briefRecordSchema = z.object({
  brief: decisionBriefSchema,
  provenance: z.enum(["app", "browser_import"]),
  runVerified: z.boolean(),
  storedAt: z.string(),
});
export type AccountBrief = z.infer<typeof briefRecordSchema>;

export const listAccountBriefs = () =>
  call("/api/expansion/briefs", z.object({ briefs: z.array(briefRecordSchema), storage: z.string() }));

export const saveAccountBrief = (brief: DecisionBrief) =>
  call("/api/expansion/briefs", briefRecordSchema.extend({ result: z.string(), storage: z.string() }), { method: "POST", body: JSON.stringify({ brief }) });

export const loadAccountProfile = () =>
  call("/api/expansion/profiles", z.object({ envelope: z.unknown().nullable(), storage: z.string() }));

export const saveAccountProfile = (envelope: ProfileDraftEnvelope) =>
  call("/api/expansion/profiles", z.object({ profileId: z.string(), revisions: z.array(z.object({ revisionId: z.string(), revisionNumber: z.number(), result: z.string() })), storage: z.string() }), { method: "POST", body: JSON.stringify({ envelope }) });

const importItemSchema = z.object({ kind: z.enum(["profile", "brief"]), id: z.string().nullable(), status: z.enum(["imported", "duplicate", "rejected"]), reason: z.string().nullable() });
export type ImportItem = z.infer<typeof importItemSchema>;

/** Explicit import of browser copies. The caller must never delete originals. */
export const importBrowserCopies = (payload: { profileDraft?: unknown; briefs?: unknown[] }) =>
  call("/api/expansion/imports", z.object({ items: z.array(importItemSchema), storage: z.string() }), { method: "POST", body: JSON.stringify(payload) });

const agentEvidenceSchema = z.object({ snapshots: z.array(sourceSnapshotSchema) }).passthrough().nullable();

/** Phase 4 live source snapshots the agent run attached to inspected spaces (may be null). */
export async function loadAgentEvidence(runId: string, signal?: AbortSignal): Promise<Map<string, SourceSnapshot>> {
  await ensureSession().catch(() => null);
  try {
    const response = await fetch(`/api/expansion/agent-runs/${encodeURIComponent(runId)}/artifacts/evidence`, { cache: "no-store", signal });
    if (!response.ok) return new Map();
    const parsed = agentEvidenceSchema.parse(await response.json());
    return new Map((parsed?.snapshots ?? []).map((snapshot) => [snapshot.candidateId, snapshot]));
  } catch {
    return new Map();
  }
}
