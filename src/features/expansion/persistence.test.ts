import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleIntake } from "./frontend/data/intake-example.ts";
import { agentRunRecordSchema, AGENT_RUN_VERSION } from "./domain/agent.ts";
import { investigationRunSchema, createDecisionBrief } from "./domain/decision-brief.ts";
import { EVIDENCE_VERSION, reassessCandidate, type SourceSnapshot } from "./domain/evidence.ts";
import { emptyFinanceInputs, calculateDecisionFinance } from "./domain/decision-finance.ts";
import { createProfileRevision } from "./domain/requirements.ts";
import { createAgentRun, getAgentRun, staleRunReason, AGENT_RUN_HARD_STALE_MS, WORKER_START_GRACE_MS } from "./backend/agent.ts";
import { OWNER_COOKIE, ownerCookieValue, resolveOwner, verifyOwnerCookie, OwnerError } from "./backend/owner.ts";
import { contentHash, createFileRepository, createMemoryRepository, docId, setRepositoryForTests, type ExpansionRepository } from "./backend/store.ts";
import { durableArtifact, durableRun, importBrowserData, listBriefs, loadLatestProfile, saveBrief, saveProfileEnvelope, syncAgentRun } from "./backend/durable.ts";
import { POST as createAgentRunRoute } from "../../app/api/expansion/agent-runs/route.ts";
import { GET as getAgentRunRoute } from "../../app/api/expansion/agent-runs/[id]/route.ts";
import { POST as cancelAgentRoute } from "../../app/api/expansion/agent-runs/[id]/cancel/route.ts";
import { GET as artifactRoute } from "../../app/api/expansion/agent-runs/[id]/artifacts/[name]/route.ts";
import { GET as eventsRoute } from "../../app/api/expansion/agent-runs/[id]/events/route.ts";
import { POST as toolBridgeRoute } from "../../app/api/expansion/agent-tools/route.ts";
import { GET as briefsGetRoute, POST as briefsPostRoute } from "../../app/api/expansion/briefs/route.ts";

/**
 * Phase 5 focused tests: owner identity, two-owner isolation (routes + worker
 * tool bridge), duplicate submission, heartbeat-aware recovery, owner-scoped
 * repositories, durable restore after run-directory loss, brief ownership and
 * explicit browser import. All data is synthetic; no network, no worker spawn.
 */

process.env.EXPANSION_SESSION_SECRET = "phase5-test-secret-0123456789abcdef0123456789";
process.env.EXPANSION_AGENT_SPAWN = "0";
delete process.env.EXPANSION_ACCESS_CODE;
const runsDir = await mkdtemp(join(tmpdir(), "restaurantos-p5-runs-"));
process.env.EXPANSION_AGENT_RUNS_DIR = runsDir;
const memory = createMemoryRepository();
setRepositoryForTests(memory);

const A = "o_ownerA_synthetic";
const B = "o_ownerB_synthetic";
const cookieFor = (owner: string) => `${OWNER_COOKIE}=${encodeURIComponent(ownerCookieValue(owner))}`;
const intake = exampleIntake();
const body = (runId: string, revisionNumber = 1) => ({ runId, cityId: "houston", intake, revisionId: "p5-revision", revisionNumber, executionMode: "scripted" as const });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (owner: string | null, runId: string, revisionNumber = 1, extra: Record<string, string> = {}) =>
  createAgentRunRoute(new Request("http://test.local/api/expansion/agent-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(owner ? { cookie: cookieFor(owner) } : {}), ...extra },
    body: JSON.stringify(body(runId, revisionNumber)),
  }));

