import { z } from "zod";
import { datasetSchema, restaurantIdSchema, type Dataset } from "./dataset.ts";
import { layoutSchema } from "./schemas.ts";
import { layoutLibrarySchema } from "./layout-library.ts";

export const assistantTargetSchema = z.object({
  page: z.enum(["supply", "finance", "hr", "reviews", "floor"]),
  kind: z.enum(["inventory", "menu", "employee", "review", "object", "overview"]),
  id: z.string().max(120), label: z.string().max(500),
}).strict();
export type AssistantTarget = z.infer<typeof assistantTargetSchema>;
export const editableFieldSchema = z.enum(["current", "threshold", "unitCostCents", "dineInPriceCents", "deliveryPriceCents", "ingredientCostCents", "packagingCostCents"]);
export const assistantPlanSchema = z.object({
  message: z.string().min(1).max(1800),
  calls: z.array(z.object({
    tool: z.enum(["find_records", "stock_overview", "finance_report", "team_overview", "review_evidence", "floor_plan", "price_test", "propose_update"]),
    area: z.enum(["inventory", "menu", "employees", "reviews", "floor", "finance"]),
    ids: z.array(z.string().max(120)).max(12),
    query: z.string().max(200),
    field: editableFieldSchema.nullable(), value: z.number().finite().nullable(),
  }).strict()).max(4),
  navigate: z.boolean(),
}).strict();
export type AssistantPlan = z.infer<typeof assistantPlanSchema>;
const row = z.object({ label: z.string().max(500), cells: z.array(z.string().max(4000)).max(8), target: assistantTargetSchema.nullable() });
export const assistantBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("table"), title: z.string(), columns: z.array(z.string()).max(8), rows: z.array(row).max(50), note: z.string() }),
  z.object({ type: z.literal("chart"), title: z.string(), rows: z.array(z.object({ label: z.string(), value: z.number().finite(), detail: z.string(), target: assistantTargetSchema })).max(20), note: z.string() }),
  z.object({ type: z.literal("metrics"), title: z.string(), items: z.array(z.object({ label: z.string(), value: z.string() })).max(8), note: z.string() }),
  z.object({ type: z.literal("price-test"), title: z.string(), itemId: z.string(), priceCents: z.number(), costCents: z.number(), units: z.number(), maxRaiseCents: z.number(), period: z.string(), note: z.string() }),
]);
export type AssistantBlock = z.infer<typeof assistantBlockSchema>;
export const proposalSchema = z.object({
  id: z.string().uuid(), area: z.enum(["inventory", "menu"]), entityId: z.string(), label: z.string(),
  field: editableFieldSchema, fieldLabel: z.string(), before: z.number(), value: z.number(),
  unit: z.string(), min: z.number(), max: z.number(), step: z.number(),
  datasetRevision: z.number().int(), status: z.enum(["pending", "applied"]), appliedAt: z.string().nullable(),
  target: assistantTargetSchema,
});
export type AssistantProposal = z.infer<typeof proposalSchema>;
export const assistantMessageSchema = z.object({
  id: z.string().uuid(), role: z.enum(["user", "assistant"]), text: z.string().min(1).max(3000), createdAt: z.string(),
  blocks: z.array(assistantBlockSchema).max(8), proposals: z.array(proposalSchema).max(4),
  targets: z.array(assistantTargetSchema).max(50), navigate: z.boolean(), datasetRevision: z.number().int(),
  model: z.string().max(100).nullable(),
});
export const conversationSchema = z.object({
  id: z.string().uuid(), restaurantId: restaurantIdSchema, title: z.string().max(100),
  revision: z.number().int().min(1), createdAt: z.string(), updatedAt: z.string(),
  messages: z.array(assistantMessageSchema).max(60),
});
export type Conversation = z.infer<typeof conversationSchema>;
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export type ConversationSummary = Pick<Conversation, "id" | "title" | "updatedAt" | "revision">;
export const assistantRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("message"), restaurantId: restaurantIdSchema, threadId: z.string().uuid(), messageId: z.string().uuid(), text: z.string().trim().min(1).max(3000), layout: layoutSchema.optional(), layoutVersions: layoutLibrarySchema.optional() }).strict(),
  z.object({ action: z.literal("apply"), restaurantId: restaurantIdSchema, threadId: z.string().uuid(), messageId: z.string().uuid(), proposalId: z.string().uuid(), value: z.number().finite() }).strict(),
]);
export const fieldLabels: Record<z.infer<typeof editableFieldSchema>, string> = {
  current: "On-hand quantity", threshold: "Reorder point", unitCostCents: "Inventory unit cost",
  dineInPriceCents: "Current dine-in price", deliveryPriceCents: "Current app price", ingredientCostCents: "Ingredient cost per dish", packagingCostCents: "Packaging cost per order",
};
export function applyAssistantProposal(dataset: Dataset, proposal: AssistantProposal, value: number): Dataset {
  const allowed = proposal.area === "inventory" ? ["current", "threshold", "unitCostCents"] : ["dineInPriceCents", "deliveryPriceCents", "ingredientCostCents", "packagingCostCents"];
  if (!allowed.includes(proposal.field) || !Number.isFinite(value) || value < proposal.min || value > proposal.max || (proposal.step === 1 && !Number.isInteger(value))) throw new Error("Invalid change");
  const copy = structuredClone(dataset);
  const record = copy.operations[proposal.area].find(item => item.id === proposal.entityId);
  if (!record || !(proposal.field in record) || Reflect.get(record, proposal.field) !== proposal.before) throw new Error("Stale change");
  Reflect.set(record, proposal.field, value);
  return datasetSchema.parse(copy);
}
export function assistantSuggestions(dataset: Dataset) {
  const low = dataset.operations.inventory.find(item => item.current < item.threshold);
  const dish = dataset.operations.menu.find(item => /ribeye/i.test(item.name)) ?? dataset.operations.menu[0];
  const stock = dataset.operations.inventory.find(item => /ribeye/i.test(item.name)) ?? dataset.operations.inventory[0];
  return [
    stock ? `How much ${stock.name} do we have? Show me where it is.` : "Show me our inventory.",
    low ? `Compare low stock and reorder points, including ${low.name}.` : "Compare stock against reorder points.",
    dish ? `Let me test a price increase for ${dish.name}.` : "Explain our menu contribution.",
    "What do recent customer reviews say, and which records support it?",
  ];
}
