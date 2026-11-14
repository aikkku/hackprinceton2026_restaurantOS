import Anthropic from "@anthropic-ai/sdk";
import { NextResponse, type NextRequest } from "next/server";
import {
  autoRotateToEntranceWall, validateDraft, floorPlanDraftSchema, analyzeRequestSchema,
  type AnalyzeApiRequest, type AnalyzeApiResponse, type FloorPlanDraft, type DraftWall,
} from "../domain/analyze";

const MOCK_PLAN: FloorPlanDraft = {
  room: { width: 42, depth: 28, confidence: 0.7 },
  door: { wall: "S", position: 0.45, label: "Entrance" },
  fixtures: [
    { id: "bar-1", type: "bar", x: 1, y: 1, width: 16, depth: 3.5, stool_count: 6, wall: "N" },
    { id: "cashier-1", type: "cashier", x: 34, y: 1, width: 5, depth: 3, wall: "N" },
  ],
  tables: [
    { id: "T1", x: 4,  y: 8,  shape: "rect",  width: 4, depth: 3, seats: 4, chairs_visible: 4, is_joined_group: false, confidence: 0.9, label: "T1" },
    { id: "T2", x: 11, y: 8,  shape: "rect",  width: 4, depth: 3, seats: 4, chairs_visible: 4, is_joined_group: false, confidence: 0.9, label: "T2" },
    { id: "T3", x: 18, y: 8,  shape: "rect",  width: 4, depth: 3, seats: 4, chairs_visible: 4, is_joined_group: false, confidence: 0.85, label: "T3" },
    { id: "T4", x: 25, y: 8,  shape: "rect",  width: 4, depth: 3, seats: 4, chairs_visible: 4, is_joined_group: false, confidence: 0.85, label: "T4" },
    { id: "T5", x: 4,  y: 18, shape: "round", width: 3.5, depth: 3.5, seats: 2, chairs_visible: 2, is_joined_group: false, confidence: 0.9, label: "T5" },
    { id: "T6", x: 11, y: 18, shape: "round", width: 3.5, depth: 3.5, seats: 2, chairs_visible: 2, is_joined_group: false, confidence: 0.4, label: "T6" },
    { id: "T7", x: 18, y: 18, shape: "rect",  width: 6, depth: 3, seats: 6, chairs_visible: 6, is_joined_group: true,  confidence: 0.75, label: "T7" },
    { id: "T8", x: 28, y: 18, shape: "rect",  width: 4, depth: 3, seats: 4, chairs_visible: 4, is_joined_group: false, confidence: 0.88, label: "T8" },
  ],
  questions: [
    "How far apart are the tables from each other?",
    "Is the joined table group (T7) a permanent arrangement or occasional?",
  ],
};

const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
const client = hasApiKey ? new Anthropic() : null;

const MODEL_STANDARD = "claude-sonnet-4-6";
const MODEL_HIGH = "claude-opus-4-8";