test("owner cookies are signed, tamper-evident and expire; missing cookies mint a new owner", () => {
  const value = ownerCookieValue(A);
  assert.equal(verifyOwnerCookie(value), A);
  assert.equal(verifyOwnerCookie(value.replace(A, B)), null, "owner swap breaks the signature");
  assert.equal(verifyOwnerCookie(`${value}x`), null);
  assert.equal(verifyOwnerCookie(ownerCookieValue(A, Date.now() - 200 * 86400_000)), null, "expired");
  const fresh = resolveOwner(new Request("http://test.local/"));
  assert.equal(fresh.issued, true);
  assert.match(fresh.setCookie ?? "", /HttpOnly; SameSite=Lax/);
  assert.notEqual(fresh.ownerId, A);
  assert.throws(() => resolveOwner(new Request("http://test.local/"), { issue: false }), OwnerError);
  process.env.EXPANSION_ACCESS_CODE = "synthetic-access-code";
  try { assert.throws(() => resolveOwner(new Request("http://test.local/")), (error: OwnerError) => error.code === "access_code_required"); }
  finally { delete process.env.EXPANSION_ACCESS_CODE; }
});

test("owner A's run is allowed for A and rejected for owner B, spoofed headers and anonymous callers", async () => {
  assert.equal((await post(A, "p5-run-a")).status, 201);
  const own = await getAgentRunRoute(new Request("http://test.local/x", { headers: { cookie: cookieFor(A) } }), ctx("p5-run-a"));
  assert.equal(own.status, 200);
  assert.equal((await own.json()).sessionId, A);

  const other = await getAgentRunRoute(new Request("http://test.local/x", { headers: { cookie: cookieFor(B) } }), ctx("p5-run-a"));
  assert.equal(other.status, 404, "cross-owner read is indistinguishable from a missing run");
  const spoofed = await getAgentRunRoute(new Request("http://test.local/x", { headers: { "x-expansion-session": A } }), ctx("p5-run-a"));
  assert.equal(spoofed.status, 401, "a client-chosen session header is not authorization");
  const forged = await getAgentRunRoute(new Request("http://test.local/x", { headers: { cookie: `${OWNER_COOKIE}=v1.${A}.9999999999.forged` } }), ctx("p5-run-a"));
  assert.equal(forged.status, 401);
  assert.equal((await cancelAgentRoute(new Request("http://test.local/x", { method: "POST", headers: { cookie: cookieFor(B) } }), ctx("p5-run-a"))).status, 404);
  assert.equal((await artifactRoute(new Request("http://test.local/x", { headers: { cookie: cookieFor(B) } }), { params: Promise.resolve({ id: "p5-run-a", name: "profile" }) })).status, 404);
  assert.equal((await eventsRoute(new Request("http://test.local/x", { headers: { cookie: cookieFor(B) } }), ctx("p5-run-a"))).status, 404);
  // A's run still exists and is unchanged after B's attempts.
  assert.equal(getAgentRun({}, A, "p5-run-a").status, "queued");
});

test("worker tool bridge: a token for owner A's run cannot act as owner B", async () => {
  assert.equal((await post(A, "p5-run-bridge", 2)).status, 201);
  const token = "synthetic-bridge-token";
  await writeFile(join(runsDir, A, "agent-p5-run-bridge", "tool.token.sha256"), createHash("sha256").update(token).digest("hex"));
  const call = (sessionId: string) => toolBridgeRoute(new Request("http://test.local/api/expansion/agent-tools", {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ runId: "p5-run-bridge", sessionId, tool: "profile.readiness_report", input: { revisionId: "p5-revision", revisionNumber: 2 } }),
  }));
  assert.equal((await call(A)).status, 200);
  assert.equal((await call(B)).status, 401);
});

test("duplicate submissions return the active run instead of starting another", async () => {
  const first = await post(A, "p5-dup-1", 3);
  // Same owner, same requirements and mode, new client-generated id (double click / retry).
  const second = await post(A, "p5-dup-2", 3);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("X-Expansion-Deduplicated"), "1");
  assert.equal((await second.json()).runId, "p5-dup-1");
  assert.equal(existsSync(join(runsDir, A, "agent-p5-dup-2")), false, "no second run directory");
  // Owner B with identical requirements is a different workspace: a new run.
  assert.equal((await post(B, "p5-dup-b", 3)).status, 201);
});

