/**
 * Bounded live model/framework proof (Phase 3 gate).
 *
 * Usage (from the repository root, with a provider key present — e.g.
 * GEMINI_API_KEY / GOOGLE_API_KEY in .env.local):
 *
 *   node src/features/expansion/agent/live-proof.ts
 *
 * What it proves: the real deepagents planner delegates to the five
 * specialists through the real framework, the worker calls the real
 * TypeScript tool bridge, and a REAL provider model drives the planner and
 * specialists end to end — using only explicitly labeled synthetic data
 * (the fictional Cedar Kitchen intake + a seeded synthetic dataset). It
 * never sends private data and never prints keys, tokens or model payloads.
 *
 * On success it prints: timestamp, framework/provider/model versions, the
 * five delegated role names with their terminal statuses, tool-call counts,
 * terminal status and the validated summary evidence. On failure it prints
 * the honest redacted error code.
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exampleIntake } from "../frontend/data/intake-example.ts";
import {
  agentEventSchema,
  summaryArtifactSchema,
  searchArtifactSchema,
  type AgentRunRecord,
} from "../domain/agent.ts";
import {
  createAgentRun,
  getAgentRun,
  invokeAgentTool,
  verifyToolToken,
} from "../backend/agent.ts";
import { importLocalDataset, type LocalConfig } from "../backend/local-dataset.ts";
import { resolveWorkerPython } from "../backend/worker.ts";

// Load .env.local names into the process env (values are never printed).
function loadEnvLocal() {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (name && value && !(name in process.env)) process.env[name] = value;
  }
}

const property = {
  id: 1,
  buildingName: "Synthetic proof property",
  propertyType: 6,
  primaryAddress: {
    researchMarketId: 14,
    streetNumber: "1",
    streetName: "Synthetic",
    streetType: "Street",
    latitude: 29.76,
    longitude: -95.36,
  },
};
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
const listing = {
  id: 10,
  propertyId: 1,
  listingStatus: 1,
  certifiedFreshDate: "2026-01-02T00:00:00Z",
  forLeaseSummary: {
    askingRateMeasurementType: 1,
    spaces: [space(1), space(2, { rateLow: 8, rateHigh: 8 }), space(3, { spaceUse: 1 })],
  },
};

async function main() {
  loadEnvLocal();
  console.log("worker python:", resolveWorkerPython());
  const agentTmp = join(process.cwd(), "src", "features", "expansion", "agent", ".tmp");
  await mkdir(agentTmp, { recursive: true });
  const dbDir = await mkdtemp(join(agentTmp, "live-proof-db-"));
  const runsDir = await mkdtemp(join(agentTmp, "live-proof-runs-"));
  const settings: LocalConfig = {
    rootPath: dbDir,
    dbPath: join(dbDir, "cache.sqlite"),
    datasetId: "synthetic-live-proof",
    datasetDate: "2026-11-01",
  };
  await mkdir(join(dbDir, "data"));
  await writeFile(join(dbDir, "data/commercial-property.jsonl"), JSON.stringify(property));
  await writeFile(join(dbDir, "data/commercial-listing-summary.jsonl"), JSON.stringify(listing));
  await importLocalDataset(settings);

  let server: Server | null = null;
  try {
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      try {
        if (!verifyToolToken({ runsDir, db: settings }, body.sessionId ?? "local", body.runId, request.headers.authorization ?? null)) {
          response.writeHead(401, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, error: { code: "unauthorized", message: "bad token" } }));
          return;
        }
        const output = await invokeAgentTool({ runsDir, db: settings }, body.sessionId ?? "local", body.runId, body.tool, body.input);
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true, output }));
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "source_failure";
        const status = code === "unauthorized" ? 401 : code === "not_found" ? 404 : code === "conflict" ? 409 : 400;
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: { code, message: error instanceof Error ? error.message : "tool failed" } }));
      }
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no bridge address");
    const bridgeUrl = `http://127.0.0.1:${address.port}`;

    const runId = `live-proof-${Date.now()}`;
    const workerLog = join(runsDir, "worker-stderr.log");
    process.env.EXPANSION_AGENT_WORKER_LOG = workerLog;
    const created = await createAgentRun(
      { runsDir, db: settings, bridgeBaseUrl: bridgeUrl, spawn: true },
      {
        runId,
        sessionId: "local",
        cityId: "houston",
        intake: exampleIntake(),
        revisionId: "live-proof-revision",
        revisionNumber: 1,
        executionMode: "live",
      },
    );
    console.log("run id:", runId, "| created:", created.created);

    let record: AgentRunRecord | null = null;
    const deadline = Date.now() + 12 * 60_000;
    while (Date.now() < deadline) {
      record = getAgentRun({ runsDir }, "local", runId);
      if (["completed", "completed_with_gaps", "failed", "cancelled"].includes(record.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    if (!record) throw new Error("no terminal state within the deadline");
    console.log("terminal status:", record.status);
    console.log("model:", JSON.stringify(record.model));
    console.log("error:", JSON.stringify(record.error));
    console.log("updatedAt:", record.updatedAt);
    console.log("stages:", JSON.stringify(record.stages));
    console.log("toolCalls:", JSON.stringify(record.toolCalls));

    const dir = join(runsDir, "local", `agent-${runId}`);
    const lines = (await readFile(join(dir, "events.jsonl"), "utf8")).split("\n").filter((line) => line.trim());
    const events = lines.map((line) => agentEventSchema.parse(JSON.parse(line)));
    console.log("events:", events.map((event) => event.type + (event.stage ? `(${event.stage})` : "")).join(" "));

    if (record.status === "completed" || record.status === "completed_with_gaps") {
      const summary = summaryArtifactSchema.parse(JSON.parse(await readFile(join(dir, "summary.json"), "utf8")));
      const search = searchArtifactSchema.parse(JSON.parse(await readFile(join(dir, "candidates.json"), "utf8")));
      console.log("summary terminalStatus:", summary.terminalStatus);
      console.log("groundedCandidateIds:", summary.groundedCandidateIds.join(", ") || "(none)");
      console.log("candidate count:", search.candidates.length, "| meets:", search.counts.meets, "| needsVerification:", search.counts.needsVerification, "| doesNotMeet:", search.counts.doesNotMeet);
      for (const report of summary.stageReports) {
        console.log(`  ${report.stage}: ${report.status} — ${report.digest.slice(0, 160)}`);
      }
      console.log("missingEvidence:", summary.missingEvidence.join(" | ") || "(none)");
    }
    if (record.status === "failed") {
      try {
        console.log("worker stderr (first lines):", (await readFile(workerLog, "utf8")).split("\n").slice(0, 8).join("\n"));
      } catch {
        console.log("worker stderr: (none)");
      }
    }
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await rm(dbDir, { recursive: true, force: true });
    // Keep the run directory for the recorded evidence; delete on next run.
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error("live proof harness failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
