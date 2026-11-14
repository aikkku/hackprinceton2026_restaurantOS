import { z } from "zod";
import { fitsRoom, furniture } from "./layout.ts";

const id = z.string().min(1);
export const roomSchema = z.object({
  width: z.number().min(1).max(50),
  depth: z.number().min(1).max(50),
});

const kinds = ["table_2", "table_4", "booth", "counter", "kitchen_zone", "door", "divider", "plant", "chair", "wall", "window", "light", "decoration", "ac", "custom"] as const;
const objectSchema = z.object({
  id,
  type: z.enum(kinds),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  depth: z.number().positive(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  seats: z.number().int().positive().max(100).optional(),
}).refine((object) => Boolean(object.seats) === Boolean(furniture[object.type].seats), {
  path: ["seats"],
  message: "Specify seats for seating furniture only.",
});

export const objectLimit = 150;
export const layoutSchema = z.object({
  schemaVersion: z.literal(1),
  restaurantId: id,
  name: z.string().min(1),
  unit: z.literal("m"),
  room: roomSchema,
  objects: z.array(objectSchema).max(objectLimit),
  updatedAt: z.iso.datetime(),
}).superRefine((layout, ctx) => {
  const ids = new Set<string>();
  layout.objects.forEach((object, index) => {
    if (ids.has(object.id)) {
      ctx.addIssue({ code: "custom", path: ["objects", index, "id"], message: "Furniture IDs must be unique." });
    }
    if (!fitsRoom(object, layout.room)) {
      ctx.addIssue({ code: "custom", path: ["objects", index], message: "Furniture must fit inside the room." });
    }
    ids.add(object.id);
  });
});

export const seatCountSchema = z.number().int().min(0).max(objectLimit * 100);
export const assumptionsSchema = z.object({
  turnsPerDay: z.number().min(0).max(24),
  occupancyFraction: z.number().min(0).max(1),
  averageCheck: z.number().min(0).max(100_000),
  operatingDaysPerMonth: z.number().int().min(0).max(31),
  incrementalContributionMargin: z.number().min(-1).max(1),
  investmentCost: z.number().min(0).max(100_000_000),
});

const reviewSchema = z.object({
  id,
  date: z.iso.date(),
  rating: z.number().int().min(1).max(5),
  text: z.string().min(1),
  themes: z.array(z.string().min(1)).min(1),
});

export const fixtureSchema = z.object({
  isDemo: z.literal(true),
  profile: z.object({ id, name: z.string().min(1), cuisine: z.string().min(1), location: z.string().min(1) }),
  layout: layoutSchema,
  reviews: z.array(reviewSchema).min(1),
  mission: z.object({
    id,
    title: z.string().min(1),
    summary: z.string().min(1),
    action: z.string().min(1),
    priority: z.enum(["low", "medium", "high"]).optional(),
    applicability: z.string().min(1).optional(),
    missingData: z.array(z.string().min(1)).optional(),
    evidenceIds: z.array(id).min(1),
  }),
  assumptions: assumptionsSchema,
}).superRefine((fixture, ctx) => {
  if (fixture.profile.id !== fixture.layout.restaurantId) {
    ctx.addIssue({ code: "custom", path: ["layout", "restaurantId"], message: "Layout must belong to the demo restaurant." });
  }

  const reviewIds = new Set(fixture.reviews.map((review) => review.id));
  if (reviewIds.size !== fixture.reviews.length) {
    ctx.addIssue({ code: "custom", path: ["reviews"], message: "Review IDs must be unique." });
  }
  const evidence = fixture.mission.evidenceIds;
  if (new Set(evidence).size !== evidence.length || evidence.some((reviewId) => !reviewIds.has(reviewId))) {
    ctx.addIssue({ code: "custom", path: ["mission", "evidenceIds"], message: "Mission evidence must reference distinct demo reviews." });
  }
});

export const modelVersion = "seating-v1";
export const turnoverModelVersion = "turnover-v1";
export const scenarioActionSchema = z.enum(["seating", "turnover"]);
export const scenarioSettingsSchema = z.object({
  label: z.string().trim().min(1, "Give this scenario a name.").max(80),
  action: scenarioActionSchema,
  targetTurnsPerDay: z.number().min(0).max(24).optional(),
}).refine((settings) => settings.action !== "turnover" || settings.targetTurnsPerDay !== undefined, {
  path: ["targetTurnsPerDay"],
  message: "Set target turns for a turnover scenario.",
});

export const scenarioSchema = z.object({
  schemaVersion: z.literal(1),
  modelVersion: z.enum([modelVersion, turnoverModelVersion]),
  label: z.string().trim().min(1).max(80).optional(),
  action: scenarioActionSchema.optional(),
  targetTurnsPerDay: z.number().min(0).max(24).optional(),
  id,
  missionTitle: z.string(),
  evidence: z.array(reviewSchema).min(1),
  createdAt: z.iso.datetime(),
  layout: layoutSchema,
  baselineSeats: seatCountSchema,
  assumptions: assumptionsSchema,
  result: z.object({
    draftSeats: seatCountSchema,
    seatChange: z.number().int(),
    additionalCoversPerDay: z.number(),
    incrementalRevenuePerMonth: z.number(),
    incrementalContributionPerMonth: z.number(),
    simplePaybackMonths: z.number().min(0).nullable(),
  }),
}).superRefine((scenario, ctx) => {
  const action = scenario.action ?? "seating";
  if (action === "turnover" && (scenario.modelVersion !== turnoverModelVersion || scenario.targetTurnsPerDay === undefined)) {
    ctx.addIssue({ code: "custom", path: ["action"], message: "A turnover scenario needs its target turns and model version." });
  }
  if (action === "seating" && scenario.modelVersion !== modelVersion) {
    ctx.addIssue({ code: "custom", path: ["modelVersion"], message: "Use the seating model for a seating scenario." });
  }
});

export type ScenarioAction = z.infer<typeof scenarioActionSchema>;
export type ScenarioSettings = z.infer<typeof scenarioSettingsSchema>;
export type Room = z.infer<typeof roomSchema>;
export type ObjectKind = (typeof kinds)[number];
export type LayoutObject = z.infer<typeof objectSchema>;
export type Layout = z.infer<typeof layoutSchema>;
export type Assumptions = z.infer<typeof assumptionsSchema>;
export type Fixture = z.infer<typeof fixtureSchema>;
export type Scenario = z.infer<typeof scenarioSchema>;