function buildPrompt(facts: AnalyzeApiRequest["facts"], lessons: AnalyzeApiRequest["lessons"]): string {
  const wallDesc = (w: DraftWall) => w === "unknown" ? "unknown" : `the ${w} wall`;
  const factsLines: string[] = [];
  if (facts.entranceWall !== "unknown") factsLines.push(`- Entrance is on ${wallDesc(facts.entranceWall)} (GROUND TRUTH)`);
  if (facts.cashierWall !== "unknown") factsLines.push(`- Cashier is near ${wallDesc(facts.cashierWall)} (GROUND TRUTH)`);
  if (facts.barWall !== "unknown") factsLines.push(`- Bar is along ${wallDesc(facts.barWall)} (GROUND TRUTH)`);
  if (facts.tableCounts.trim()) factsLines.push(`- Table counts (seats:count) GROUND TRUTH: ${facts.tableCounts}`);
  if (facts.tableSpacing.trim()) factsLines.push(`- Table spacing (use exactly): ${facts.tableSpacing}`);
  if (facts.notes.trim()) factsLines.push(`- Notes (GROUND TRUTH): ${facts.notes}`);

  const lessonLines = lessons.slice(0, 12).map((l) => `- ${l.text}${l.count > 1 ? ` (×${l.count})` : ""}`);

  return `You are analyzing restaurant photos to generate an accurate floor plan.
Output ONLY valid JSON — no prose, no markdown, no code fences.

${factsLines.length ? `GROUND TRUTH (override anything from photos):\n${factsLines.join("\n")}\n` : ""}
${lessonLines.length ? `DO NOT REPEAT THESE PAST MISTAKES:\n${lessonLines.join("\n")}\n` : ""}

RULES:
- Merge photos of the same area. Count every table once.
- Count chairs only if visible. chairs_visible must be ≤ seats.
- Pushed-together tables → one joined group with combined seats and is_joined_group: true.
- Never invent tables or chairs; set confidence below 0.5 if unsure.
- Always include the entrance door. If not visible, guess and set confidence 0.4.
- Do not give all tables the same size unless they look the same.
- If table spacing not provided, ask about it in questions.
- Confidence: 0.8+ clearly seen, below 0.5 a guess.
- Labels are 1-2 words max (e.g. "T1", "T2"). Long info goes in "note".
- Origin is the north-west inside corner, x east, y south, north up.
- x,y is the top-left of the unrotated bounding box.
- Unit: approximately 1 foot. A standard 4-top table is about 3×3 ft.
- Ask at most 3 clarifying questions in "questions" array.

JSON SCHEMA (respond with this exact structure):
{
  "room": {"width": number, "depth": number, "confidence": number},
  "door": {"wall": "N"|"E"|"S"|"W", "position": number_0_to_1, "label": "Entrance"},
  "fixtures": [
    {"id": string, "type": "bar"|"cashier", "x": number, "y": number, "width": number, "depth": number, "stool_count": number_or_null, "wall": "N"|"E"|"S"|"W"|null}
  ],
  "tables": [
    {"id": string, "x": number, "y": number, "shape": "round"|"square"|"rect", "width": number, "depth": number, "seats": number, "chairs_visible": number, "is_joined_group": boolean, "confidence": number, "label": string, "note": string_or_null}
  ],
  "questions": [string]
}`;
}

function parseDraft(raw: string): FloorPlanDraft {
  const data = JSON.parse(raw);
  const tables = (data.tables ?? []).map((t: Record<string, unknown>, i: number) => ({
    id: String(t.id ?? `T${i + 1}`),
    x: Number(t.x ?? 2),
    y: Number(t.y ?? 2),
    shape: (["round", "square", "rect"].includes(t.shape as string) ? t.shape : "rect") as "round" | "square" | "rect",
    width: Math.max(1, Number(t.width ?? 3)),
    depth: Math.max(1, Number(t.depth ?? 3)),
    seats: Math.max(1, Math.round(Number(t.seats ?? 4))),
    chairs_visible: Math.max(0, Math.round(Number(t.chairs_visible ?? t.seats ?? 4))),
    is_joined_group: Boolean(t.is_joined_group),
    confidence: Math.min(1, Math.max(0, Number(t.confidence ?? 0.7))),
    label: String(t.label ?? `T${i + 1}`),
    note: t.note ? String(t.note) : undefined,
  }));

  const fixtures = (data.fixtures ?? []).map((f: Record<string, unknown>, i: number) => ({
    id: String(f.id ?? `F${i}`),
    type: f.type === "cashier" ? "cashier" : "bar" as "bar" | "cashier",
    x: Number(f.x ?? 0),
    y: Number(f.y ?? 0),
    width: Math.max(1, Number(f.width ?? 8)),
    depth: Math.max(1, Number(f.depth ?? 3)),
    stool_count: f.stool_count != null ? Math.max(0, Math.round(Number(f.stool_count))) : undefined,
    wall: (["N", "E", "S", "W"].includes(f.wall as string) ? f.wall : undefined) as DraftWall | undefined,
  }));

  const door = data.door ?? {};
  return {
    room: {
      width: Math.max(10, Number(data.room?.width ?? 30)),
      depth: Math.max(10, Number(data.room?.depth ?? 25)),
      confidence: Math.min(1, Math.max(0, Number(data.room?.confidence ?? 0.6))),
    },
    door: {
      wall: (["N", "E", "S", "W"].includes(door.wall) ? door.wall : "S") as DraftWall,
      position: Math.min(1, Math.max(0, Number(door.position ?? 0.5))),
      label: String(door.label ?? "Entrance"),
    },
    fixtures,
    tables,
    questions: (data.questions ?? []).slice(0, 3).map(String),
  };
}

