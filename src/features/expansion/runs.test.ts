import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleIntake } from "./frontend/data/intake-example.ts";
import { normalizeRequirements } from "./domain/requirements.ts";
import {
  cancelRun,
  createRun,
  getRun,
  getRunCandidates,
  RunError,
  type RunServiceConfig,
} from "./backend/runs.ts";
import { importLocalDataset, type LocalConfig } from "./backend/local-dataset.ts";
import { BATCH_SIZE } from "./backend/candidate-search.ts";
import { runSchema, type RunRecord } from "./domain/runs.ts";
import { POST as validateRoute } from "../../app/api/expansion/intake/validate/route.ts";
import { POST as createRunRoute } from "../../app/api/expansion/runs/route.ts";
import { GET as getRunRoute } from "../../app/api/expansion/runs/[id]/route.ts";
import { GET as getCandidatesRoute } from "../../app/api/expansion/runs/[id]/candidates/route.ts";
import { GET as getRentEstimatesRoute } from "../../app/api/expansion/runs/[id]/rent-estimates/route.ts";
import { POST as cancelRoute } from "../../app/api/expansion/runs/[id]/cancel/route.ts";
import { POST as assessmentsRoute } from "../../app/api/expansion/assessments/route.ts";
import { OWNER_COOKIE, ownerCookieValue } from "./backend/owner.ts";

// Phase 5: route ownership comes from a signed owner cookie, never a session header.
process.env.EXPANSION_SESSION_SECRET ??= "phase5-route-test-secret-0123456789abcdef";
process.env.EXPANSION_PERSISTENCE = "off";
const ownerCookie = (owner: string) => `${OWNER_COOKIE}=${encodeURIComponent(ownerCookieValue(owner))}`;

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

