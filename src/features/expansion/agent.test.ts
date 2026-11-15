import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { exampleIntake } from "./frontend/data/intake-example.ts";
import {
  agentEventSchema,
  agentRunRecordSchema,
  financeArtifactSchema,
  inspectionArtifactSchema,
  marketArtifactSchema,
  profileArtifactSchema,
  searchArtifactSchema,
  summaryArtifactSchema,
  validateSummaryAgainstSearch,
} from "./domain/agent.ts";
import {
  AGENT_RUN_STALE_MS,
  cancelAgentRun,
  createAgentRun,
  getAgentArtifact,
  getAgentRun,
  invokeAgentTool,
  readAgentEvents,
  verifyToolToken,
} from "./backend/agent.ts";
import { RunError } from "./backend/runs.ts";
import { importLocalDataset, type LocalConfig } from "./backend/local-dataset.ts";
import { POST as createAgentRunRoute } from "../../app/api/expansion/agent-runs/route.ts";
import { GET as getAgentRunRoute } from "../../app/api/expansion/agent-runs/[id]/route.ts";
import { POST as cancelAgentRoute } from "../../app/api/expansion/agent-runs/[id]/cancel/route.ts";
import { GET as eventsRoute } from "../../app/api/expansion/agent-runs/[id]/events/route.ts";
import { POST as toolBridgeRoute } from "../../app/api/expansion/agent-tools/route.ts";
import { GET as capabilitiesRoute } from "../../app/api/expansion/agent-capabilities/route.ts";

const fixtureDir = fileURLToPath(new URL("./agent/fixtures", import.meta.url));

const property = (id: number) => ({
  id,
  buildingName: `Synthetic property ${id}`,
  propertyType: 6,
  primaryAddress: {
    researchMarketId: 14,
    streetNumber: String(id),
    streetName: "Synthetic",
    streetType: "Street",
    latitude: 29.76,
    longitude: -95.36,
  },
});
const space = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  propertyId: 1,
  rateLow: 2,
  rateHigh: 2,
  rateBasis: 1,
  monetaryUnit: 1,
  serviceType: 13,
  squareFeetMin: 1200,
  squareFeetMax: 1200,
  spaceUse: 5,
  availabilityType: null,
  ...extra,
});
const listing = (id: number, spaces: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  propertyId: 1,
  listingStatus: 1,
  certifiedFreshDate: "2026-01-02T00:00:00Z",
  forLeaseSummary: { askingRateMeasurementType: 1, spaces },
  ...extra,
});

const testRunsDir = await mkdtemp(join(tmpdir(), "restaurantos-agent-runs-"));
const testDb = await mkdtemp(join(tmpdir(), "restaurantos-agent-db-"));
process.env.EXPANSION_AGENT_SPAWN = "0";
process.env.EXPANSION_AGENT_RUNS_DIR = testRunsDir;

const settings: LocalConfig = {
  rootPath: testDb,
  dbPath: join(testDb, "cache.sqlite"),
  datasetId: "synthetic-agent-tests",
  datasetDate: "2026-11-01",
};
await mkdir(join(testDb, "data"));
await writeFile(join(testDb, "data/commercial-property.jsonl"), JSON.stringify(property(1)));
await writeFile(
  join(testDb, "data/commercial-listing-summary.jsonl"),
  JSON.stringify(listing(10, [space(1), space(2, { rateLow: 8, rateHigh: 8 }), space(3, { spaceUse: 1 })])),
);
await importLocalDataset(settings);

const intake = exampleIntake();
const createInput = (runId: string, mode: "live" | "scripted" = "scripted") => ({
  runId,
  sessionId: "local",
  cityId: "houston",
  intake,
  revisionId: "agent-test-revision",
  revisionNumber: 1,
  executionMode: mode,
});

async function writeToken(runId: string, token: string) {
  await writeFile(
    join(testRunsDir, "local", `agent-${runId}`, "tool.token.sha256"),
    createHash("sha256").update(token).digest("hex"),
  );
}

