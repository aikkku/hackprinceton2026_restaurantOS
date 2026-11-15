/**
 * Generates the committed cross-language contract fixtures under
 * src/features/expansion/agent/fixtures/contracts + invalid.
 *
 * Run once after contract changes:  node src/features/expansion/agent/fixtures/generate.ts
 * Both the TypeScript Zod schemas (agent.test.ts) and the Python Pydantic
 * models (worker tests) must accept `contracts/*` and reject `invalid/*`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { exampleIntake } from "../../frontend/data/intake-example.ts";
import { normalizeRequirements } from "../../domain/requirements.ts";
import { financeInputsFromBaseline } from "../../domain/scenario.ts";
import {
  assessedCandidateSchema,
  evaluateCandidate,
  type SpaceCandidate,
} from "../../domain/matching.ts";
import { profileArtifactSchema } from "../../domain/agent.ts";

const root = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const contractsDir = resolve(root, "contracts");
const invalidDir = resolve(root, "invalid");
mkdirSync(contractsDir, { recursive: true });
mkdirSync(invalidDir, { recursive: true });
const write = (dir: string, name: string, value: unknown) =>
  writeFileSync(resolve(dir, name), JSON.stringify(value, null, 2) + "\n");

const intake = exampleIntake();
const revisionId = "fixture-revision-1";
const requirements = normalizeRequirements(intake, {
  revisionId,
  revisionNumber: 3,
  createdAt: "2026-11-14T12:00:00.000Z",
});

const profile = profileArtifactSchema.parse({
  artifactVersion: "expansion-agent-artifact-v1",
  modelVersion: "expansion-requirements-v1",
  intakeSchemaVersion: "1.0",
  revisionId,
  revisionNumber: 3,
  cityId: "Houston",
  intake,
  requirements,
  followUpQuestions: intake.followUpQuestions,
  financeInputs: financeInputsFromBaseline(intake.financialBaseline),
});
write(contractsDir, "profile.sample.json", profile);

const candidate = (overrides: Partial<SpaceCandidate>): SpaceCandidate =>
  assessedCandidateSchema.shape.candidate.parse({
    id: "space-synth-1",
    name: "Synthetic Plaza · Suite 101",
    address: "1 Synthetic Way",
    suite: "101",
    cityId: "Houston",
    latitude: 29.7,
    longitude: -95.4,
    h3Index: "882830829bfffff",
    floorAreaSqFt: 1000,
    sizeRangeSqFt: { minimum: 1000, maximum: 1000 },
    rent: {
      low: 4.5,
      high: 4.5,
      rateBasisCode: 1,
      currencyCode: 1,
      measurementCode: 1,
      serviceTypeCode: 7,
    },
    spaceUseCode: 5,
    listingStatusCode: 1,
    propertyId: "prop-synth-1",
    sourceIds: ["costar:listing:synth-1"],
    recordDate: "2026-11-01",
    datasetDate: "2026-11-01",
    isDemo: false,
    ...overrides,
  });

const candidates: SpaceCandidate[] = [
  candidate({}),
  candidate({
    id: "space-synth-2",
    name: "Synthetic Plaza · Suite 102",
    suite: "102",
    propertyId: "prop-synth-1",
    rent: {
      low: 6.0,
      high: 6.0,
      rateBasisCode: 1,
      currencyCode: 1,
      measurementCode: 1,
      serviceTypeCode: 10,
    },
    sourceIds: ["costar:listing:synth-2"],
  }),
  candidate({
    id: "space-synth-3",
    name: "Synthetic Annex · Suite A",
    suite: "A",
    propertyId: "prop-synth-2",
    rent: { low: null, high: null, rateBasisCode: null, currencyCode: null, measurementCode: null, serviceTypeCode: null },
    floorAreaSqFt: null,
    sizeRangeSqFt: { minimum: null, maximum: null },
    sourceIds: ["costar:listing:synth-3"],
  }),
];

const assessed = candidates.map((item, index) => {
  const assessments = evaluateCandidate(item, requirements, []);
  const group = assessedCandidateSchema.shape.group.parse(
    assessments.some((a) => a.status === "fail")
      ? "does_not_meet"
      : assessments.some((a) => ["occupancy.monthlyLimit", "space.existingKitchen", "space.customerParking"].includes(a.requirementId) && a.status === "unknown")
        ? "needs_verification"
        : "meets_assessed_requirements",
  );
  return assessedCandidateSchema.parse({
    candidate: item,
    assessments,
    group,
    rank: index,
    orderingNotes: ["Synthetic fixture ordering note."],
  });
});

const searchArtifact = {
  artifactVersion: "expansion-agent-artifact-v1",
  modelVersion: "expansion-search-v1",
  matchingModelVersion: "expansion-matching-v1",
  requirementsModelVersion: "expansion-requirements-v1",
  runId: "fixture-run",
  cityId: "Houston",
  datasetId: "fixture-dataset",
  datasetDate: "2026-11-01",
  searchedAt: "2026-11-14T12:01:00.000Z",
  cancelled: false,
  requirements,
  counts: {
    examined: 3,
    included: 3,
    excluded: 0,
    offMarket: 0,
    unknownMarketingStatus: 0,
    incompatibleUse: 0,
    useUnknown: 0,
    scanCapped: false,
    meets: 0,
    needsVerification: 2,
    doesNotMeet: 1,
  },
  candidates: assessed,
  excluded: [],
  excludedTruncated: false,
};
write(contractsDir, "candidates.sample.json", searchArtifact);

const market = {
  artifactVersion: "expansion-agent-artifact-v1",
  modelVersion: "expansion-market-tool-v1",
  runId: "fixture-run",
  cityId: "Houston",
  sourced: true,
  dataset: {
    datasetId: "fixture-dataset",
    datasetDate: "2026-11-01",
    propertyCount: 12,
    listingCount: 9,
    spaceCount: 9,
    mappableCount: 12,
  },
  sourceCapabilities: [
    {
      source: "CoStar local snapshot",
      status: "available",
      reason: "Dated local snapshot \"fixture-dataset\" is loaded for Houston.",
      detail: "dataset date 2026-11-01",
    },
    {
      source: "Neighborhood geography",
      status: "not_configured",
      reason: "No sourced Heights neighborhood boundary is committed.",
      detail: null,
    },
  ],
  unavailableReasons: ["Neighborhood geography: no sourced Heights boundary is committed."],
};
write(contractsDir, "market.sample.json", market);

const top = assessed[0];
const inspection = {
  artifactVersion: "expansion-agent-artifact-v1",
  modelVersion: "expansion-inspection-tool-v1",
  runId: "fixture-run",
  inspectedAt: "2026-11-14T12:02:00.000Z",
  candidates: [
    {
      candidateId: top.candidate.id,
      name: top.candidate.name,
      candidate: top.candidate,
      assessments: top.assessments,
      gaps: top.assessments.filter((a) => a.status !== "pass"),
      verificationTasks: [
        "Verify suite kitchen equipment with the landlord or a walkthrough.",
        "Confirm customer parking rights for the suite in the lease.",
      ],
    },
  ],
  notFoundIds: ["space-does-not-exist"],
};
write(contractsDir, "inspection.sample.json", inspection);

const finance = {
  artifactVersion: "expansion-agent-artifact-v1",
  modelVersion: "expansion-finance-tool-v1",
  runId: "fixture-run",
  evaluatedAt: "2026-11-14T12:03:00.000Z",
  occupancy: [
    {
      candidateId: "space-synth-1",
      known: true,
      low: 4500,
      high: 4500,
      notes: ["Quoted rent service includes additional charges; extras are not added again."],
      reasonCode: null,
      reason: null,
      serviceInclusion: "included",
    },
    {
      candidateId: "space-synth-2",
      known: true,
      low: 6000,
      high: null,
      notes: ["Additional charges are not included in the quoted rent and are unknown."],
      reasonCode: null,
      reason: null,
      serviceInclusion: "not_included",
    },
    {
      candidateId: "space-synth-3",
      known: false,
      low: null,
      high: null,
      notes: [],
      reasonCode: "ambiguous_basis",
      reason: "No supported asking rent was supplied for this space.",
      serviceInclusion: "unknown",
    },
  ],
  requiredSales: {
    status: "unavailable",
    requiredSalesMonthly: null,
    reason: "The financial baseline is unavailable, so no fixed costs or margin can be derived.",
    fixedCostsMonthly: null,
    contributionMargin: null,
    inputOrigin: "unavailable",
  },
  missingInputs: ["The financial baseline is unavailable, so no fixed costs or margin can be derived."],
  assumptions: [],
};
write(contractsDir, "finance.sample.json", finance);

const summary = {
  artifactVersion: "expansion-agent-artifact-v1",
  modelVersion: "expansion-agent-run-v1",
  runId: "fixture-run",
  executionMode: "scripted",
  terminalStatus: "completed_with_gaps",
  stageReports: [
    {
      stage: "readiness",
      status: "completed",
      digest: "Profile gaps and follow-ups recorded.",
      candidateIds: [],
      missing: ["budget.cashReserveToKeep"],
    },
    {
      stage: "market",
      status: "completed",
      digest: "Sourced snapshot context recorded.",
      candidateIds: [],
      missing: [],
    },
    {
      stage: "site_scout",
      status: "completed",
      digest: "Full-city search completed with deterministic assessments.",
      candidateIds: ["space-synth-1", "space-synth-2", "space-synth-3"],
      missing: [],
    },
    {
      stage: "space_inspector",
      status: "completed",
      digest: "Inspection recorded with suite-scoped gaps and verification tasks.",
      candidateIds: ["space-synth-1"],
      missing: ["Verify suite kitchen equipment with the landlord or a walkthrough."],
    },
    {
      stage: "finance",
      status: "unavailable",
      digest: "Required-sales unavailable; baseline inputs missing.",
      candidateIds: [],
      missing: ["The financial baseline is unavailable, so no fixed costs or margin can be derived."],
    },
  ],
  summaryText: "Synthetic fixture summary; every grounded detail lives in the validated artifacts.",
  missingEvidence: ["Financial baseline for required-sales scenarios (financialBaseline)"],
  followUps: ["Ask the owner for a recent sales and expense report."],
  assumptions: ["The fictional profile is labeled simulated."],
  groundedCandidateIds: ["space-synth-1"],
  completedAt: "2026-11-14T12:04:00.000Z",
};
write(contractsDir, "summary.sample.json", summary);

const events = [
  { eventVersion: "expansion-agent-event-v1", seq: 1, runId: "fixture-run", ts: "2026-11-14T12:00:00.000Z", type: "run.started", stage: null, payload: { mode: "scripted" } },
  { eventVersion: "expansion-agent-event-v1", seq: 2, runId: "fixture-run", ts: "2026-11-14T12:00:01.000Z", type: "stage.started", stage: "readiness", payload: null },
  { eventVersion: "expansion-agent-event-v1", seq: 3, runId: "fixture-run", ts: "2026-11-14T12:00:02.000Z", type: "tool.completed", stage: "readiness", payload: { tool: "profile.readiness_report", outcome: "ok" } },
  { eventVersion: "expansion-agent-event-v1", seq: 4, runId: "fixture-run", ts: "2026-11-14T12:00:03.000Z", type: "stage.completed", stage: "readiness", payload: { status: "completed", digest: "Profile readiness assessed." } },
  { eventVersion: "expansion-agent-event-v1", seq: 5, runId: "fixture-run", ts: "2026-11-14T12:04:00.000Z", type: "run.completed", stage: null, payload: { status: "completed_with_gaps", mode: "scripted" } },
];
writeFileSync(
  resolve(contractsDir, "events.sample.jsonl"),
  events.map((item) => JSON.stringify(item)).join("\n") + "\n",
);

// Invalid fixtures: each must be rejected by BOTH validators.
write(invalidDir, "summary-unknown-candidate-id.json", {
  ...summary,
  groundedCandidateIds: ["space-invented-999"],
});
write(invalidDir, "finance-negative-number.json", {
  ...finance,
  occupancy: [
    { ...finance.occupancy[0], low: -1 },
  ],
});
write(invalidDir, "profile-revision-mismatch.json", {
  ...profile,
  revisionId: "fixture-revision-OTHER",
});
write(invalidDir, "summary-invalid-status.json", {
  ...summary,
  stageReports: [
    { ...summary.stageReports[0], status: "invented_status" },
    ...summary.stageReports.slice(1),
  ],
});
write(invalidDir, "event-bad-type.jsonl", JSON.stringify({
  eventVersion: "expansion-agent-event-v1",
  seq: 1,
  runId: "fixture-run",
  ts: "2026-11-14T12:00:00.000Z",
  type: "run.invented",
  stage: null,
  payload: null,
}) + "\n");

console.log("fixtures written:", resolve(root));