async function seeded(
  spaces: unknown[],
  run: (config: LocalConfig, runsDir: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "restaurantos-runs-"));
  const settings: LocalConfig = {
    rootPath: directory,
    dbPath: join(directory, "cache.sqlite"),
    datasetId: "synthetic-run-tests",
    datasetDate: null,
  };
  const runsDir = join(directory, "runs");
  try {
    await mkdir(join(directory, "data"));
    await writeFile(join(directory, "data/commercial-property.jsonl"), JSON.stringify(property(1)));
    await writeFile(join(directory, "data/commercial-listing-summary.jsonl"), JSON.stringify(listing(10, spaces)));
    await importLocalDataset(settings);
    await run(settings, runsDir);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const intake = () => exampleIntake();
const input = (over: Record<string, unknown> = {}) => ({
  runId: "run-1",
  sessionId: "session-a",
  cityId: "houston",
  intake: intake(),
  revisionId: "revision-run",
  revisionNumber: 0,
  ...over,
});

test("createRun executes, persists counts, is idempotent and conflicts on different requirements", async () => {
  await seeded(Array.from({ length: 30 }, (_, index) => space(1000 + index)), async (db, runsDir) => {
    const service: Partial<RunServiceConfig> = { db, runsDir };
    const first = await createRun(service, input());
    assert.equal(first.created, true);
    assert.equal(first.record.status, "completed");
    assert.equal(first.record.counts.examined, 30);
    assert.equal(first.record.counts.included, 30);
    assert.equal(first.record.counts.meets, 0);
    assert.equal(first.record.counts.needsVerification, 30);
    assert.equal(first.record.datasetId, "synthetic-run-tests");
    // Idempotent: same run id + same requirements returns the existing run.
    const again = await createRun(service, input());
    assert.equal(again.created, false);
    assert.deepEqual(again.record, first.record);
    // Different requirements with the same run id conflict.
    await assert.rejects(
      createRun(service, input({ revisionNumber: 7 })),
      (error: unknown) => error instanceof RunError && error.code === "conflict",
    );
    // Ownership: another session cannot see this run.
    assert.throws(() => getRun(service, "session-b", "run-1"), (error: unknown) => error instanceof RunError && error.code === "not_found");
  });
});

test("candidate pages paginate and filter by group from stored results", async () => {
  const spaces = Array.from({ length: 25 }, (_, index) =>
    space(2000 + index, { serviceType: 7, rateLow: 3, rateHigh: 3 }),
  );
  await seeded(spaces, async (db, runsDir) => {
    const service: Partial<RunServiceConfig> = { db, runsDir };
    const { record } = await createRun(service, input({ runId: "run-2" }));
    assert.equal(record.status, "completed");
    assert.equal(record.counts.meets, 0);
    // Full-service rent of $3/SF/month × 1,200 SF = $3,600 <= $5,000, but
    // kitchen/parking stay unverified, so every candidate needs verification.
    const first = getRunCandidates(service, "session-a", "run-2", { offset: 0, limit: 10 });
    assert.equal(first.total, 25);
    assert.equal(first.returned, 10);
    assert.equal(first.candidates.length, 10);
    const last = getRunCandidates(service, "session-a", "run-2", { offset: 20, limit: 10 });
    assert.equal(last.returned, 5);
    const meets = getRunCandidates(service, "session-a", "run-2", { group: "meets_assessed_requirements" });
    assert.equal(meets.total, 0);
    const needs = getRunCandidates(service, "session-a", "run-2", { group: "needs_verification" });
    assert.equal(needs.total, 25);
    // Before completion there are no pages.
    assert.throws(() => getRunCandidates(service, "session-a", "missing", {}), (error: unknown) => error instanceof RunError && error.code === "not_found");
  });
});

test("mid-run cancellation wins the race and terminal runs never change status", async () => {
  const spaces = Array.from({ length: BATCH_SIZE + 200 }, (_, index) => space(3000 + index));
  await seeded(spaces, async (db, runsDir) => {
    const service: Partial<RunServiceConfig> = { db, runsDir };
    let requested = false;
    const { record } = await createRun(service, {
      ...input({ runId: "run-3" }),
      yieldLoop: async () => {
        if (!requested) {
          requested = true;
          cancelRun(service, "session-a", "run-3");
        }
      },
    });
    assert.equal(record.status, "cancelled");
    assert.ok(record.counts.examined < BATCH_SIZE + 200);
    assert.equal(record.completedAt, null);
    assert.ok(record.cancelledAt);
    // Partial results remain readable after cancellation.
    const page = getRunCandidates(service, "session-a", "run-3");
    assert.ok(page.total >= 0);
    // A terminal run cannot be cancelled again.
    assert.throws(() => cancelRun(service, "session-a", "run-3"), (error: unknown) => error instanceof RunError && error.code === "conflict");
    // Idempotent re-create returns the same cancelled run, never success.
    const retry = await createRun(service, { ...input({ runId: "run-3" }), yieldLoop: async () => {} });
    assert.equal(retry.created, false);
    assert.equal(retry.record.status, "cancelled");
  });
});

test("interrupted runs recover as failed instead of hanging running forever", async () => {
  await seeded([space(100)], async (db, runsDir) => {
    const service: Partial<RunServiceConfig> = { db, runsDir };
    const { record } = await createRun(service, input({ runId: "run-4" }));
    assert.equal(record.status, "completed");
    const file = join(runsDir, "session-a", "run-4.json");
    const stale = runSchema.parse(JSON.parse(await readFile(file, "utf8")));
    stale.status = "running";
    stale.updatedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    stale.error = null;
    await writeFile(file, JSON.stringify(stale));
    const recovered = getRun(service, "session-a", "run-4");
    assert.equal(recovered.status, "failed");
    assert.equal(recovered.error?.code, "interrupted");
  });
});

test("zero candidates complete truthfully and source failures stay redacted", async () => {
  await seeded([space(100, { spaceUse: 7 })], async (db, runsDir) => {
    const service: Partial<RunServiceConfig> = { db, runsDir };
    const zero = await createRun(service, input({ runId: "run-5" }));
    assert.equal(zero.record.status, "completed");
    assert.equal(zero.record.counts.examined, 1);
    assert.equal(zero.record.counts.included, 0);
    const page = getRunCandidates(service, "session-a", "run-5");
    assert.equal(page.total, 0);
    assert.equal(page.excluded.length, 1);
    assert.equal(page.excluded[0].reasonCode, "incompatible_space_use");
    // Missing database: failed run with a redacted, path-free message.
    const failed = await createRun({ db: { dbPath: join(runsDir, "missing.sqlite") }, runsDir }, input({ runId: "run-6" }));
    assert.equal(failed.record.status, "failed");
    assert.equal(failed.record.error?.code, "not_configured");
    assert.ok(!failed.record.error.message.includes("missing.sqlite"));
  });
});

// ---------------------------------------------------------------------------
// Route-level wiring (real handlers, synthetic request/response)

async function withEnv<T>(names: string[], values: (string | undefined)[], run: () => Promise<T>): Promise<T> {
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  names.forEach((name, index) => {
    const value = values[index];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  });
  try {
    return await run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("route handlers validate intake, create runs, paginate, cancel and assess", async () => {
  await seeded(Array.from({ length: 12 }, (_, index) => space(4000 + index)), async (db, runsDir) => {
    await withEnv(
      ["EXPANSION_DB_PATH", "EXPANSION_E2E_RUNS_DIR", "EXPANSION_DATASET_ID"],
      [db.dbPath, runsDir, "synthetic-run-tests"],
      async () => {
        const json = (response: Response) => response.json() as Promise<unknown>;
        // Intake validation endpoint.
        const validation = await validateRoute(
          new Request("http://localhost/api/expansion/intake/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ intake: intake() }),
          }),
        );
        assert.equal(validation.status, 200);
        const validationBody = (await json(validation)) as { requirements: { revisionNumber: number } };
        assert.equal(validationBody.requirements.revisionNumber, 0);
        const bad = await validateRoute(
          new Request("http://localhost/api/expansion/intake/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ intake: { ...intake(), schemaVersion: "9.9" } }),
          }),
        );
        assert.equal(bad.status, 400);

        // Create run through the real route.
        const created = await createRunRoute(
          new Request("http://localhost/api/expansion/runs", {
            method: "POST",
            headers: { "Content-Type": "application/json", cookie: ownerCookie("route-session") },
            body: JSON.stringify({
              runId: "route-run-1",
              cityId: "houston",
              intake: intake(),
              revisionId: "revision-route",
              revisionNumber: 0,
            }),
          }),
        );
        assert.equal(created.status, 201);
        const createdBody = (await json(created)) as RunRecord;
        assert.equal(createdBody.status, "completed");
        assert.equal(createdBody.sessionId, "route-session");

        // Status via GET.
        const status = await getRunRoute(
          new Request("http://localhost/api/expansion/runs/route-run-1", { headers: { cookie: ownerCookie("route-session") } }),
          { params: Promise.resolve({ id: "route-run-1" }) },
        );
        assert.equal(status.status, 200);
        // Wrong session sees 404.
        const foreign = await getRunRoute(
          new Request("http://localhost/api/expansion/runs/route-run-1", { headers: { cookie: ownerCookie("other") } }),
          { params: Promise.resolve({ id: "route-run-1" }) },
        );
        assert.equal(foreign.status, 404);

        // Candidates pagination through the route.
        const candidates = await getCandidatesRoute(
          new Request("http://localhost/api/expansion/runs/route-run-1/candidates?limit=5&offset=0", { headers: { cookie: ownerCookie("route-session") } }),
          { params: Promise.resolve({ id: "route-run-1" }) },
        );
        assert.equal(candidates.status, 200);
        const page = (await json(candidates)) as { total: number; returned: number; candidates: { candidate: unknown }[] };
        assert.equal(page.total, 12);
        assert.equal(page.returned, 5);

        // Cancel a terminal run → 409.
        const cancel = await cancelRoute(
          new Request("http://localhost/api/expansion/runs/route-run-1/cancel", { method: "POST", headers: { cookie: ownerCookie("route-session") } }),
          { params: Promise.resolve({ id: "route-run-1" }) },
        );
        assert.equal(cancel.status, 409);

        // Assessments endpoint re-evaluates one candidate with facts.
        const requirements = normalizeRequirements(intake(), {
          revisionId: "revision-route",
          revisionNumber: 0,
          createdAt: new Date().toISOString(),
        });
        const assessments = await assessmentsRoute(
          new Request("http://localhost/api/expansion/assessments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              candidate: page.candidates[0].candidate,
              requirements,
              facts: [],
            }),
          }),
        );
        assert.equal(assessments.status, 200);
        const assessed = (await json(assessments)) as { group: string; assessments: unknown[] };
        assert.equal(assessed.group, "needs_verification");
        assert.equal(assessed.assessments.length, 5);
      },
    );
  });
});

