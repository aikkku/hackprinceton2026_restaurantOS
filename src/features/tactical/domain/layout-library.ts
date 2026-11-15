import { z } from "zod";
import { layoutSchema, type Layout } from "./schemas.ts";
import { layoutCounts, footprint, hasOverlap } from "./layout.ts";

export const layoutLibrarySchema = z.object({
  version: z.literal(1),
  activeId: z.string(),
  baselineId: z.string(),
  entries: z.array(z.object({ id: z.string().min(1), layout: layoutSchema })).min(1).max(50),
}).superRefine((value, ctx) => {
  const ids = value.entries.map(entry => entry.id);
  if (new Set(ids).size !== ids.length || !ids.includes(value.activeId) || !ids.includes(value.baselineId)) {
    ctx.addIssue({ code: "custom", message: "Layout library IDs must be unique and reference existing layouts." });
  }
  if (new Set(value.entries.map(entry => entry.layout.restaurantId)).size !== 1) {
    ctx.addIssue({ code: "custom", message: "All layouts must belong to the same restaurant." });
  }
});
export type LayoutLibrary = z.infer<typeof layoutLibrarySchema>;
export function initialLibrary(layout: Layout): LayoutLibrary {
  return { version: 1, activeId: "current", baselineId: "current", entries: [{ id: "current", layout }] };
}
export function layoutMetrics(layout: Layout) {
  const area = layout.room.width * layout.room.depth;
  return { ...layoutCounts(layout), area, areaPerSeat: layoutCounts(layout).seats ? area / layoutCounts(layout).seats : null };
}
export function layoutInsights(layout: Layout) {
  const insights: { id: string; severity: "Suggestion" | "Potential problem"; title: string; explanation: string; objectIds: string[] }[] = [];
  const seats = layout.objects.filter(o => o.seats);
  for (const seat of seats) {
    const nearby = layout.objects.filter(o => o.id !== seat.id && ["ac", "window", "door", "kitchen_zone"].includes(o.type)).filter(o => {
      const a = footprint(seat), b = footprint(o);
      return Math.hypot(seat.x + a.width / 2 - o.x - b.width / 2, seat.y + a.depth / 2 - o.y - b.depth / 2) < 2;
    });
    if (nearby.length) insights.push({ id: `near-${seat.id}`, severity: nearby.some(o => o.type !== "window") ? "Potential problem" : "Suggestion", title: `Review surroundings of ${seat.name ?? seat.type.replaceAll("_", " ")}`, explanation: `Centers are less than 2 m from ${nearby.map(o => o.name ?? o.type).join(", ")}. This proximity heuristic is a hypothesis: inspect airflow, light, noise and actual customer feedback. It does not establish comfort or a safety violation.`, objectIds: [seat.id, ...nearby.map(o => o.id)] });
  }
  layout.objects.forEach((object, index) => {
    const other = layout.objects.slice(index + 1).find(candidate => hasOverlap(object, candidate));
    if (other) insights.push({ id: `overlap-${object.id}`, severity: "Potential problem", title: "Overlapping footprints", explanation: "Two recorded furniture footprints overlap. Check dimensions and move them apart before simulating capacity. This is a geometry check, not a code-compliance assessment.", objectIds: [object.id, other.id] });
  });
  return insights.slice(0, 20);
}
