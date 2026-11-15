import assert from "node:assert/strict";
import test from "node:test";
import { latLngToCell } from "h3-js";
import { exampleIntake } from "./frontend/data/intake-example.ts";
import { normalizeRequirements } from "./domain/requirements.ts";
import {
  candidateSchema,
  factSchema,
  type SpaceCandidate,
} from "./domain/matching.ts";
import {
  requiredSalesMonthly,
  FINANCE_TOOL_VERSION,
} from "./domain/scenario.ts";
import {
  invokeTool,
  ToolError,
  TOOLS,
  TOOL_CATALOG_VERSION,
  toolsManifest,
} from "./domain/tools.ts";

const candidate: SpaceCandidate = candidateSchema.parse({
  id: "costar-space:1",
  name: "Synthetic property 1 · Suite A",
  address: null,
  suite: "A",
  cityId: "houston",
  latitude: 29.76,
  longitude: -95.36,
  h3Index: latLngToCell(29.76, -95.36, 8),
  floorAreaSqFt: 1000,
  sizeRangeSqFt: { minimum: 1000, maximum: 1000 },
  rent: { low: 4.5, high: 4.5, rateBasisCode: 1, currencyCode: 1, measurementCode: 1, serviceTypeCode: 13 },
  spaceUseCode: 5,
  listingStatusCode: 1,
  propertyId: "1",
  sourceIds: ["costar:property:1"],
  recordDate: null,
  datasetDate: null,
  isDemo: false,
});

const requirements = normalizeRequirements(exampleIntake(), {
  revisionId: "revision-tool",
  revisionNumber: 0,
  createdAt: "2026-11-14T18:00:00.000Z",
});

test("finance tool: known fixed costs and positive margin produce required sales", () => {
  const result = requiredSalesMonthly({ fixedCostsMonthly: 10000, contributionMargin: 0.4 });
  assert.deepEqual(result, { status: "available", requiredSalesMonthly: 25000 });
});

test("finance tool: zero margin is unavailable with a reason, not a default", () => {
  const result = requiredSalesMonthly({ fixedCostsMonthly: 10000, contributionMargin: 0 });
  assert.equal(result.status, "unavailable");
  if (result.status === "unavailable") {
    assert.equal(result.requiredSalesMonthly, null);
    assert.match(result.reason, /zero contribution margin/);
  }
});

test("finance tool rejects invalid inputs at the boundary and keeps results finite", () => {
  assert.throws(() => requiredSalesMonthly({ fixedCostsMonthly: -1, contributionMargin: 0.4 }));
  assert.throws(() => requiredSalesMonthly({ fixedCostsMonthly: 10000, contributionMargin: 1.1 }));
  const unavailable = requiredSalesMonthly({ fixedCostsMonthly: 0, contributionMargin: 0.2 });
  assert.deepEqual(unavailable, { status: "available", requiredSalesMonthly: 0 });
});

test("missing financial baseline produces unavailable revenue, never invented revenue or payback", () => {
  // The intake baseline is unknown; nothing here manufactures sales or payback.
  const baseline = exampleIntake().financialBaseline;
  assert.equal(baseline.origin, "unavailable");
  assert.equal(baseline.netSales, null);
  // The tool surface only exposes what is supplied: without fixed costs there
  // is no result to compute, and the schema rejects missing fields.
  assert.throws(() => invokeTool("finance.required_sales", {}));
});

test("tool catalog exposes the four callable tools with versions and schemas", () => {
  assert.equal(TOOL_CATALOG_VERSION, "expansion-tools-v1");
  assert.deepEqual(
    TOOLS.map((tool) => tool.name),
    ["match.evaluate_space", "match.evaluate_candidates", "finance.required_sales", "finance.monthly_occupancy"],
  );
  assert.ok(toolsManifest.every((tool) => tool.name && tool.version && tool.description));
});

test("invokeTool evaluates a space and returns assessed groups", () => {
  const output = invokeTool("match.evaluate_space", { candidate, requirements, facts: [] }) as {
    assessments: unknown[];
    group: string;
  };
  assert.ok(output && "assessments" in output && "group" in output);
  const withFacts = invokeTool("match.evaluate_space", {
    candidate,
    requirements,
    facts: [
      factSchema.parse({
        id: "f-k",
        entityScope: "space",
        entityId: candidate.id,
        field: "existingKitchen",
        value: { kind: "exact", value: "verified_present" },
        unit: null,
        origin: "observed",
        source: { label: "Synthetic inspection", recordId: null, capturedAt: null },
        method: "test",
        limitations: [],
        isDemo: false,
      }),
      factSchema.parse({
        id: "f-p",
        entityScope: "space",
        entityId: candidate.id,
        field: "customerParking",
        value: { kind: "exact", value: "verified_customer_parking" },
        unit: null,
        origin: "observed",
        source: { label: "Synthetic parking verification", recordId: null, capturedAt: null },
        method: "test",
        limitations: [],
        isDemo: false,
      }),
    ],
  }) as { group: string };
  assert.ok("group" in withFacts);
});

test("invokeTool evaluates candidate lists with deterministic counts", () => {
  const output = invokeTool("match.evaluate_candidates", { candidates: [candidate], requirements, facts: [] });
  assert.ok(output && typeof output === "object" && "counts" in output && "candidates" in output);
});

test("invokeTool normalizes occupancy without double counting included charges", () => {
  const included = invokeTool("finance.monthly_occupancy", {
    candidate: { ...candidate, rent: { ...candidate.rent, serviceTypeCode: 7 } },
    extrasMonthly: 700,
    inclusion: "included",
  }) as { known: boolean; high?: number; low?: number };
  assert.ok(included && included.known === true);
  if (included.known) {
    assert.equal(included.high, 4500);
  }
  const net = invokeTool("finance.monthly_occupancy", {
    candidate,
    extrasMonthly: 700,
    inclusion: "not_included",
  }) as { known: boolean; high?: number; low?: number };
  assert.ok(net && net.known === true);
  if (net.known) {
    assert.equal(net.high, 5200);
  }
});

test("invokeTool fails explicitly for unknown tools and invalid inputs", () => {
  assert.throws(
    () => invokeTool("not.a.tool", {}),
    (error: unknown) => error instanceof ToolError && error.code === "unknown_tool",
  );
  assert.throws(
    () => invokeTool("finance.required_sales", { fixedCostsMonthly: -5, contributionMargin: 0.4 }),
    (error: unknown) => error instanceof ToolError && error.code === "invalid_input",
  );
});

test("finance tool version stays stable for Python consumers", () => {
  assert.equal(FINANCE_TOOL_VERSION, "expansion-finance-tool-v1");
});
