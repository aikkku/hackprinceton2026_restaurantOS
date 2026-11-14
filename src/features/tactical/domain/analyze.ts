import { z } from "zod";
export type DraftWall = "N" | "E" | "S" | "W" | "unknown";
export type TableShape = "round" | "square" | "rect";

export type DraftTable = {
  id: string;
  x: number;
  y: number;
  shape: TableShape;
  width: number;
  depth: number;
  seats: number;
  chairs_visible: number;
  is_joined_group: boolean;
  confidence: number;
  label: string;
  note?: string;
  verified?: boolean;
};

export type DraftFixture = {
  id: string;
  type: "bar" | "cashier";
  x: number;
  y: number;
  width: number;
  depth: number;
  stool_count?: number;
  wall?: DraftWall;
};

export type DraftDoor = {
  wall: DraftWall;
  position: number;
  label: string;
};

export type FloorPlanDraft = {
  room: { width: number; depth: number; confidence: number };
  door: DraftDoor;
  fixtures: DraftFixture[];
  tables: DraftTable[];
  questions: string[];
};

export type AnalyzeFacts = {
  entranceWall: DraftWall;
  cashierWall: DraftWall;
  barWall: DraftWall;
  tableCounts: string;
  tableSpacing: string;
  notes: string;
};

export type ValidationCheck = {
  id: string;
  kind: "error" | "warning";
  message: string;
  targetId?: string;
};

export type Lesson = {
  id: string;
  text: string;
  count: number;
  createdAt: string;
};

export type MistakeRecord = {
  id: string;
  score: number;
  date: string;
  summary: string;
};

export type AnalyzeApiRequest = {
  photos: string[];
  facts: AnalyzeFacts;
  accuracy: "standard" | "high";
  lessons: Lesson[];
};

export type AnalyzeApiResponse =
  | { ok: true; draft: FloorPlanDraft; fixupApplied: boolean; source: "demo" | "ai" }
  | { ok: false; error: string };

const wallSchema = z.enum(["N", "E", "S", "W", "unknown"]);
const dimension = z.number().positive().max(200);
const coordinate = z.number().min(0).max(200);
const confidence = z.number().min(0).max(1);
export const floorPlanDraftSchema = z.object({
  room: z.object({ width: dimension, depth: dimension, confidence }),
  door: z.object({ wall: wallSchema, position: z.number().min(0).max(1), label: z.string().max(120) }),
  fixtures: z.array(z.object({ id: z.string().min(1), type: z.enum(["bar", "cashier"]), x: coordinate, y: coordinate, width: dimension, depth: dimension, stool_count: z.number().int().min(0).max(100).optional(), wall: wallSchema.optional() })).max(150),
  tables: z.array(z.object({ id: z.string().min(1), x: coordinate, y: coordinate, shape: z.enum(["round", "square", "rect"]), width: dimension, depth: dimension, seats: z.number().int().min(1).max(100), chairs_visible: z.number().int().min(0).max(100), is_joined_group: z.boolean(), confidence, label: z.string().max(120), note: z.string().max(2000).optional(), verified: z.boolean().optional() })).max(150),
  questions: z.array(z.string().max(2000)).max(3),
}).refine(plan => new Set([...plan.tables, ...plan.fixtures].map(item => item.id)).size === plan.tables.length + plan.fixtures.length, "Object IDs must be unique.");
export const analyzeRequestSchema = z.object({
  photos: z.array(z.string().max(3_000_000).regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/)).min(1).max(10),
  facts: z.object({ entranceWall: wallSchema, cashierWall: wallSchema, barWall: wallSchema, tableCounts: z.string().max(500), tableSpacing: z.string().max(500), notes: z.string().max(4000) }),
  accuracy: z.enum(["standard", "high"]),
  lessons: z.array(z.object({ id: z.string(), text: z.string().max(2000), count: z.number().int().positive(), createdAt: z.string() })).max(50),
});

export function rotatePlan(plan: FloorPlanDraft, degrees: 90 | 180 | 270): FloorPlanDraft {
  const steps = degrees / 90;
  let result = plan;
  for (let i = 0; i < steps; i++) result = rotatePlan90(result);
  return result;
}

function rotateWall(wall: DraftWall): DraftWall {
  const cycle: DraftWall[] = ["N", "E", "S", "W"];
  const idx = cycle.indexOf(wall);
  if (idx === -1) return wall;
  return cycle[(idx + 1) % 4];
}