test("heartbeat-aware recovery: dead worker, never-started worker and stalled live worker", async () => {
  const now = Date.now();
  const record = agentRunRecordSchema.parse({ ...getAgentRun({}, B, "p5-dup-b"), status: "running", updatedAt: new Date(now - 60_000).toISOString() });
  assert.equal(staleRunReason(record, { pid: 123, updatedAt: now - 60_000, alive: false }, now)?.code, "worker_exited");
  assert.equal(staleRunReason(record, { pid: 123, updatedAt: now - 1_000, alive: true }, now), null, "recent progress from a live worker is never recovered");
  const queued = agentRunRecordSchema.parse({ ...record, status: "queued", createdAt: new Date(now - WORKER_START_GRACE_MS - 5_000).toISOString(), updatedAt: new Date(now - WORKER_START_GRACE_MS - 5_000).toISOString() });
  assert.equal(staleRunReason(queued, { pid: null, updatedAt: null, alive: null }, now)?.code, "worker_not_started");
  const stalled = agentRunRecordSchema.parse({ ...record, updatedAt: new Date(now - AGENT_RUN_HARD_STALE_MS - 1_000).toISOString() });
  assert.equal(staleRunReason(stalled, { pid: 123, updatedAt: now - AGENT_RUN_HARD_STALE_MS - 1_000, alive: true }, now)?.code, "stalled");

  // End to end on disk: a running run whose worker pid is gone recovers as
  // failed, writes a cancel flag for any zombie, and then stays terminal.
  const dir = join(runsDir, B, "agent-p5-dup-b");
  await writeFile(join(dir, "run.json"), JSON.stringify(record));
  await writeFile(join(dir, "run.worker.json"), JSON.stringify({ pid: 2_147_483_000, updatedAt: new Date(now - 60_000).toISOString() }));
  const recovered = getAgentRun({}, B, "p5-dup-b");
  assert.equal(recovered.status, "failed");
  assert.equal(recovered.error?.code, "worker_exited");
  assert.match(recovered.error?.message ?? "", /start a new run/i);
  assert.ok(existsSync(join(dir, "run.cancel")));
  assert.equal(getAgentRun({}, B, "p5-dup-b").status, "failed", "terminal recovery never flips back");
});

async function exerciseRepository(repo: ExpansionRepository) {
  const doc = { _id: docId(A, "x"), ownerId: A, value: 1, contentHash: contentHash({ value: 1 }) };
  assert.equal(await repo.insertImmutable("briefs", doc), "inserted");
  assert.equal(await repo.insertImmutable("briefs", doc), "duplicate");
  assert.equal(await repo.insertImmutable("briefs", { ...doc, value: 2, contentHash: contentHash({ value: 2 }) }), "conflict");
  assert.equal((await repo.get("briefs", A, doc._id))?.value, 1, "immutable record unchanged");
  assert.equal(await repo.get("briefs", B, doc._id), null, "an id alone never crosses owners");
  assert.equal((await repo.list("briefs", B)).length, 0);
  await assert.rejects(repo.upsert("briefs", { _id: docId(A, "y"), ownerId: B }), /namespaced/);
}
test("memory and file repositories enforce owner namespaces and immutability", async () => {
  await exerciseRepository(createMemoryRepository());
  const dir = await mkdtemp(join(tmpdir(), "restaurantos-p5-store-"));
  try { await exerciseRepository(createFileRepository(dir)); } finally { await rm(dir, { recursive: true, force: true }); }
});

