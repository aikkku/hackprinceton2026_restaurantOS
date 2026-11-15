import { z } from "zod";

export const stations = ["Kitchen", "Floor", "Bar", "Support"] as const;
export const hiringRoles = ["Server", "Host", "Line Cook", "Prep Cook", "Bartender", "Busser", "Dishwasher", "Shift Manager"] as const;
const money = z.number().int().min(0).max(100_000_000);
export const shiftSchema = z.object({ id: z.string().min(1), employeeId: z.string().min(1), date: z.iso.date(), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440) }).refine(shift => shift.endMinute > shift.startMinute, "Shift must end after it starts.");
export const workforceSchema = z.object({
  weekStart: z.iso.date(),
  source: z.literal("synthetic"),
  description: z.string().min(1).max(1000),
  shifts: z.array(shiftSchema).max(700),
  assignments: z.array(z.object({ employeeId: z.string().min(1), station: z.enum(stations) })).max(100),
  demand: z.array(z.object({ date: z.iso.date(), orders: z.number().int().min(0).max(100_000), peakOrders: z.number().int().min(0).max(100_000), items: z.array(z.object({ menuItemId: z.string().min(1), quantity: z.number().int().min(0).max(100_000), unitPriceCents: money })).max(500) })).length(7),
  assumptions: z.object({ peakStartMinute: z.number().int().min(0).max(1439), peakEndMinute: z.number().int().min(1).max(1440), targetOrdersPerFloorHour: z.number().positive().max(100), targetLaborFraction: z.number().positive().max(1), weeklyHoursGuide: z.number().positive().max(168) }),
}).superRefine((data, ctx) => {
  if (new Date(`${data.weekStart}T00:00:00Z`).getUTCDay() !== 1) ctx.addIssue({ code: "custom", message: "The schedule week must start on Monday." });
  const days = Array.from({ length: 7 }, (_, index) => dateOffset(data.weekStart, index));
  if (new Set(data.demand.map(day => day.date)).size !== 7 || data.demand.some(day => !days.includes(day.date))) ctx.addIssue({ code: "custom", message: "Demand must cover each date in the schedule week exactly once." });
  if (data.shifts.some(shift => !days.includes(shift.date)) || new Set(data.shifts.map(shift => shift.id)).size !== data.shifts.length) ctx.addIssue({ code: "custom", message: "Shifts must have unique IDs within the schedule week." });
  if (new Set(data.assignments.map(row => row.employeeId)).size !== data.assignments.length) ctx.addIssue({ code: "custom", message: "Employee station assignments must be unique." });
  for (const [index, shift] of data.shifts.entries()) if (data.shifts.slice(index + 1).some(other => other.employeeId === shift.employeeId && other.date === shift.date && other.startMinute < shift.endMinute && shift.startMinute < other.endMinute)) ctx.addIssue({ code: "custom", message: "An employee cannot have overlapping shifts." });
  for (const day of data.demand) {
    const units = day.items.reduce((sum, row) => sum + row.quantity, 0);
    if (day.peakOrders > day.orders || day.orders > units || (day.orders === 0 && units !== 0) || new Set(day.items.map(row => row.menuItemId)).size !== day.items.length) ctx.addIssue({ code: "custom", message: "Order totals, peak counts and unique menu quantities must agree." });
  }
  if (data.assumptions.peakEndMinute <= data.assumptions.peakStartMinute) ctx.addIssue({ code: "custom", message: "Peak window must end after it starts." });
});
export type Workforce = z.infer<typeof workforceSchema>;
export function dateOffset(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
}
export function shiftHours(shift: z.infer<typeof shiftSchema>) { return (shift.endMinute - shift.startMinute) / 60; }
export function clockLabel(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
