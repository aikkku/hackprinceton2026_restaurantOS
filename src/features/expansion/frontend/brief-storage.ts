import { z } from "zod";
import { decisionBriefSchema, type DecisionBrief } from "../domain/decision-brief.ts";

export const BRIEF_STORAGE_KEY = "restaurantos.expansion.decision-briefs.v1";
const envelopeSchema = z.object({ schemaVersion: z.literal(1), briefs: z.array(decisionBriefSchema).max(10) }).refine(x => new Set(x.briefs.map(b => b.id)).size === x.briefs.length, "Duplicate brief IDs.");
export type BriefStorageState = { status: "ok"; briefs: DecisionBrief[] } | { status: "corrupt" | "unsupported"; raw: string; reason: string };
/** Never migrates by discarding source content or writing other scenario keys. */
export function decodeBriefs(raw: string | null): BriefStorageState {
  if (raw === null) return { status: "ok", briefs: [] };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("schemaVersion" in value) || value.schemaVersion !== 1) return { status: "unsupported", raw, reason: "Unknown brief version preserved. Reset explicitly to save new briefs." };
    const parsed = envelopeSchema.safeParse(value);
    return parsed.success ? { status: "ok", briefs: parsed.data.briefs } : { status: "corrupt", raw, reason: "Brief data or calculations are invalid; original content preserved." };
  } catch { return { status: "corrupt", raw, reason: "Unreadable brief data preserved." }; }
}
export function persistBriefs(storage: Pick<Storage, "getItem" | "setItem">, briefs: DecisionBrief[]) {
  if (decodeBriefs(storage.getItem(BRIEF_STORAGE_KEY)).status !== "ok") throw new Error("Reset preserved invalid brief storage explicitly before saving.");
  const value = envelopeSchema.parse({ schemaVersion: 1, briefs });
  storage.setItem(BRIEF_STORAGE_KEY, JSON.stringify(value));
}
export function resetBriefs(storage: Pick<Storage, "removeItem">) { storage.removeItem(BRIEF_STORAGE_KEY); }