test("profile revisions persist immutably and restore as a validated envelope", async () => {
  const repo = createMemoryRepository();
  const r0 = createProfileRevision(intake, { revisionId: "p5-profile-0", revisionNumber: 0, createdAt: "2026-11-15T00:00:00.000Z", parentRevisionId: null, editSummary: "Synthetic example import." });
  const envelope = { schemaVersion: 1 as const, revisions: [r0], updatedAt: "2026-11-15T00:00:00.000Z" };
  const report = await saveProfileEnvelope(repo, A, envelope, "app");
  assert.deepEqual(report.revisions.map(item => item.result), ["inserted"]);
  assert.deepEqual((await saveProfileEnvelope(repo, A, envelope, "app")).revisions.map(item => item.result), ["duplicate"]);
  const restored = await loadLatestProfile(repo, A);
  assert.equal(restored?.revisions[0].revisionId, "p5-profile-0");
  assert.equal(JSON.stringify(restored?.revisions[0]), JSON.stringify(r0));
  assert.equal(await loadLatestProfile(repo, B), null);
  const altered = structuredClone(r0) as typeof r0 & { editSummary: string };
  altered.editSummary = "Rewritten history";
  await assert.rejects(saveProfileEnvelope(repo, A, { ...envelope, revisions: [altered] }, "app"), /immutable/);
});

// --- A finished synthetic run on disk for durable sync + briefs -------------
const now = "2026-11-15T01:00:00.000Z";
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./agent/fixtures/contracts/${name}.sample.json`, import.meta.url), "utf8"));
const search = fixture("candidates");
const profileArtifact = fixture("profile");
const summary = fixture("summary");
const runRecord = agentRunRecordSchema.parse({ version: AGENT_RUN_VERSION, runId: search.runId, sessionId: A, status: summary.terminalStatus, executionMode: summary.executionMode, createdAt: now, updatedAt: now, completedAt: now, cancelledAt: null, cityId: search.cityId, datasetId: search.datasetId, datasetDate: search.datasetDate, profile: { revisionId: profileArtifact.revisionId, revisionNumber: profileArtifact.revisionNumber }, requirementsHash: "synthetic-p5-hash", model: null, toolCalls: {}, stages: { readiness: "completed", market: "completed", site_scout: "completed", space_inspector: "completed", finance: "completed" }, error: null });
async function writeFinishedRun(owner: string) {
  const dir = join(runsDir, owner, `agent-${search.runId}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "run.json"), JSON.stringify({ ...runRecord, sessionId: owner }));
  for (const name of ["profile", "candidates", "summary", "market", "inspection", "finance"]) await writeFile(join(dir, `${name}.json`), JSON.stringify(fixture(name)));
  await writeFile(join(dir, "events.jsonl"), await readFile(new URL("./agent/fixtures/contracts/events.sample.jsonl", import.meta.url), "utf8"));
  return dir;
}
function makeBrief(id: string, record = runRecord) {
  const runSnapshot = investigationRunSchema.parse({ run: record, profile: profileArtifact, search, summary, market: fixture("market"), inspection: fixture("inspection"), finance: fixture("finance") });
  return createDecisionBrief({ id, title: "Synthetic Phase 5 brief", createdAt: now, parentBriefId: null, runSnapshot, nextQuestions: ["Synthetic follow-up"], choices: runSnapshot.search.candidates.slice(0, 2).map(item => {
    const financeInputs = emptyFinanceInputs();
    const sources: SourceSnapshot = { version: EVIDENCE_VERSION, candidateId: item.candidate.id, refreshedAt: now, statuses: [], observations: [], gaps: ["Synthetic; providers not contacted."] };
    return { candidateId: item.candidate.id, assessmentHistory: [], assessment: reassessCandidate(item, profileArtifact.requirements, [], sources, { id: `${id}-${item.candidate.id}-r0`, parentId: null, revisionNumber: 0, evaluatedAt: now }), financeInputs, financeResults: calculateDecisionFinance(item.candidate, financeInputs) };
  }) });
}

