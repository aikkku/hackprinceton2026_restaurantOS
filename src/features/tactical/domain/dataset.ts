import { cashCalendarSchema } from "./cash-calendar.ts";
import { z } from "zod";
import { financeReportSchema } from "./finance-report.ts";
import { workforceSchema, shiftHours } from "./workforce.ts";
import { layoutLibrarySchema } from "./layout-library.ts";
import { isScenarioReproducible } from "./scenario.ts";
import { scenarioSchema, fixtureSchema } from "./schemas.ts";
import { floorPlanDraftSchema } from "./analyze.ts";
import { issueAreaSchema } from "./social.ts";

export const restaurantIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const id = z.string().min(1).max(120);
const text = z.string().min(1).max(500);
const cents = z.number().int().min(0).max(100_000_000);
const employee = z.object({ id, name: text, role: text, type: z.enum(["Full-time", "Part-time"]), tenure: text, rating: z.enum(["Excellent", "Good", "Developing"]), hoursThisWeek: z.number().min(0).max(168), schedule: z.array(z.string().max(40).nullable()).length(7), email: z.email().endsWith("@example.com"), hourlyRateCents: cents, availability: text, mood: z.enum(["Happy", "Neutral", "Tired"]) });
const supplier = z.object({ id, name: text, contact: z.email().endsWith("@example.com"), phone: text, leadDays: z.number().int().min(0).max(365), notes: text });
const inventory = z.object({ id, name: text, category: text, supplierId: id, current: z.number().min(0).max(1_000_000), threshold: z.number().positive().max(1_000_000), unit: text, lastOrdered: z.iso.date(), expirationDate: z.iso.date().nullable().optional(), nextDelivery: z.iso.date().nullable(), unitCostCents: cents });
export const menuItemSchema = z.object({ id, name: text, category: text, dineInPriceCents: cents, deliveryPriceCents: cents, ingredientCostCents: cents, packagingCostCents: cents, deliveryCommissionFraction: z.number().min(0).max(1), quantity: z.number().int().min(0).max(1_000_000) });
export const transactionSchema = z.object({ id, date: z.iso.date(), description: text, kind: z.enum(["income", "expense"]), category: text, channel: z.enum(["dine-in", "delivery", "takeaway", "shared"]), amountCents: cents, sourceId: id });
const competitor = z.object({ id, restaurant: text, menuItemId: id, item: text, priceCents: cents, observedOn: z.iso.date(), sourceId: id, approximate: z.boolean() });
// Dated things that happened in the restaurant (a stockout, a supplier or price change), logged by the owner.
export const restaurantEventSchema = z.object({ id, date: z.iso.date(), area: issueAreaSchema, label: text, recordId: id.optional() }).strict();
export const datasetSchema = fixtureSchema.safeExtend({
  datasetVersion: z.literal(1),
  layoutConfigurations: layoutLibrarySchema,
  scenarioSnapshots: z.array(scenarioSchema).max(100),
  provenance: z.object({ origin: z.literal("synthetic"), sourceId: id, asOf: z.iso.date(), description: text }),
  operations: z.object({ events: z.array(restaurantEventSchema).max(200).optional(), cashCalendar: cashCalendarSchema.optional(), financeReport: financeReportSchema.optional(), workforce: workforceSchema.optional(), currency: z.literal("USD"), employees: z.array(employee).max(100), suppliers: z.array(supplier).max(100), inventory: z.array(inventory).max(500), menu: z.array(menuItemSchema).max(500), transactions: z.array(transactionSchema).max(5000), competitors: z.array(competitor).max(500) }),
  photoPlans: z.object({ sample: floorPlanDraftSchema, blank: floorPlanDraftSchema, fallback: floorPlanDraftSchema }),
}).superRefine((dataset, ctx) => {
  if (!restaurantIdSchema.safeParse(dataset.profile.id).success) ctx.addIssue({ code: "custom", path: ["profile", "id"], message: "Use a lowercase slug for restaurant ID." });
  for (const [key, rows] of Object.entries(dataset.operations)) {
    if (Array.isArray(rows) && new Set(rows.map(row => row.id)).size !== rows.length) ctx.addIssue({ code: "custom", path: ["operations", key], message: "IDs must be unique within each record type." });
  }
  if (dataset.layoutConfigurations.entries.some(entry => entry.layout.restaurantId !== dataset.profile.id)) ctx.addIssue({ code: "custom", path: ["layoutConfigurations"], message: "Layouts must belong to this restaurant." });
  if (new Set(dataset.scenarioSnapshots.map(s => s.id)).size !== dataset.scenarioSnapshots.length || dataset.scenarioSnapshots.some(s => s.layout.restaurantId !== dataset.profile.id || !isScenarioReproducible(s))) ctx.addIssue({ code: "custom", path: ["scenarioSnapshots"], message: "Snapshots must be unique, reproducible and belong to this restaurant." });
  const suppliers = new Set(dataset.operations.suppliers.map(s => s.id));
  const menu = new Set(dataset.operations.menu.map(m => m.id));
  const financeReport = dataset.operations.financeReport;
  if (financeReport && (financeReport.sourceId !== dataset.provenance.sourceId || financeReport.sales.some(row => !menu.has(row.menuItemId)))) ctx.addIssue({ code: "custom", path: ["operations", "financeReport"], message: "Financial item sales must reference this dataset source and menu." });
  const cash = dataset.operations.cashCalendar;
  if (cash && cash.config.obligations.some(row => row.inventoryLines.some(line => !dataset.operations.inventory.some(item => item.id === line.inventoryId)))) ctx.addIssue({code:"custom",path:["operations","cashCalendar"],message:"Cash plans must reference existing inventory."});
  const workforce = dataset.operations.workforce;
  if (workforce) {
    const employees = new Set(dataset.operations.employees.map(row => row.id));
    if (workforce.shifts.some(shift => !employees.has(shift.employeeId)) || workforce.assignments.some(row => !employees.has(row.employeeId)) || workforce.assignments.length !== employees.size) ctx.addIssue({ code: "custom", path: ["operations", "workforce"], message: "Every employee must have one station; shifts must reference the roster." });
    if (workforce.demand.some(day => day.items.some(item => !menu.has(item.menuItemId)))) ctx.addIssue({ code: "custom", path: ["operations", "workforce"], message: "Demand must reference existing menu items." });
    if (dataset.operations.employees.some(employee => Math.abs(workforce.shifts.filter(shift => shift.employeeId === employee.id).reduce((sum, shift) => sum + shiftHours(shift), 0) - employee.hoursThisWeek) > .001)) ctx.addIssue({ code: "custom", path: ["operations", "employees"], message: "Roster hours must match the dated shifts." });
  }
  const events = dataset.operations.events ?? [];
  if (events.some(event => event.area === "supply" && event.recordId && !dataset.operations.inventory.some(item => item.id === event.recordId))) ctx.addIssue({ code: "custom", path: ["operations", "events"], message: "Supply events must reference existing inventory." });
  if (dataset.operations.inventory.some(i => !suppliers.has(i.supplierId))) ctx.addIssue({ code: "custom", path: ["operations", "inventory"], message: "Inventory must reference an existing supplier." });
  if (dataset.operations.competitors.some(c => !menu.has(c.menuItemId))) ctx.addIssue({ code: "custom", path: ["operations", "competitors"], message: "Comparisons must reference an existing menu item." });
  if ([...dataset.operations.transactions, ...dataset.operations.competitors].some(r => r.sourceId !== dataset.provenance.sourceId)) ctx.addIssue({ code: "custom", path: ["operations"], message: "Record source must match the dataset provenance." });
});
export type Dataset = z.infer<typeof datasetSchema>;
export type Operations = Dataset["operations"];
export type Transaction = z.infer<typeof transactionSchema>;
export type MenuItem = z.infer<typeof menuItemSchema>;
export const uploadSchema = z.object({ expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), dataset: datasetSchema }).strict();