function countProblems(checks: ReturnType<typeof validateDraft>) {
  return checks.filter((c) => c.kind === "error").length;
}

export async function POST(req: NextRequest): Promise<NextResponse<AnalyzeApiResponse>> {
  try {
    if (Number(req.headers.get("content-length") ?? 0) > 32_000_000) return NextResponse.json({ ok: false, error: "Request is too large." }, { status: 413 });
    const parsed = analyzeRequestSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ ok: false, error: "Provide 1–10 JPEG/PNG photos and valid facts." }, { status: 400 });
    const body = parsed.data;
    const { photos, facts, accuracy, lessons } = body;

    if (!photos || photos.length === 0) {
      return NextResponse.json({ ok: false, error: "At least one photo is required." });
    }

    if (!client) {
      // No API key — return a realistic mock plan so the editor can be used immediately.
      await new Promise((r) => setTimeout(r, 800)); // simulate latency
      let draft = { ...MOCK_PLAN, questions: [...MOCK_PLAN.questions] };
      if (facts.entranceWall !== "unknown") draft = autoRotateToEntranceWall(draft, facts.entranceWall);
      return NextResponse.json({ ok: true, draft, fixupApplied: false, source: "demo" });
    }

    const model = accuracy === "high" ? MODEL_HIGH : MODEL_STANDARD;
    const systemPrompt = buildPrompt(facts, lessons ?? []);

    const imageContent = photos.map((dataUrl: string) => {
      const [header, b64] = dataUrl.split(",");
      const mediaType = header.includes("jpeg") ? "image/jpeg" : header.includes("png") ? "image/png" : "image/jpeg";
      return { type: "image" as const, source: { type: "base64" as const, media_type: mediaType as "image/jpeg" | "image/png", data: b64 } };
    });

    const message = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            ...imageContent,
            { type: "text", text: systemPrompt },
          ],
        },
      ],
    });

    const rawText = message.content.find((b) => b.type === "text")?.text ?? "";
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return NextResponse.json({ ok: false, error: "Model returned no JSON. Try again." });

    let draft = floorPlanDraftSchema.parse(parseDraft(jsonMatch[0]));

    if (facts.entranceWall !== "unknown") {
      draft = autoRotateToEntranceWall(draft, facts.entranceWall);
    }

    const initialChecks = validateDraft(draft, facts);
    const initialErrors = countProblems(initialChecks);

    if (initialErrors > 0) {
      try {
        const fixupPrompt = `The floor plan you produced has ${initialErrors} error(s):\n${initialChecks.filter((c) => c.kind === "error").map((c) => `- ${c.message}`).join("\n")}\n\nReturn the corrected JSON only. Same schema. Do not remove tables, fixtures, or the entrance door.`;
        const fixupMsg = await client.messages.create({
          model: MODEL_STANDARD,
          max_tokens: 4096,
          messages: [
            { role: "user", content: [{ type: "text", text: `${systemPrompt}\n\nOriginal plan:\n${JSON.stringify(draft)}\n\n${fixupPrompt}` }] },
          ],
        });
        const fixText = fixupMsg.content.find((b) => b.type === "text")?.text ?? "";
        const fixJson = fixText.match(/\{[\s\S]*\}/);
        if (fixJson) {
          let fixedDraft = floorPlanDraftSchema.parse(parseDraft(fixJson[0]));
          if (facts.entranceWall !== "unknown") fixedDraft = autoRotateToEntranceWall(fixedDraft, facts.entranceWall);
          const fixedChecks = validateDraft(fixedDraft, facts);
          const fixedErrors = countProblems(fixedChecks);
          const droppedTables = draft.tables.length - fixedDraft.tables.length > 0;
          const droppedFixtures = draft.fixtures.length - fixedDraft.fixtures.length > 0;
          if (fixedErrors < initialErrors && !droppedTables && !droppedFixtures) {
            return NextResponse.json({ ok: true, draft: fixedDraft, fixupApplied: true, source: "ai" });
          }
        }
      } catch {
        // Fix-up failed; return original
      }
    }

    return NextResponse.json({ ok: true, draft, fixupApplied: false, source: "ai" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed.";
    return NextResponse.json({ ok: false, error: message });
  }
}