test("terminal runs mirror into durable storage and restore after the run directory is lost", async () => {
  const dir = await writeFinishedRun(A);
  await syncAgentRun(memory, {}, A, search.runId);
  const stored = await durableRun(memory, A, search.runId);
  assert.equal(stored?.status, runRecord.status);
  assert.equal(await durableRun(memory, B, search.runId), null, "durable records are owner-scoped");
  await rm(dir, { recursive: true, force: true });
  const restored = await durableArtifact(memory, A, search.runId, "candidates");
  assert.equal(JSON.stringify(restored), JSON.stringify(fixture("candidates")), "candidate assessments restore in their original order");
  // Routes fall back to the durable copy for the owner only.
  const ok = await artifactRoute(new Request("http://test.local/x", { headers: { cookie: cookieFor(A) } }), { params: Promise.resolve({ id: search.runId, name: "summary" }) });
  assert.equal(ok.status, 200);
  const denied = await artifactRoute(new Request("http://test.local/x", { headers: { cookie: cookieFor(B) } }), { params: Promise.resolve({ id: search.runId, name: "summary" }) });
  assert.equal(denied.status, 404);
  const replay = await eventsRoute(new Request("http://test.local/x", { headers: { cookie: cookieFor(A) } }), ctx(search.runId));
  assert.match(await replay.text(), /event: done/);
});

test("briefs save only against the owner's own run, never with a forged snapshot, and list per owner", async () => {
  await writeFinishedRun(A);
  const brief = makeBrief("p5-brief-1");
  const saved = await briefsPostRoute(new Request("http://test.local/api/expansion/briefs", { method: "POST", headers: { "Content-Type": "application/json", cookie: cookieFor(A) }, body: JSON.stringify({ brief }) }));
  assert.equal(saved.status, 201);
  assert.equal((await saved.json()).runVerified, true);
  // Owner B cannot attach A's run to their workspace through the app.
  const foreign = await briefsPostRoute(new Request("http://test.local/api/expansion/briefs", { method: "POST", headers: { "Content-Type": "application/json", cookie: cookieFor(B) }, body: JSON.stringify({ brief: makeBrief("p5-brief-b") }) }));
  assert.equal(foreign.status, 404);
  // A forged summary (valid schema, different text) does not match the stored run.
  const forged = makeBrief("p5-brief-forged");
  forged.runSnapshot.summary.summaryText = "Forged summary text";
  await assert.rejects(saveBrief(memory, {}, A, forged, "app"), /does not match/);
  const listA = await briefsGetRoute(new Request("http://test.local/x", { headers: { cookie: cookieFor(A) } }));
  assert.deepEqual((await listA.json()).briefs.map((item: { brief: { id: string } }) => item.brief.id), ["p5-brief-1"]);
  assert.equal((await listBriefs(memory, B)).length, 0);
  const scenarios = await memory.list("scenarios", A, { briefId: "p5-brief-1" });
  assert.equal(scenarios.length, 2, "one finance scenario per compared space");
});

test("explicit browser import labels unverifiable runs, rejects invalid items and never needs deletion", async () => {
  const browserBrief = makeBrief("p5-browser-brief", agentRunRecordSchema.parse({ ...runRecord, sessionId: "local" }));
  const items = await importBrowserData(memory, {}, B, { briefs: [browserBrief, { id: "broken", title: "not a brief" }] });
  assert.deepEqual(items.map(item => item.status), ["imported", "rejected"]);
  assert.match(items[0].reason ?? "", /unverified/);
  const [record] = await listBriefs(memory, B);
  assert.equal(record.provenance, "browser_import");
  assert.equal(record.runVerified, false);
  assert.equal((await importBrowserData(memory, {}, B, { briefs: [browserBrief] }))[0].status, "duplicate", "re-import is idempotent");
});

test("cleanup", async () => {
  setRepositoryForTests(undefined);
  await rm(runsDir, { recursive: true, force: true });
});

void createAgentRun;
