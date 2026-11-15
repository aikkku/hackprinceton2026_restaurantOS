import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { EVIDENCE_VERSION, investigationNoteSchema, reassessCandidate, sourceSnapshotSchema, type InvestigationNote, type SourceSnapshot } from "./domain/evidence.ts";
import { investigationRunSchema, createDecisionBrief, decisionBriefSchema } from "./domain/decision-brief.ts";
import { emptyFinanceInputs, calculateDecisionFinance } from "./domain/decision-finance.ts";
import { BRIEF_STORAGE_KEY, decodeBriefs, persistBriefs } from "./frontend/brief-storage.ts";
import { mapMatterport, mapVexcel, parseAcsResponse, acsObservation, ACS_RELEASE, ACS_VARIABLES, contextGaps } from "./domain/source-adapters.ts";
import { collectCandidateSources } from "./backend/investigation-sources.ts";
import { agentRunRecordSchema, AGENT_RUN_VERSION } from "./domain/agent.ts";

const now = "2026-11-14T18:00:00.000Z";
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./agent/fixtures/contracts/${name}.sample.json`, import.meta.url), "utf8"));
const search = fixture("candidates");
const profile = fixture("profile");
const summary = fixture("summary");
const base = search.candidates[0];
const empty: SourceSnapshot = { version: EVIDENCE_VERSION, candidateId: base.candidate.id, refreshedAt: now, statuses: [], observations: [], gaps: ["Synthetic test snapshot; providers not contacted."] };
const metadata = { id: "synthetic-revision-0", parentId: null, revisionNumber: 0, evaluatedAt: now };
const note = (value: "verified_present" | "verified_absent", category: "assumption" | "verification" = "verification"): InvestigationNote => investigationNoteSchema.parse({ id: `synthetic:${value}:${category}`, category, createdAt: now, text: "Synthetic test attestation, not a real kitchen observation", fact: { id: `synthetic-fact:${value}:${category}`, entityScope: "space", entityId: base.candidate.id, origin: category === "assumption" ? "assumed" : "observed", source: { label: "Synthetic test document", recordId: "synthetic-doc", capturedAt: now }, method: "Synthetic test suite inspection", limitations: [], isDemo: false, field: "existingKitchen", value: { kind: "exact", value }, unit: null } });
function bundle() {
  const run = agentRunRecordSchema.parse({ version: AGENT_RUN_VERSION, runId: search.runId, sessionId: "synthetic-test", status: summary.terminalStatus, executionMode: summary.executionMode, createdAt: now, updatedAt: now, completedAt: now, cancelledAt: null, cityId: search.cityId, datasetId: search.datasetId, datasetDate: search.datasetDate, profile: { revisionId: profile.revisionId, revisionNumber: profile.revisionNumber }, requirementsHash: "synthetic-test-hash", model: null, toolCalls: {}, stages: { readiness: "completed", market: "completed", site_scout: "completed", space_inspector: "completed", finance: "completed" }, error: null });
  return investigationRunSchema.parse({ run, profile, search, summary, market: fixture("market"), inspection: fixture("inspection"), finance: fixture("finance") });
}
function brief() {
  const runSnapshot = bundle();
  return createDecisionBrief({ id: "synthetic-brief", title: "Synthetic acceptance brief", createdAt: now, parentBriefId: null, runSnapshot, nextQuestions: ["Verify missing sources"], choices: runSnapshot.search.candidates.slice(0, 2).map(item => {
    const financeInputs = emptyFinanceInputs();
    return { candidateId: item.candidate.id, assessmentHistory: [], assessment: reassessCandidate(item, profile.requirements, [], { ...empty, candidateId: item.candidate.id }, metadata), financeInputs, financeResults: calculateDecisionFinance(item.candidate, financeInputs) };
  }) });
}

test("assumptions never verify kitchen; dated verifications create a revision without changing original run", () => {
  const before = JSON.stringify(search);
  assert.equal(reassessCandidate(base, profile.requirements, [note("verified_present", "assumption")], empty, metadata).assessments.find(x => x.requirementId === "space.existingKitchen")?.status, "unknown");
  assert.equal(reassessCandidate(base, profile.requirements, [note("verified_present")], empty, metadata).assessments.find(x => x.requirementId === "space.existingKitchen")?.status, "pass");
  assert.equal(JSON.stringify(search), before);
  const invalid = note("verified_present"); invalid.fact.source.capturedAt = null;
  assert.equal(investigationNoteSchema.safeParse(invalid).success, false);
});
test("conflicting observations retained and unresolved, regardless of order", () => {
  for (const notes of [[note("verified_present"), note("verified_absent")], [note("verified_absent"), note("verified_present")]]) {
    const result = reassessCandidate(base, profile.requirements, notes, empty, metadata);
    assert.deepEqual(result.conflicts, ["existingKitchen"]);
    assert.equal(result.notes.length, 2);
    assert.equal(result.assessments.find(x => x.requirementId === "space.existingKitchen")?.status, "unknown");
  }
});
test("foreign, building-only, assumed and synthetic source facts cannot pass a real candidate", () => {
  const wrong = note("verified_present"); wrong.fact.entityId = "other-suite";
  assert.throws(() => reassessCandidate(base, profile.requirements, [wrong], empty, metadata));
  const synthetic = note("verified_present"); synthetic.fact.isDemo = true;
  const real = structuredClone(base); real.candidate.isDemo = false;
  assert.equal(reassessCandidate(real, profile.requirements, [synthetic], empty, metadata).assessments.find(x => x.requirementId === "space.existingKitchen")?.status, "unknown");
});
test("Matterport property association never verifies a suite or seats; wrong/missing association rejected", () => {
  const link = { modelId: "syntheticModel", propertyId: base.candidate.propertyId, candidateId: null, verifiedAt: null, reference: "Synthetic link", viewerPermitted: false };
  const model = { id: "syntheticModel", name: "Synthetic model", capturedAt: null, measurements: null };
  const result = mapMatterport(base.candidate, link, model, now);
  assert.equal(result.scope, "property"); assert.deepEqual(result.facts, []); assert.equal(result.viewerUrl, null);
  assert.ok(result.limitations.some(x => x.includes("Capture date unavailable")));
  assert.throws(() => mapMatterport(base.candidate, { ...link, candidateId: "wrong-suite" }, model, now));
  assert.throws(() => mapMatterport(base.candidate, link, { ...model, id: "wrong-model" }, now));
  assert.throws(() => mapMatterport(base.candidate, null, model, now));
  const measured = mapMatterport(base.candidate, { ...link, candidateId: base.candidate.id, verifiedAt: "2026-01-01", viewerPermitted: true }, { ...model, measurements: { usableDiningSqFt: 600, sourceRecordId: "synthetic-measurement" } }, now, 15);
  assert.ok(measured.details.some(x => x.includes("40 seats")));
  assert.ok(measured.details.some(x => x.includes("not legal occupancy")));
});
test("occluded/undated aerial parking never verifies customer access or invents stalls", () => {
  const result = mapVexcel(base.candidate, { recordId: "synthetic-image", latitude: base.candidate.latitude, longitude: base.candidate.longitude, capturedAt: null, occluded: true, reviewedVisibleStalls: 99, reviewReference: "synthetic review" }, now);
  assert.deepEqual(result.facts, []); assert.ok(result.details.some(x => x.includes("not been reliably reviewed")));
  assert.ok(result.limitations.some(x => x.includes("never establishes customer access")));
  assert.throws(() => mapVexcel(base.candidate, { recordId: "synthetic", latitude: 0, longitude: 0, capturedAt: null, occluded: null, reviewedVisibleStalls: null, reviewReference: null }, now));
});
test("ACS pinned release/variables/units/MOE, null sentinels and tract/H3 method preserved", () => {
  const geo = { state: "48", county: "201", tract: "510100" };
  const table = [["NAME", ...ACS_VARIABLES, "state", "county", "tract"], ["Synthetic tract", "1000", "50", "50000", "-666666666", "48", "201", "510100"]];
  const context = parseAcsResponse(table, geo);
  assert.equal(context.release, ACS_RELEASE); assert.equal(context.populationMoe, 50); assert.equal(context.incomeMoe, null);
  const observation = acsObservation(base.candidate, context, now);
  assert.ok(observation.details.some(x => x.includes("USD (2023 inflation-adjusted)")));
  assert.ok(observation.limitations.some(x => x.includes("NOT allocated or summed")));
  assert.throws(() => parseAcsResponse(table, { ...geo, tract: "000000" }));
  assert.throws(() => parseAcsResponse([["NAME"], ["incomplete"]], geo));
  assert.ok(contextGaps(null, null).some(x => x.includes("current street address")));
  assert.ok(contextGaps(null, null).some(x => x.includes("no average spend")));
});
test("provider 403/outside coverage, malformed response and timeout become gaps without fixtures", async () => {
  const candidate = { ...base.candidate, isDemo: false };
  const result = await collectCandidateSources(candidate, { currentAddress: null, priceLevel: null }, {
    network: true, now: () => now,
    probe: async provider => provider === "matterport" ? { status: "denied", reason: "Synthetic HTTP 403" } : { status: "outside_coverage", reason: "Synthetic outside coverage" },
    fetch: async () => { throw new Error("Synthetic API timeout"); },
  });
  assert.equal(result.statuses.find(x => x.provider === "matterport")?.status, "denied");
  assert.equal(result.statuses.find(x => x.provider === "acs")?.status, "unavailable");
  assert.equal(result.observations.length, 0);
  const malformed = await collectCandidateSources(candidate, { currentAddress: null, priceLevel: null }, { network: true, now: () => now, probe: async () => ({ status: "verified", reason: "Synthetic malformed", model: {} }), fetch: async () => new Response("invalid-json") });
  assert.equal(malformed.observations.length, 0);
  assert.ok(malformed.gaps.length >= 5);
});
test("local source mode makes no provider calls; unresolved Heights stays explicit", async () => {
  const result = await collectCandidateSources(base.candidate, { currentAddress: null, priceLevel: null }, { network: false, now: () => now, probe: async () => { throw new Error("Must not be called"); }, fetch: async () => { throw new Error("Must not be called"); } });
  assert.equal(result.observations.length, 0);
  assert.ok(result.statuses.every(x => x.status === "unavailable"));
  assert.ok(result.statuses.find(x => x.provider === "neighborhood")?.reason.includes("membership"));
});
test("read-only Phase 3 adapter rejects mixed runs/revisions/unknown evidence IDs", () => {
  const valid = bundle(); assert.equal(valid.run.runId, search.runId);
  const mixed = structuredClone(valid); mixed.profile.revisionId = "another-profile";
  assert.equal(investigationRunSchema.safeParse(mixed).success, false);
  const unknown = structuredClone(valid); unknown.summary.groundedCandidateIds.push("invented-candidate");
  assert.equal(investigationRunSchema.safeParse(unknown).success, false);
});
test("saved brief restores identical math/evidence without providers and prevents mixed-profile comparisons", () => {
  const value = brief();
  const decoded = decodeBriefs(JSON.stringify({ schemaVersion: 1, briefs: [value] }));
  assert.equal(decoded.status, "ok"); if (decoded.status === "ok") assert.deepEqual(decoded.briefs[0], value);
  const mixed = structuredClone(value); mixed.choices[0].assessment.profileRevisionId = "other-profile";
  assert.equal(decisionBriefSchema.safeParse(mixed).success, false);
  const tampered = structuredClone(value); tampered.choices[0].financeResults.usableFunds = 90000;
  assert.equal(decisionBriefSchema.safeParse(tampered).success, false);
});
test("corrupt/unknown storage preserved; blocked writes do not touch legacy keys", () => {
  for (const raw of ["not-json", JSON.stringify({ schemaVersion: 99, future: true })]) {
    const decoded = decodeBriefs(raw); assert.notEqual(decoded.status, "ok");
    if (decoded.status !== "ok") assert.equal(decoded.raw, raw);
    assert.throws(() => persistBriefs({ getItem: () => raw, setItem: () => assert.fail("Must preserve original content") }, [brief()]));
  }
  assert.throws(() => persistBriefs({ getItem: () => null, setItem: () => { throw new Error("Blocked storage"); } }, [brief()]), /Blocked storage/);
  const keys: string[] = [];
  persistBriefs({ getItem: () => null, setItem: key => keys.push(key) }, [brief()]);
  assert.deepEqual(keys, [BRIEF_STORAGE_KEY]);
});
test("source schema rejects property facts masquerading as suite verification and unapproved viewer URLs", () => {
  const observation = mapMatterport(base.candidate, { modelId: "synthetic", propertyId: base.candidate.propertyId, candidateId: null, verifiedAt: null, reference: "synthetic", viewerPermitted: false }, { id: "synthetic", name: null, capturedAt: null, measurements: null }, now);
  assert.equal(sourceSnapshotSchema.safeParse({ ...empty, observations: [{ ...observation, facts: [note("verified_present").fact] }] }).success, false);
  assert.equal(sourceSnapshotSchema.safeParse({ ...empty, observations: [{ ...observation, viewerUrl: "https://example.com/" }] }).success, false);
  assert.equal(z.array(investigationNoteSchema).safeParse([note("verified_present")]).success, true);
});