test("rent-estimates route: owner-scoped, only unlisted-rent candidates get an estimate", async () => {
  // 6 listed-rent spaces + 1 no-rent space (askingRateHasValue:false, 0 rates).
  const spaces = [
    ...Array.from({ length: 6 }, (_, index) => space(5000 + index)),
    space(5010, { askingRateHasValue: false, rateLow: 0, rateHigh: 0 }),
  ];
  await seeded(spaces, async (db, runsDir) => {
    await withEnv(
      ["EXPANSION_DB_PATH", "EXPANSION_E2E_RUNS_DIR", "EXPANSION_DATASET_ID"],
      [db.dbPath, runsDir, "synthetic-run-tests"],
      async () => {
        const json = (response: Response) => response.json() as Promise<unknown>;
        const created = await createRunRoute(
          new Request("http://localhost/api/expansion/runs", {
            method: "POST",
            headers: { "Content-Type": "application/json", cookie: ownerCookie("rent-session") },
            body: JSON.stringify({
              runId: "rent-run-1",
              cityId: "houston",
              intake: intake(),
              revisionId: "revision-rent",
              revisionNumber: 0,
            }),
          }),
        );
        assert.equal(created.status, 201);

        const call = (cookie?: string) =>
          getRentEstimatesRoute(
            new Request("http://localhost/api/expansion/runs/rent-run-1/rent-estimates", {
              headers: cookie ? { cookie } : {},
            }),
            { params: Promise.resolve({ id: "rent-run-1" }) },
          );

        // Anonymous → 401 (never mints an owner).
        const anonymous = await call();
        assert.equal(anonymous.status, 401);

        // Another owner's cookie sees 404, never the run.
        const foreign = await call(ownerCookie("rent-session-b"));
        assert.equal(foreign.status, 404);

        // Owner → 200 with exactly the no-rent candidate, estimate non-null.
        const ok = await call(ownerCookie("rent-session"));
        assert.equal(ok.status, 200);
        const body = (await json(ok)) as {
          modelVersion: string;
          runId: string;
          datasetId: string;
          estimates: Array<{ candidateId: string; estimate: { monthly: { low: number; high: number } } | null }>;
        };
        assert.equal(body.modelVersion, "expansion-rent-estimates-v1");
        assert.equal(body.runId, "rent-run-1");
        assert.equal(body.datasetId, "synthetic-run-tests");
        assert.equal(body.estimates.length, 1);
        assert.equal(body.estimates[0].candidateId, "costar-space:5010");
        assert.ok(body.estimates[0].estimate);
        // 6 listed comparables at $2/SF/month ×12 ×1200 SF / 12 → $2,400/mo.
        assert.equal(body.estimates[0].estimate?.monthly.low, 2400);
        assert.equal(body.estimates[0].estimate?.monthly.high, 2400);
        // Listed-rent candidates get no entry at all.
        assert.ok(body.estimates.every((entry) => entry.candidateId === "costar-space:5010"));
      },
    );
  });
});

