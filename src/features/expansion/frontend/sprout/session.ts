import { z } from "zod";
import { briefChoiceSchema, type BriefChoice } from "../../domain/decision-brief.ts";

/**
 * Per-browser convenience state for the sprout Expansion flow: which run the
 * owner was last looking at, which places they saved, which one they picked
 * and their in-progress cost answers. It is a resumable pointer, never a
 * source of truth: the run, its candidates and evidence are always reloaded
 * from the server, and saved plans live in the decision-brief stores.
 */
export const SEARCH_SESSION_KEY = "restaurantos.expansion.sprout.session.v1";
export const MAX_SAVED_PLACES = 3;

export const searchSessionSchema = z.object({
  version: z.literal(1),
  source: z.enum(["agent", "deterministic"]),
  runId: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/),
  cityLabel: z.string().min(1).max(120),
  placesFound: z.number().int().nonnegative(),
  profileRevisionId: z.string().min(1),
  saved: z.array(z.string().min(1)).max(MAX_SAVED_PLACES),
  pick: z.string().min(1).nullable(),
  choices: z.array(briefChoiceSchema).max(20),
  updatedAt: z.iso.datetime(),
});
export type SearchSession = z.infer<typeof searchSessionSchema>;

export function readSearchSession(storage: Pick<Storage, "getItem">): SearchSession | null {
  try {
    const raw = storage.getItem(SEARCH_SESSION_KEY);
    if (!raw) return null;
    const parsed = searchSessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeSearchSession(storage: Pick<Storage, "setItem">, session: SearchSession): boolean {
  try {
    storage.setItem(SEARCH_SESSION_KEY, JSON.stringify(searchSessionSchema.parse(session)));
    return true;
  } catch {
    return false;
  }
}

export function clearSearchSession(storage: Pick<Storage, "removeItem">) {
  try { storage.removeItem(SEARCH_SESSION_KEY); } catch { /* storage is optional */ }
}

/** Keep only choices the owner touched (saved or picked) so storage stays small. */
export function choicesToKeep(choices: Record<string, BriefChoice>, saved: string[], pick: string | null): BriefChoice[] {
  const keep = new Set([...saved, ...(pick ? [pick] : [])]);
  return Object.values(choices).filter((choice) => keep.has(choice.candidateId));
}
