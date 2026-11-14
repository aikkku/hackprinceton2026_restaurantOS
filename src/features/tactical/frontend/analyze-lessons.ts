import type { FloorPlanDraft, Lesson, MistakeRecord } from "../domain/analyze";
export type { Lesson } from "../domain/analyze";

const LESSONS_KEY = "restaurant-os:tactical:analyze:lessons:v1";
const MISTAKES_KEY = "restaurant-os:tactical:analyze:mistakes:v1";

export function loadLessons(): Lesson[] {
  try {
    const raw = localStorage.getItem(LESSONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((l): l is Lesson => typeof l?.id === "string" && typeof l?.text === "string");
  } catch { return []; }
}

export function saveLessons(lessons: Lesson[]) {
  try { localStorage.setItem(LESSONS_KEY, JSON.stringify(lessons)); } catch {}
}

export function loadMistakes(): MistakeRecord[] {
  try {
    const raw = localStorage.getItem(MISTAKES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function saveMistakes(mistakes: MistakeRecord[]) {
  try { localStorage.setItem(MISTAKES_KEY, JSON.stringify(mistakes)); } catch {}
}

export type PlanDiff = {
  extraTables: number;
  missedTables: number;
  wrongSeatCounts: number;
  avgPositionError: number;
  missingBar: boolean;
  missingCashier: boolean;
  extraBar: boolean;
  extraCashier: boolean;
  entranceWallWrong: boolean;
};

export function diffPlans(original: FloorPlanDraft, corrected: FloorPlanDraft): PlanDiff {
  const origIds = new Set(original.tables.map((t) => t.id));
  const corrIds = new Set(corrected.tables.map((t) => t.id));

  const extraTables = [...origIds].filter((id) => !corrIds.has(id)).length;
  const missedTables = corrected.tables.length - original.tables.length + extraTables;

  let wrongSeatCounts = 0;
  let totalPositionError = 0;
  let matchedCount = 0;

  for (const ct of corrected.tables) {
    const ot = original.tables.find((t) => t.id === ct.id);
    if (!ot) continue;
    if (ot.seats !== ct.seats) wrongSeatCounts++;
    const dx = ot.x + ot.width / 2 - (ct.x + ct.width / 2);
    const dy = ot.y + ot.depth / 2 - (ct.y + ct.depth / 2);
    totalPositionError += Math.sqrt(dx * dx + dy * dy);
    matchedCount++;
  }

  const origBar = original.fixtures.some((f) => f.type === "bar");
  const corrBar = corrected.fixtures.some((f) => f.type === "bar");
  const origCashier = original.fixtures.some((f) => f.type === "cashier");
  const corrCashier = corrected.fixtures.some((f) => f.type === "cashier");

  return {
    extraTables,
    missedTables: Math.max(0, missedTables),
    wrongSeatCounts,
    avgPositionError: matchedCount > 0 ? totalPositionError / matchedCount : 0,
    missingBar: corrBar && !origBar,
    missingCashier: corrCashier && !origCashier,
    extraBar: origBar && !corrBar,
    extraCashier: origCashier && !corrCashier,
    entranceWallWrong: original.door.wall !== corrected.door.wall,
  };
}

export function diffScore(diff: PlanDiff): number {
  return diff.extraTables * 2 + diff.missedTables * 2 + diff.wrongSeatCounts
    + (diff.avgPositionError > 3 ? 1 : 0)
    + (diff.missingBar ? 1 : 0) + (diff.missingCashier ? 1 : 0)
    + (diff.extraBar ? 1 : 0) + (diff.extraCashier ? 1 : 0)
    + (diff.entranceWallWrong ? 2 : 0);
}

export function diffToLessons(diff: PlanDiff): string[] {
  const lessons: string[] = [];
  if (diff.extraTables > 0) lessons.push(`Do not invent tables. The model added ${diff.extraTables} extra table(s) not in the room.`);
  if (diff.missedTables > 0) lessons.push(`Count all tables visible. The model missed ${diff.missedTables} table(s).`);
  if (diff.wrongSeatCounts > 0) lessons.push(`Seat counts were wrong on ${diff.wrongSeatCounts} table(s). Count chairs precisely.`);
  if (diff.avgPositionError > 4) lessons.push(`Table positions were off by an average of ${diff.avgPositionError.toFixed(1)} ft. Place tables more accurately.`);
  if (diff.missingBar) lessons.push("Do not omit the bar when it is clearly visible.");
  if (diff.missingCashier) lessons.push("Do not omit the cashier station when visible.");
  if (diff.extraBar) lessons.push("Do not add a bar that is not in the room.");
  if (diff.extraCashier) lessons.push("Do not add a cashier that is not in the room.");
  if (diff.entranceWallWrong) lessons.push("The entrance was placed on the wrong wall. Trust user-provided wall labels.");
  return lessons;
}

export function mergeLessons(existing: Lesson[], newTexts: string[]): Lesson[] {
  const updated = [...existing];
  for (const text of newTexts) {
    const match = updated.find((l) => l.text === text);
    if (match) match.count++;
    else updated.push({ id: crypto.randomUUID?.() ?? `${Date.now()}`, text, count: 1, createdAt: new Date().toISOString() });
  }
  return updated.sort((a, b) => b.count - a.count).slice(0, 50);
}
