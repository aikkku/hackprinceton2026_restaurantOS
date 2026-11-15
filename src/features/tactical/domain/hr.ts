import { z } from "zod";
import type { Dataset } from "./dataset.ts";
import { hiringRoles, shiftHours, stations } from "./workforce.ts";
import { summarizeLedger } from "./finance.ts";

export const hrCardIds = ["coverage", "service", "labor", "workload"] as const;
const text = z.string().trim().min(1).max(1200);
const interpretation = { reason: text, evidenceIds: z.array(z.string().min(1)).min(1).max(8), limitation: text };
export const hrOverviewSchema = z.object({ cards: z.array(z.object({ id: z.enum(hrCardIds), status: z.enum(["green", "yellow", "red"]), ...interpretation }).strict()).length(4) }).strict();
export const hiringDraftSchema = z.object({
  role: z.enum(hiringRoles), title: z.string().min(1).max(160), employmentType: z.enum(["Full-time", "Part-time"]),
  hoursPerWeek: z.number().int().min(1).max(40), pay: z.string().min(1).max(160), schedule: z.string().min(1).max(600),
  summary: text, responsibilities: z.array(z.string().min(1).max(400)).min(1).max(8), requirements: z.array(z.string().min(1).max(400)).min(1).max(8), ...interpretation,
}).strict();
export const hrRequestSchema = z.object({ restaurantId: z.string().min(1).max(80), task: z.enum(["overview", "hire"]), role: z.enum(hiringRoles).optional(), requirements: z.string().trim().max(3000).default("") }).strict().refine(value => value.task !== "hire" || Boolean(value.role), "Choose a role.");
export type HrOverview = z.infer<typeof hrOverviewSchema>;
export type HiringDraft = z.infer<typeof hiringDraftSchema>;
export type HrRequest = z.infer<typeof hrRequestSchema>;
export type HrEvidence = { id: string; label: string; detail: unknown };
const rounded = (value: number) => Math.round(value * 100) / 100;

export function workforceMetrics(dataset: Dataset) {
  const { employees, workforce, menu } = dataset.operations;
  if (!workforce) throw new Error("Workforce sample unavailable");
  const hours = workforce.shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
  const laborCents = Math.round(workforce.shifts.reduce((sum, shift) => sum + shiftHours(shift) * employees.find(employee => employee.id === shift.employeeId)!.hourlyRateCents, 0));
  const salesCents = workforce.demand.reduce((sum, day) => sum + day.items.reduce((value, item) => value + item.quantity * item.unitPriceCents, 0), 0);
  const orders = workforce.demand.reduce((sum, day) => sum + day.orders, 0);
  const roleCoverage = stations.map(station => {
    const roster = employees.filter(employee => workforce.assignments.some(row => row.employeeId === employee.id && row.station === station));
    return { station, employees: roster.length, hours: workforce.shifts.filter(shift => roster.some(employee => employee.id === shift.employeeId)).reduce((sum, shift) => sum + shiftHours(shift), 0), roles: [...new Set(roster.map(employee => employee.role))] };
  });
  const days = [...workforce.demand].sort((a, b) => a.date.localeCompare(b.date)).map(day => {
    const peakCoverage = stations.map(station => {
      const ids = new Set(workforce.assignments.filter(row => row.station === station).map(row => row.employeeId));
      const shifts = workforce.shifts.filter(shift => shift.date === day.date && ids.has(shift.employeeId));
      const staffHours = shifts.reduce((sum, shift) => sum + Math.max(0, Math.min(shift.endMinute, workforce.assumptions.peakEndMinute) - Math.max(shift.startMinute, workforce.assumptions.peakStartMinute)) / 60, 0);
      const peakMinutes = workforce.assumptions.peakEndMinute - workforce.assumptions.peakStartMinute;
      const coveredMinutes = Array.from({ length: peakMinutes }, (_, minute) => minute + workforce.assumptions.peakStartMinute).filter(minute => shifts.some(shift => shift.startMinute <= minute && shift.endMinute > minute)).length;
      return { station, staffHours: rounded(staffHours), uncoveredMinutes: peakMinutes - coveredMinutes };
    });
    const floorHours = peakCoverage.find(row => row.station === "Floor")!.staffHours;
    return { date: day.date, orders: day.orders, peakOrders: day.peakOrders, salesCents: day.items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0), peakCoverage, peakOrdersPerFloorHour: floorHours > 0 ? rounded(day.peakOrders / floorHours) : null };
  });
  const menuSales = menu.map(item => ({ id: item.id, name: item.name, category: item.category, units: workforce.demand.reduce((sum, day) => sum + (day.items.find(row => row.menuItemId === item.id)?.quantity ?? 0), 0), salesCents: workforce.demand.reduce((sum, day) => { const row = day.items.find(row => row.menuItemId === item.id); return sum + (row ? row.quantity * row.unitPriceCents : 0); }, 0) }));
  const hoursAboveGuide = employees.reduce((sum, employee) => sum + Math.max(0, employee.hoursThisWeek - workforce.assumptions.weeklyHoursGuide), 0);
  return { staff: employees.length, hours, laborCents, salesCents, orders, averageOrderCents: orders ? Math.round(salesCents / orders) : null, laborFraction: salesCents ? laborCents / salesCents : null, hoursAboveGuide, roleCoverage, days, menuSales };
}
export function hrContext(dataset: Dataset) {
  const metrics = workforceMetrics(dataset);
  const workforce = dataset.operations.workforce!;
  const evidence: HrEvidence[] = [
    { id: "workforce", label: "Weekly staffing and demand", detail: { ...metrics, weekStart: workforce.weekStart, source: workforce.source, description: workforce.description } },
    { id: "assumptions", label: "Editable demo assumptions", detail: workforce.assumptions },
    { id: "roles", label: "Role coverage and pay assumptions", detail: metrics.roleCoverage.map(row => ({ ...row, payCents: dataset.operations.employees.filter(employee => row.roles.includes(employee.role)).map(employee => employee.hourlyRateCents) })) },
    { id: "ledger", label: "Independent recorded ledger sample", detail: { totals: summarizeLedger(dataset.operations.transactions), note: "Separate synthetic summary dataset; the HR weekly item-sales sample is not a reconciliation or replacement of this ledger." } },
    ...metrics.days.map(day => ({ id: `day:${day.date}`, label: day.date, detail: day })),
    ...metrics.menuSales.map(item => ({ id: `menu:${item.id}`, label: item.name, detail: item })),
    ...dataset.reviews.map(review => ({ id: `review:${review.id}`, label: `Review ${review.date}`, detail: { id: review.id, date: review.date, rating: review.rating, text: review.text } })),
  ];
  return { metrics, evidence };
}
export function validateHrResult(task: "overview" | "hire", raw: unknown, evidence: HrEvidence[], role?: string) {
  const result = task === "overview" ? hrOverviewSchema.parse(raw) : hiringDraftSchema.parse(raw);
  const ids = new Set(evidence.map(row => row.id));
  const findings = "cards" in result ? result.cards : [result];
  if (findings.some(row => row.evidenceIds.some(id => !ids.has(id)))) throw new Error("Unknown evidence");
  if ("cards" in result && new Set(result.cards.map(card => card.id)).size !== 4) throw new Error("Every status card is required exactly once");
  if (!("cards" in result) && result.role !== role) throw new Error("Wrong role");
  return result;
}
