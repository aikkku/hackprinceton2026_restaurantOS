/**
 * Cross-language integration: the REAL Python Deep Agents worker process
 * (scripted deterministic model double, real framework dispatch) talking to
 * the REAL TypeScript tool bridge through the REAL agent service.
 *
 * This is not a mock of either boundary: the worker subprocess runs the
 * deepagents graph, the HTTP bridge executes invokeAgentTool/verifyToolToken
 * against a seeded synthetic dataset, and the run is polled through the
 * actual persisted run store. Skips when the worker environment is missing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { exampleIntake } from "./frontend/data/intake-example.ts";
import {
  agentEventSchema,
  financeArtifactSchema,
  inspectionArtifactSchema,
  marketArtifactSchema,
  searchArtifactSchema,
  summaryArtifactSchema,
  validateSummaryAgainstSearch,
  type AgentRunRecord,
} from "./domain/agent.ts";
import {
  agentCapabilities,
  createAgentRun,
  getAgentRun,
  invokeAgentTool,
  verifyToolToken,
} from "./backend/agent.ts";
import { importLocalDataset, type LocalConfig } from "./backend/local-dataset.ts";

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
const listing = (id: number, spaces: unknown[]) => ({
  id,
  propertyId: 1,
  listingStatus: 1,
  certifiedFreshDate: "2026-01-02T00:00:00Z",
  forLeaseSummary: { askingRateMeasurementType: 1, spaces },
});

const capabilities = agentCapabilities({});
if (!capabilities.workerReady) {
  test("cross-language worker integration", { skip: "worker venv not available" }, () => {});
} else {
  test("real worker + real bridge complete the five-stage run", { timeout: 240000 }, async () => {
    // Workspace-scoped temp dirs: spawned children must write inside the
    // repository (platform temp dirs can be sandbox-restricted for them).
    const agentTmp = join(process.cwd(), "src", "features", "expansion", "agent", ".tmp");
    await mkdir(agentTmp, { recursive: true });
    const dbDir = await mkdtemp(join(agentTmp, "int-db-"));
    const runsDir = await mkdtemp(join(agentTmp, "int-runs-"));
    const settings: LocalConfig = {
      rootPath: dbDir,
      dbPath: join(dbDir, "cache.sqlite"),
      datasetId: "synthetic-agent-integration",
      datasetDate: "2026-11-01",
    };
    await mkdir(join(dbDir, "data"));
    await writeFile(join(dbDir, "data/commercial-property.jsonl"), JSON.stringify(property(1)));
    await writeFile(
      join(dbDir, "data/commercial-listing-summary.jsonl"),
      JSON.stringify(listing(10, [space(1), space(2, { rateLow: 8, rateHigh: 8 }), space(3, { spaceUse: 1 })])),
    );
    await importLocalDataset(settings);

    let server: Server | null = null;
    try {
      server = createServer(async (request, response) => {
        if (request.url !== "/api/expansion/agent-tools" || request.method !== "POST") {
          response.writeHead(404, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: { code: "not_found", message: "unknown route" } }));
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const auth = request.headers.authorization ?? null;
        if (!verifyToolToken({ runsDir, db: settings }, body.sessionId ?? "local", body.runId, auth)) {
          response.writeHead(401, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: { code: "unauthorized", message: "bad token" } }));
          return;
        }
        try {
          const output = await invokeAgentTool(
            { runsDir, db: settings },
            body.sessionId ?? "local",
            body.runId,
            body.tool,
            body.input,
          );
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: true, output }));
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? String(error.code) : "source_failure";
          const status = code === "unauthorized" ? 401 : code === "not_found" ? 404 : code === "conflict" ? 409 : 400;
          response.writeHead(status, { "Content-Type": "application/json" });
          response.end(JSON.stringify({
            ok: false,
            error: { code, message: error instanceof Error ? error.message : "tool failed" },
          }));
        }
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no bridge address");
      const bridgeUrl = `http://127.0.0.1:${address.port}`;

      const runId = "integration-run-1";
      const workerLog = join(runsDir, "worker-stderr.log");
      process.env.EXPANSION_AGENT_WORKER_LOG = workerLog;
      const created = await createAgentRun(
        { runsDir, db: settings, bridgeBaseUrl: bridgeUrl, spawn: true },
        {
          runId,
          sessionId: "local",
          cityId: "houston",
          intake: exampleIntake(),
          revisionId: "integration-revision",
          revisionNumber: 1,
          executionMode: "scripted",
        },
      );
      assert.equal(created.created, true);
      assert.equal(created.record.status, "queued");

      // Poll the persisted run store until the worker reaches a terminal state.
      let record: AgentRunRecord | null = null;
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        record = getAgentRun({ runsDir }, "local", runId);
        if (["completed", "completed_with_gaps", "failed", "cancelled"].includes(record.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      assert.ok(record, "run record missing");
      if (record.status !== "completed_with_gaps") {
        let log = "no worker stderr captured";
        try {
          log = await readFile(workerLog, "utf8");
        } catch {
          /* log missing */
        }
        console.error("worker stderr:", log.slice(0, 4000));
      }
      assert.equal(record.status, "completed_with_gaps");
      assert.equal(record.executionMode, "scripted");
      assert.equal(record.model?.framework, "deepagents");
      assert.deepEqual(record.stages, {
        readiness: "completed",
        market: "completed",
        site_scout: "completed",
        space_inspector: "completed",
        finance: "unavailable", // Cedar Kitchen baseline is unavailable (honest)
      });

      const dir = join(runsDir, "local", `agent-${runId}`);

      // Replayable events: strictly increasing, started and completed.
      const lines = (await readFile(join(dir, "events.jsonl"), "utf8")).split("\n").filter((line) => line.trim());
      const events = lines.map((line) => agentEventSchema.parse(JSON.parse(line)));
      assert.deepEqual(events.map((event) => event.seq), events.map((_, index) => index + 1));
      assert.equal(events[0].type, "run.started");
      assert.equal(events[events.length - 1].type, "run.completed");
      assert.ok(events.some((event) => event.type === "tool.completed" && event.payload?.tool === "scout.search_city"));
      assert.ok(events.some((event) => event.type === "tool.completed" && event.payload?.tool === "finance.monthly_occupancy"));
      assert.ok(events.some((event) => event.type === "unavailable" && event.stage === "finance"));

      // Every required artifact exists and validates; IDs ground in the search.
      const search = searchArtifactSchema.parse(JSON.parse(await readFile(join(dir, "candidates.json"), "utf8")));
      assert.equal(search.counts.included, 2);
      marketArtifactSchema.parse(JSON.parse(await readFile(join(dir, "market.json"), "utf8")));
      inspectionArtifactSchema.parse(JSON.parse(await readFile(join(dir, "inspection.json"), "utf8")));
      const finance = financeArtifactSchema.parse(JSON.parse(await readFile(join(dir, "finance.json"), "utf8")));
      assert.equal(finance.requiredSales?.status, "unavailable");
      assert.ok(finance.occupancy.length > 0);
      const summary = summaryArtifactSchema.parse(JSON.parse(await readFile(join(dir, "summary.json"), "utf8")));
      validateSummaryAgainstSearch(summary, search);
      assert.ok(summary.groundedCandidateIds.length > 0);
      assert.equal(record.datasetId, "synthetic-agent-integration");

      // Worker restart behavior: a second create returns the terminal record.
      const again = await createAgentRun(
        { runsDir, db: settings, bridgeBaseUrl: bridgeUrl, spawn: true },
        {
          runId,
          sessionId: "local",
          cityId: "houston",
          intake: exampleIntake(),
          revisionId: "integration-revision",
          revisionNumber: 1,
          executionMode: "scripted",
        },
      );
      assert.equal(again.created, false);
      assert.equal(again.record.status, "completed_with_gaps");
    } finally {
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
      await rm(dbDir, { recursive: true, force: true });
      await rm(runsDir, { recursive: true, force: true });
    }
  });
}