test.after(async () => {
  await rm(testRunsDir, { recursive: true, force: true });
  await rm(testDb, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Cross-language contract fixtures

test("contract fixtures: valid samples parse with the TS schemas", async () => {
  const cases: Array<[string, import("zod").ZodType]> = [
    ["profile.sample.json", profileArtifactSchema],
    ["market.sample.json", marketArtifactSchema],
    ["candidates.sample.json", searchArtifactSchema],
    ["inspection.sample.json", inspectionArtifactSchema],
    ["finance.sample.json", financeArtifactSchema],
    ["summary.sample.json", summaryArtifactSchema],
  ];
  for (const [name, schema] of cases) {
    const payload = JSON.parse(await readFile(join(fixtureDir, "contracts", name), "utf8"));
    assert.doesNotThrow(() => schema.parse(payload), `${name} must parse`);
  }
  const lines = (await readFile(join(fixtureDir, "contracts", "events.sample.jsonl"), "utf8"))
    .split("\n")
    .filter((line) => line.trim());
  const events = lines.map((line) => agentEventSchema.parse(JSON.parse(line)));
  assert.deepEqual(events.map((event) => event.seq), [1, 2, 3, 4, 5]);
});

test("contract fixtures: invalid samples are rejected", async () => {
  const cases: Array<[string, import("zod").ZodType]> = [
    ["finance-negative-number.json", financeArtifactSchema],
    ["profile-revision-mismatch.json", profileArtifactSchema],
    ["summary-invalid-status.json", summaryArtifactSchema],
  ];
  for (const [name, schema] of cases) {
    const payload = JSON.parse(await readFile(join(fixtureDir, "invalid", name), "utf8"));
    assert.throws(() => schema.parse(payload), `${name} must be rejected`);
  }
  const badEvent = JSON.parse(
    (await readFile(join(fixtureDir, "invalid", "event-bad-type.jsonl"), "utf8")).trim(),
  );
  assert.throws(() => agentEventSchema.parse(badEvent));
});

test("contract fixtures: cross-artifact grounding rejects unknown IDs", async () => {
  const search = searchArtifactSchema.parse(
    JSON.parse(await readFile(join(fixtureDir, "contracts", "candidates.sample.json"), "utf8")),
  );
  const valid = summaryArtifactSchema.parse(
    JSON.parse(await readFile(join(fixtureDir, "contracts", "summary.sample.json"), "utf8")),
  );
  assert.doesNotThrow(() => validateSummaryAgainstSearch(valid, search));
  const invalid = summaryArtifactSchema.parse({
    ...valid,
    groundedCandidateIds: ["space-invented-999"],
  });
  assert.throws(() => validateSummaryAgainstSearch(invalid, search));
});

// ---------------------------------------------------------------------------
// Agent run service

test("createAgentRun persists request/profile and is idempotent", async () => {
  const first = await createAgentRun({ runsDir: testRunsDir, spawn: false }, createInput("service-run-1"));
  assert.equal(first.created, true);
  assert.equal(first.record.status, "queued");
  assert.equal(first.record.executionMode, "scripted");
  assert.deepEqual(first.record.stages, {
    readiness: "not_run",
    market: "not_run",
    site_scout: "not_run",
    space_inspector: "not_run",
    finance: "not_run",
  });

  const again = await createAgentRun({ runsDir: testRunsDir, spawn: false }, createInput("service-run-1"));
  assert.equal(again.created, false);
  assert.equal(again.record.runId, "service-run-1");

  const conflicting = { ...createInput("service-run-1"), revisionNumber: 2 };
  await assert.rejects(
    () => createAgentRun({ runsDir: testRunsDir, spawn: false }, conflicting),
    (error: unknown) => error instanceof RunError && error.code === "conflict",
  );

  const dir = join(testRunsDir, "local", "agent-service-run-1");
  const request = JSON.parse(await readFile(join(dir, "request.json"), "utf8"));
  assert.equal(request.requestVersion, "expansion-agent-run-v1");
  assert.equal(request.profile.intakeSchemaVersion, "1.0");
  const profile = profileArtifactSchema.parse(
    JSON.parse(await readFile(join(dir, "profile.json"), "utf8")),
  );
  assert.equal(profile.revisionId, "agent-test-revision");
  assert.equal(profile.financeInputs.origin, "unavailable");
});

test("unsupported markets are rejected before any run state exists", async () => {
  const bad = createInput("service-run-2");
  bad.intake = {
    ...intake,
    expansion: { ...intake.expansion, targetCountry: "CA" },
  };
  await assert.rejects(() => createAgentRun({ runsDir: testRunsDir, spawn: false }, bad));
  await assert.rejects(() => readFile(join(testRunsDir, "local", "agent-service-run-2", "run.json"), "utf8"));
});

test("cancel a queued agent run leaves a terminal record", async () => {
  await createAgentRun({ runsDir: testRunsDir, spawn: false }, createInput("service-run-3"));
  const cancelled = cancelAgentRun({ runsDir: testRunsDir }, "local", "service-run-3");
  assert.equal(cancelled.status, "cancelled");
  assert.ok(cancelled.cancelledAt);
  assert.throws(() => cancelAgentRun({ runsDir: testRunsDir }, "local", "service-run-3"));
  assert.equal(getAgentRun({ runsDir: testRunsDir }, "local", "service-run-3").status, "cancelled");
});

test("stale running agent runs recover as failed and never succeed", async () => {
  await createAgentRun({ runsDir: testRunsDir, spawn: false }, createInput("service-run-4"));
  const path = join(testRunsDir, "local", "agent-service-run-4", "run.json");
  const record = agentRunRecordSchema.parse(JSON.parse(await readFile(path, "utf8")));
  await writeFile(
    path,
    JSON.stringify({
      ...record,
      status: "running",
      updatedAt: new Date(Date.now() - AGENT_RUN_STALE_MS - 60_000).toISOString(),
    }),
  );
  const recovered = getAgentRun({ runsDir: testRunsDir }, "local", "service-run-4");
  assert.equal(recovered.status, "failed");
  assert.equal(recovered.error?.code, "interrupted");
  // Terminal immutability: repeated reads keep the failed state.
  assert.equal(getAgentRun({ runsDir: testRunsDir }, "local", "service-run-4").status, "failed");
});

test("session isolation: another session cannot read this run", async () => {
  await createAgentRun({ runsDir: testRunsDir, spawn: false }, createInput("service-run-5"));
  assert.throws(() => getAgentRun({ runsDir: testRunsDir }, "other-session", "service-run-5"));
});

// ---------------------------------------------------------------------------
// Tool bridge

test("tool bridge requires a valid run-scoped token", async () => {
  await createAgentRun({ runsDir: testRunsDir, spawn: false }, createInput("bridge-run-1"));
  await writeToken("bridge-run-1", "bridge-token-1");
  assert.equal(verifyToolToken({ runsDir: testRunsDir }, "local", "bridge-run-1", "Bearer bridge-token-1"), true);
  assert.equal(verifyToolToken({ runsDir: testRunsDir }, "local", "bridge-run-1", "Bearer wrong"), false);
  assert.equal(verifyToolToken({ runsDir: testRunsDir }, "local", "bridge-run-1", null), false);
  assert.equal(verifyToolToken({ runsDir: testRunsDir }, "local", "other-run", "Bearer bridge-token-1"), false);
});

test("readiness tool is bound to the run's profile revision", async () => {
  await createAgentRun({ runsDir: testRunsDir, spawn: false }, createInput("bridge-run-2"));
  await writeToken("bridge-run-2", "bridge-token-2");
  const config = { runsDir: testRunsDir, db: settings, spawn: false };
  const output = await invokeAgentTool(config, "local", "bridge-run-2", "profile.readiness_report", {
    revisionId: "agent-test-revision",
    revisionNumber: 1,
  });
  const readiness = output as { followUpQuestions: unknown[]; tacticalReport: null; completeness: { missing: unknown[] } };
  assert.equal(readiness.followUpQuestions.length, 3);
  assert.equal(readiness.tacticalReport, null);
  assert.ok(readiness.completeness.missing.length >= 3);
  await assert.rejects(
    () => invokeAgentTool(config, "local", "bridge-run-2", "profile.readiness_report", {
      revisionId: "someone-else",
      revisionNumber: 0,
    }),
  );
});

test("scout/inspector/finance tools stay run-scoped and validated", async () => {
  await createAgentRun({ runsDir: testRunsDir, spawn: false }, createInput("bridge-run-3"));
  await writeToken("bridge-run-3", "bridge-token-3");
  const config = { runsDir: testRunsDir, db: settings, spawn: false };

  const scout = (await invokeAgentTool(config, "local", "bridge-run-3", "scout.search_city", {
    cityId: "houston",
  })) as { candidateIds: string[]; counts: Record<string, number> };
  assert.ok(scout.candidateIds.length > 0);
  assert.equal(scout.counts.included, 2);
  assert.equal(scout.counts.incompatibleUse, 1);

  const stored = searchArtifactSchema.parse(
    JSON.parse(await readFile(join(testRunsDir, "local", "agent-bridge-run-3", "candidates.json"), "utf8")),
  );
  assert.equal(stored.candidates.length, 2);

  const inspector = (await invokeAgentTool(config, "local", "bridge-run-3", "inspector.evidence", {
    candidateIds: [scout.candidateIds[0], "not-a-candidate"],
  })) as { inspected: unknown[]; notFoundIds: string[] };
  assert.equal(inspector.inspected.length, 1);
  assert.deepEqual(inspector.notFoundIds, ["not-a-candidate"]);

  const occupancy = await invokeAgentTool(config, "local", "bridge-run-3", "finance.monthly_occupancy", {
    candidateId: scout.candidateIds[0],
    extrasMonthly: null,
  });
  assert.ok(typeof occupancy === "object" && occupancy !== null && "known" in occupancy);
  // The model can never smuggle additional-charges evidence into this run.
  await assert.rejects(
    () => invokeAgentTool(config, "local", "bridge-run-3", "finance.monthly_occupancy", {
      candidateId: scout.candidateIds[0],
      extrasMonthly: 700,
    }),
  );

  // Cedar Kitchen has no financial baseline: required sales stays unavailable.
  const requiredSales = await invokeAgentTool(config, "local", "bridge-run-3", "finance.required_sales", {
    fixedCostsMonthly: null,
    contributionMargin: null,
  });
  assert.equal((requiredSales as { status: string }).status, "unavailable");
  // Model-proposed numbers can never produce a computed result: the bridge
  // returns the profile-derived unavailable outcome instead of arithmetic.
  const fabricated = await invokeAgentTool(config, "local", "bridge-run-3", "finance.required_sales", {
    fixedCostsMonthly: 10000,
    contributionMargin: 0.4,
  });
  assert.equal((fabricated as { status: string; requiredSalesMonthly: null }).status, "unavailable");
  assert.equal((fabricated as { requiredSalesMonthly: null }).requiredSalesMonthly, null);

  // Unknown tools and path/URL injection are rejected at the boundary.
  await assert.rejects(
    () => invokeAgentTool(config, "local", "bridge-run-3", "filesystem.read_file", { path: "../../.env" }),
  );
});

test("market context tool persists a validated artifact", async () => {
  await createAgentRun({ runsDir: testRunsDir, spawn: false }, createInput("bridge-run-4"));
  await writeToken("bridge-run-4", "bridge-token-4");
  const output = (await invokeAgentTool({ runsDir: testRunsDir, db: settings, spawn: false }, "local", "bridge-run-4", "market.context", {
    cityId: "houston",
  })) as { sourced: boolean; dataset: { datasetId: string } | null };
  assert.equal(output.sourced, true);
  assert.equal(output.dataset?.datasetId, "synthetic-agent-tests");
  const market = marketArtifactSchema.parse(
    JSON.parse(await readFile(join(testRunsDir, "local", "agent-bridge-run-4", "market.json"), "utf8")),
  );
  assert.ok(market.sourceCapabilities.some((item) => item.source === "ACS demographics"));
  await assert.rejects(
    () => invokeAgentTool({ runsDir: testRunsDir, db: settings, spawn: false }, "local", "bridge-run-4", "market.context", {
      cityId: "Los Angeles",
    }),
  );
});

// ---------------------------------------------------------------------------
// Events + SSE replay

test("readAgentEvents replays strictly after a sequence without duplicates", async () => {
  await createAgentRun({ runsDir: testRunsDir, spawn: false }, createInput("events-run-1"));
  const eventsFile = join(testRunsDir, "local", "agent-events-run-1", "events.jsonl");
  const events = [
    { eventVersion: "expansion-agent-event-v1", seq: 1, runId: "events-run-1", ts: "2026-11-14T12:00:00.000Z", type: "run.started", stage: null, payload: { mode: "scripted" } },
    { eventVersion: "expansion-agent-event-v1", seq: 2, runId: "events-run-1", ts: "2026-11-14T12:00:01.000Z", type: "stage.started", stage: "readiness", payload: null },
    { eventVersion: "expansion-agent-event-v1", seq: 3, runId: "events-run-1", ts: "2026-11-14T12:00:02.000Z", type: "run.completed", stage: null, payload: { status: "completed" } },
  ];
  await mkdir(join(testRunsDir, "local", "agent-events-run-1"), { recursive: true });
  await writeFile(eventsFile, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  const full = readAgentEvents({ runsDir: testRunsDir }, "local", "events-run-1");
  assert.equal(full.lastSeq, 3);
  const tail = readAgentEvents({ runsDir: testRunsDir }, "local", "events-run-1", 1);
  assert.deepEqual(tail.events.map((event) => event.seq), [2, 3]);
  assert.deepEqual(readAgentEvents({ runsDir: testRunsDir }, "local", "events-run-1", 3).events, []);
});

test("SSE route replays from Last-Event-ID and closes after terminal", async () => {
  await createAgentRun({ runsDir: testRunsDir, spawn: false }, createInput("events-run-2"));
  const dir = join(testRunsDir, "local", "agent-events-run-2");
  const eventsFile = join(dir, "events.jsonl");
  await writeFile(
    eventsFile,
    [
      { eventVersion: "expansion-agent-event-v1", seq: 1, runId: "events-run-2", ts: "2026-11-14T12:00:00.000Z", type: "run.started", stage: null, payload: { mode: "scripted" } },
      { eventVersion: "expansion-agent-event-v1", seq: 2, runId: "events-run-2", ts: "2026-11-14T12:00:01.000Z", type: "run.completed", stage: null, payload: { status: "completed" } },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n",
  );
  // Mark the run terminal so the stream replays and closes.
  const path = join(dir, "run.json");
  const record = agentRunRecordSchema.parse(JSON.parse(await readFile(path, "utf8")));
  await writeFile(path, JSON.stringify({ ...record, status: "completed", completedAt: "2026-11-14T12:00:02.000Z" }));

  const request = new Request("http://test.local/api/expansion/agent-runs/events-run-2/events?after=1", {
    headers: { "x-expansion-session": "local" },
  });
  const response = await eventsRoute(request, { params: Promise.resolve({ id: "events-run-2" }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  const text = await response.text();
  assert.match(text, /id: 2\nevent: run\.completed/);
  assert.doesNotMatch(text, /id: 1\n/);
  assert.match(text, /event: done/);
});

// ---------------------------------------------------------------------------
// Routes

test("agent-runs route creates a queued run (spawn disabled)", async () => {
  const request = new Request("http://test.local/api/expansion/agent-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-expansion-session": "local" },
    body: JSON.stringify(createInput("route-run-1")),
  });
  const response = await createAgentRunRoute(request);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.runId, "route-run-1");
  assert.equal(body.status, "queued");
});

test("agent-runs route is idempotent and conflicts on payload drift", async () => {
  const first = new Request("http://test.local/api/expansion/agent-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createInput("route-run-2")),
  });
  assert.equal((await createAgentRunRoute(first)).status, 201);
  const again = new Request("http://test.local/api/expansion/agent-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createInput("route-run-2")),
  });
  assert.equal((await createAgentRunRoute(again)).status, 200);
  const drift = new Request("http://test.local/api/expansion/agent-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...createInput("route-run-2"), revisionNumber: 9 }),
  });
  assert.equal((await createAgentRunRoute(drift)).status, 409);
});

test("agent run status/cancel routes work end to end", async () => {
  const create = new Request("http://test.local/api/expansion/agent-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createInput("route-run-3")),
  });
  await createAgentRunRoute(create);
  const status = await getAgentRunRoute(
    new Request("http://test.local/api/expansion/agent-runs/route-run-3", { headers: { "x-expansion-session": "local" } }),
    { params: Promise.resolve({ id: "route-run-3" }) },
  );
  assert.equal((await status.json()).status, "queued");
  const cancel = await cancelAgentRoute(
    new Request("http://test.local/api/expansion/agent-runs/route-run-3/cancel", {
      method: "POST",
      headers: { "x-expansion-session": "local" },
    }),
    { params: Promise.resolve({ id: "route-run-3" }) },
  );
  assert.equal((await cancel.json()).status, "cancelled");
  const cancelAgain = await cancelAgentRoute(
    new Request("http://test.local/api/expansion/agent-runs/route-run-3/cancel", {
      method: "POST",
      headers: { "x-expansion-session": "local" },
    }),
    { params: Promise.resolve({ id: "route-run-3" }) },
  );
  assert.equal(cancelAgain.status, 409);
});

test("tool bridge route enforces auth, allowlist and scoping", async () => {
  const create = new Request("http://test.local/api/expansion/agent-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(createInput("route-run-4")),
  });
  await createAgentRunRoute(create);
  await writeToken("route-run-4", "route-token-4");

  const call = async (tool: string, input: unknown, auth: string | null) => {
    const response = await toolBridgeRoute(
      new Request("http://test.local/api/expansion/agent-tools", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
        body: JSON.stringify({ runId: "route-run-4", sessionId: "local", tool, input }),
      }),
    );
    return { status: response.status, body: await response.json() };
  };

  const unauth = await call("profile.readiness_report", { revisionId: "agent-test-revision", revisionNumber: 1 }, null);
  assert.equal(unauth.status, 401);

  const unknown = await call("shell.exec", { command: "whoami" }, "route-token-4");
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error.code, "unknown_tool");

  const pathInjection = await call("scout.search_city", { cityId: "../../etc" }, "route-token-4");
  assert.equal(pathInjection.status, 400);

  const ok = await call("profile.readiness_report", { revisionId: "agent-test-revision", revisionNumber: 1 }, "route-token-4");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);
});

test("capabilities route reports worker/model state without secrets", async () => {
  const response = await capabilitiesRoute();
  const body = await response.json();
  assert.equal(body.agentEnabled, true);
  assert.equal(body.framework, "deepagents");
  assert.equal(typeof body.workerReady, "boolean");
  assert.equal(typeof body.modelConfigured, "boolean");
  assert.doesNotMatch(JSON.stringify(body), /sk-|api[_-]?key/i);
});

test("artifact route validates stored artifacts", async () => {
  await createAgentRun({ runsDir: testRunsDir, spawn: false }, createInput("artifact-run-1"));
  const profile = getAgentArtifact({ runsDir: testRunsDir }, "local", "artifact-run-1", "profile");
  assert.equal((profile as { revisionId: string }).revisionId, "agent-test-revision");
  assert.throws(() => getAgentArtifact({ runsDir: testRunsDir }, "local", "artifact-run-1", "summary"));
});