test("rent-estimates route: a non-terminal run answers a conflict envelope", async () => {
  const spaces = Array.from({ length: BATCH_SIZE + 200 }, (_, index) => space(6000 + index));
  await seeded(spaces, async (db, runsDir) => {
    await withEnv(
      ["EXPANSION_DB_PATH", "EXPANSION_E2E_RUNS_DIR", "EXPANSION_DATASET_ID"],
      [db.dbPath, runsDir, "synthetic-run-tests"],
      async () => {
        const service: Partial<RunServiceConfig> = { db, runsDir };
        // Cancel mid-search: the run ends terminal but never completed.
        let requested = false;
        const { record } = await createRun(service, {
          ...input({ runId: "rent-run-2" }),
          yieldLoop: async () => {
            if (!requested) {
              requested = true;
              cancelRun(service, "session-a", "rent-run-2");
            }
          },
        });
        assert.equal(record.status, "cancelled");
        const response = await getRentEstimatesRoute(
          new Request("http://localhost/api/expansion/runs/rent-run-2/rent-estimates", {
            headers: { cookie: ownerCookie("session-a") },
          }),
          { params: Promise.resolve({ id: "rent-run-2" }) },
        );
        assert.equal(response.status, 409);
        const body = (await response.json()) as { error: { code: string; message: string } };
        assert.equal(body.error.code, "conflict");
        assert.ok(body.error.message.length > 0);
      },
    );
  });
});
