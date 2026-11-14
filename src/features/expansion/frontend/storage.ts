import { calculateScenario } from "../domain/scenario.ts";
import { savedScenariosSchema, type Scenario } from "../domain/schemas.ts";
import {
  profileRevisionSchema,
  type ProfileRevision,
} from "../domain/requirements.ts";
import { PROFILE_DRAFT_SCHEMA_VERSION } from "../domain/intake.ts";
import { z } from "zod";

export const STORAGE_KEY = "restaurantos.expansion.demo.scenarios.v1";
export const LOCAL_STORAGE_KEY = "restaurantos.expansion.local.scenarios.v2";
export const MODE_STORAGE_KEY = "restaurantos.expansion.mode";
export const PROFILE_DRAFT_STORAGE_KEY = "restaurantos.expansion.profile.draft.v1";

export const storageKeyFor = (mode: "demo" | "local") =>
  mode === "local" ? LOCAL_STORAGE_KEY : STORAGE_KEY;

export function decodeScenarios(raw: string | null): Scenario[] {
  if (raw === null) return [];
  const scenarios = savedScenariosSchema.parse(JSON.parse(raw));
  if (new Set(scenarios.map((x) => x.id)).size !== scenarios.length)
    throw new Error("Duplicate saved scenario IDs");
  for (const scenario of scenarios) {
    const expected = calculateScenario(scenario.inputs);
    for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
      if (expected[key] !== scenario.results[key])
        throw new Error("Saved results do not match their inputs");
    }
  }
  return scenarios;
}

export function persistScenarios(
  storage: Pick<Storage, "setItem">,
  scenarios: Scenario[],
  mode: "demo" | "local" = "demo",
) {
  const validated = decodeScenarios(JSON.stringify(scenarios));
  if (validated.some((scenario) => scenario.isDemo !== (mode === "demo")))
    throw new Error("Snapshot data mode does not match its storage key");
  storage.setItem(storageKeyFor(mode), JSON.stringify(validated));
}

// ---------------------------------------------------------------------------
// Profile draft storage (Expansion-local, versioned).
//
// The profile draft envelope holds every immutable profile revision under
// PROFILE_DRAFT_STORAGE_KEY. Existing scenario keys and Tactical storage are
// never touched. Corrupt or unknown-version content is preserved untouched
// until the user explicitly resets it; storage write failures propagate so
// callers can keep in-memory edits.

export const profileDraftEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(PROFILE_DRAFT_SCHEMA_VERSION),
    updatedAt: z.iso.datetime(),
    revisions: z.array(profileRevisionSchema).min(1),
  })
  .superRefine((envelope, ctx) => {
    const sorted = [...envelope.revisions].sort(
      (a, b) => a.revisionNumber - b.revisionNumber,
    );
    if (sorted.some((revision, index) => revision.revisionNumber !== index)) {
      ctx.addIssue({
        code: "custom",
        message:
          "Profile revisions must form an unbroken sequence starting at 0.",
        path: ["revisions"],
      });
      return;
    }
    for (let index = 0; index < sorted.length; index += 1) {
      const revision = sorted[index];
      const expectedParent =
        index === 0 ? null : sorted[index - 1].revisionId;
      if (revision.parentRevisionId !== expectedParent) {
        ctx.addIssue({
          code: "custom",
          message: `Revision ${revision.revisionNumber} has a broken parent chain.`,
          path: ["revisions", index, "parentRevisionId"],
        });
      }
    }
  });

export type ProfileDraftEnvelope = z.infer<typeof profileDraftEnvelopeSchema>;

export type ProfileDraftStatus =
  | { status: "empty" }
  | { status: "ok"; envelope: ProfileDraftEnvelope }
  | { status: "corrupt"; raw: string; reason: string }
  | { status: "unsupported"; raw: string; schemaVersion: unknown };

export function currentProfileRevision(
  envelope: ProfileDraftEnvelope,
): ProfileRevision {
  return [...envelope.revisions].sort(
    (a, b) => b.revisionNumber - a.revisionNumber,
  )[0];
}

/**
 * Decode the stored profile draft. Never rewrites or deletes corrupt or
 * unsupported content: callers decide when an explicit reset happens.
 */
export function decodeProfileDraft(raw: string | null): ProfileDraftStatus {
  if (raw === null) return { status: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      status: "corrupt",
      raw,
      reason: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
  const version =
    typeof parsed === "object" && parsed !== null && "schemaVersion" in parsed
      ? (parsed as { schemaVersion: unknown }).schemaVersion
      : undefined;
  if (version !== PROFILE_DRAFT_SCHEMA_VERSION) {
    return { status: "unsupported", raw, schemaVersion: version };
  }
  const result = profileDraftEnvelopeSchema.safeParse(parsed);
  if (!result.success) {
    return { status: "corrupt", raw, reason: result.error.message };
  }
  return { status: "ok", envelope: result.data };
}

/**
 * Persist a profile draft envelope. Validates first; write errors propagate
 * so the caller can preserve in-memory edits.
 */
export function persistProfileDraft(
  storage: Pick<Storage, "setItem">,
  envelope: ProfileDraftEnvelope,
) {
  const validated = profileDraftEnvelopeSchema.parse(envelope);
  storage.setItem(PROFILE_DRAFT_STORAGE_KEY, JSON.stringify(validated));
}

/** Explicit reset of stored profile content. Propagates write errors. */
export function resetProfileDraft(storage: Pick<Storage, "removeItem">) {
  storage.removeItem(PROFILE_DRAFT_STORAGE_KEY);
}