function rotatePlan90(plan: FloorPlanDraft): FloorPlanDraft {
  const { width: W, depth: D } = plan.room;
  const rotateXY = (x: number, y: number) => ({ x: D - y - 0, y: x });

  const tables = plan.tables.map((t) => {
    const { x, y } = rotateXY(t.x, t.y);
    return { ...t, x: x - t.depth, y, width: t.depth, depth: t.width };
  });

  const fixtures = plan.fixtures.map((f) => {
    const { x, y } = rotateXY(f.x, f.y);
    return { ...f, x: x - f.depth, y, width: f.depth, depth: f.width, wall: f.wall ? rotateWall(f.wall) : undefined };
  });

  const doorPos = plan.door.position;
  const door: DraftDoor = {
    ...plan.door,
    wall: plan.door.wall === "unknown" ? "unknown" : rotateWall(plan.door.wall),
    position: plan.door.wall === "E" || plan.door.wall === "W" ? 1 - doorPos : doorPos,
  };

  return {
    room: { width: D, depth: W, confidence: plan.room.confidence },
    door,
    fixtures,
    tables,
    questions: plan.questions,
  };
}

export function autoRotateToEntranceWall(plan: FloorPlanDraft, desiredWall: DraftWall): FloorPlanDraft {
  if (desiredWall === "unknown" || plan.door.wall === desiredWall) return plan;
  for (const deg of [90, 180, 270] as const) {
    const rotated = rotatePlan(plan, deg);
    if (rotated.door.wall === desiredWall) return rotated;
  }
  return plan;
}

export function parsedTableCounts(raw: string): Array<{ seats: number; count: number }> | null {
  if (!raw.trim()) return null;
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const result: Array<{ seats: number; count: number }> = [];
  for (const part of parts) {
    const match = /^(\d+)\s*:\s*(\d+)$/.exec(part);
    if (!match) return null;
    result.push({ seats: Number(match[1]), count: Number(match[2]) });
  }
  return result;
}

export function validateDraft(draft: FloorPlanDraft, facts: AnalyzeFacts): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  draft.tables.forEach((t, i) => {
    const fp = footprintOf(t);
    if (t.x < 0 || t.y < 0 || t.x + fp.width > draft.room.width || t.y + fp.depth > draft.room.depth) {
      checks.push({ id: `bounds-${t.id}`, kind: "error", message: `${t.label || `Table ${i + 1}`} is outside the room.`, targetId: t.id });
    }
    if (t.chairs_visible > t.seats) {
      checks.push({ id: `chairs-${t.id}`, kind: "warning", message: `${t.label || `Table ${i + 1}`}: visible chairs (${t.chairs_visible}) exceed seat count (${t.seats}).`, targetId: t.id });
    }
  });

  for (let i = 0; i < draft.tables.length; i++) {
    for (let j = i + 1; j < draft.tables.length; j++) {
      if (rectsOverlap(draft.tables[i], draft.tables[j])) {
        checks.push({ id: `overlap-${draft.tables[i].id}-${draft.tables[j].id}`, kind: "error", message: `${draft.tables[i].label || `Table ${i + 1}`} overlaps ${draft.tables[j].label || `Table ${j + 1}`}.`, targetId: draft.tables[i].id });
      }
    }
  }

  draft.fixtures.forEach((f) => {
    for (const t of draft.tables) {
      if (rectsOverlap(f, t)) {
        checks.push({ id: `fix-overlap-${f.id}-${t.id}`, kind: "error", message: `${f.type === "bar" ? "Bar" : "Cashier"} overlaps ${t.label || t.id}.`, targetId: f.id });
      }
    }
  });

  if (facts.entranceWall !== "unknown" && draft.door.wall !== "unknown" && draft.door.wall !== facts.entranceWall) {
    checks.push({ id: "entrance-wall", kind: "error", message: `Entrance is on the ${draft.door.wall} wall but you said it's on the ${facts.entranceWall} wall.` });
  }

  if (facts.cashierWall !== "unknown") {
    const cashier = draft.fixtures.find((f) => f.type === "cashier");
    if (cashier && cashier.wall && cashier.wall !== facts.cashierWall) {
      checks.push({ id: "cashier-wall", kind: "warning", message: `Cashier is near the ${cashier.wall} wall but you said ${facts.cashierWall}.`, targetId: cashier.id });
    }
  }

  if (facts.barWall !== "unknown") {
    const bar = draft.fixtures.find((f) => f.type === "bar");
    if (bar && bar.wall && bar.wall !== facts.barWall) {
      checks.push({ id: "bar-wall", kind: "warning", message: `Bar is along the ${bar.wall} wall but you said ${facts.barWall}.`, targetId: bar.id });
    }
  }

  const counts = parsedTableCounts(facts.tableCounts);
  if (counts) {
    for (const { seats, count } of counts) {
      const actual = draft.tables.filter((t) => t.seats === seats).length;
      if (actual !== count) {
        checks.push({ id: `count-${seats}`, kind: "error", message: `Expected ${count} table(s) of ${seats} seats but found ${actual}.` });
      }
    }
  }

  return checks;
}

function footprintOf(obj: { width: number; depth: number }) {
  return { width: obj.width, depth: obj.depth };
}

function rectsOverlap(a: { x: number; y: number; width: number; depth: number }, b: { x: number; y: number; width: number; depth: number }) {
  const eps = 0.1;
  return a.x + a.width - b.x > eps && b.x + b.width - a.x > eps
    && a.y + a.depth - b.y > eps && b.y + b.depth - a.y > eps;
}
