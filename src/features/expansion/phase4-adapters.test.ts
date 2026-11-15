import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EVIDENCE_VERSION, reassessCandidate } from "./domain/evidence.ts";
import { applyIllustrative, calculateDecisionFinance, decisionFinanceInputsSchema, emptyFinanceInputs, occupancyBreakdown, ILLUSTRATIVE_VALUES } from "./domain/decision-finance.ts";
import { syntheticSourceSnapshot, syntheticSourcesAllowed, syntheticVariant } from "./backend/synthetic-sources.ts";
import { createEvidenceProviderAdapters } from "./backend/evidence-providers.ts";
import { PROVIDER_CONTRACT_VERSION } from "./domain/agent-providers.ts";

// All inputs are labeled synthetic fixtures; no provider is contacted.
const search = JSON.parse(readFileSync(new URL("./agent/fixtures/contracts/candidates.sample.json", import.meta.url), "utf8"));
const profile = JSON.parse(readFileSync(new URL("./agent/fixtures/contracts/profile.sample.json", import.meta.url), "utf8"));
const now = "2026-11-14T18:00:00.000Z";
const options = { currentAddress: null, priceLevel: null };
const scope = { runId: "synthetic-run", sessionId: "synthetic", revisionId: "synthetic-r1", datasetId: "synthetic-e2e-v1", snapshotId: "b".repeat(64) };

test("synthetic fixtures: mapped by real adapters, labeled simulated, fact-free, never change assessments", () => {
  for (const base of search.candidates) {
    const snapshot = syntheticSourceSnapshot(base.candidate, "synthetic-e2e-v1", options, now);
    assert.equal(snapshot.version, EVIDENCE_VERSION);
    assert.ok(snapshot.observations.length >= 3);
    assert.ok(snapshot.observations.every(x => x.isSynthetic && x.origin === "simulated" && x.facts.length === 0 && x.label.startsWith("Synthetic fixture")));
    assert.ok(snapshot.statuses.every(x => x.mode === "synthetic" && x.status !== "verified"));
    const empty = { ...snapshot, observations: [], statuses: [], gaps: ["none"] };
    const meta = { id: "r0", parentId: null, revisionNumber: 0, evaluatedAt: now };
    assert.deepEqual(reassessCandidate(base, profile.requirements, [], snapshot, meta).assessments, reassessCandidate(base, profile.requirements, [], empty, meta).assessments);
    assert.deepEqual(syntheticSourceSnapshot(base.candidate, "synthetic-e2e-v1", options, now), snapshot, "deterministic");
  }
  assert.deepEqual(new Set(["a", "b", "c", "d", "e", "f", "g"].map(syntheticVariant)).size > 1, true);
});

test("synthetic fixtures are refused for real candidate records", () => {
  const real = { ...search.candidates[0].candidate, isDemo: false };
  assert.equal(syntheticSourcesAllowed(real, "costar-houston-2026-10"), false);
  assert.throws(() => syntheticSourceSnapshot(real, "costar-houston-2026-10", options, now), /real records stay unmixed/);
  assert.throws(() => syntheticSourceSnapshot(real, null, options, now));
});

test("illustrative finance values fill blanks only, are labeled, and mismatches are rejected", () => {
  const owner = { ...emptyFinanceInputs(), averageSpend: 31, fixedCostsMonthly: 10000, fixedCostBasis: "includes_occupancy" as const };
  const filled = applyIllustrative(owner);
  assert.equal(filled.averageSpend, 31, "owner value kept");
  assert.deepEqual(filled.illustrative, ["contributionMargin", "operatingDays"]);
  assert.equal(filled.assumedSalesMonthly, null, "no invented demand");
  const result = calculateDecisionFinance(search.candidates[0].candidate, filled);
  assert.deepEqual(result.requiredSales, { low: 10000 / ILLUSTRATIVE_VALUES.contributionMargin, high: 10000 / ILLUSTRATIVE_VALUES.contributionMargin });
  assert.ok(result.notes.some(x => x.startsWith("Illustrative")));
  assert.equal(result.assumedContributionAfterFixed, null);
  assert.equal(decisionFinanceInputsSchema.safeParse({ ...filled, contributionMargin: 0.5 }).success, false);
  const { illustrative: _omit, ...legacy } = emptyFinanceInputs();
  assert.deepEqual(decisionFinanceInputsSchema.parse(legacy).illustrative, [], "pre-illustrative saves still parse");
});

test("occupancy breakdown separates base rent from additional charges without double counting", () => {
  const excluded = search.candidates[1].candidate; // service type 10: charges not included
  const split = occupancyBreakdown(excluded, 800);
  assert.equal(split.additional.status, "known");
  const total = calculateDecisionFinance(excluded, { ...emptyFinanceInputs(), additionalOccupancyMonthly: 800 }).occupancy;
  if (split.baseRent && total) assert.equal(total.low, split.baseRent.low + 800);
  const included = search.candidates[0].candidate; // service type 7: included
  assert.equal(occupancyBreakdown(included, 800).additional.status, "included_in_rent");
  assert.equal(occupancyBreakdown({ ...excluded, rent: null }, null).baseRent, null);
  assert.equal(occupancyBreakdown(excluded, null).additional.status, "unknown");
});

test("provider hook inspect: live-only evidence with scope echo; failures/aborts stay explicit", async () => {
  const candidate = { ...search.candidates[0].candidate, isDemo: false };
  const lookup = [{ candidateId: candidate.id, definitionVersion: "houston-sn15-lookup-v1", isMember: true, checkedAt: now, sourceDate: "2026-11-01", referenceUrl: "https://www.houstontx.gov/superneighborhoods/15.html" }];
  const adapters = createEvidenceProviderAdapters({ network: false, now: () => now, neighborhoodLookup: lookup });
  const ok = await adapters.inspect!({ version: PROVIDER_CONTRACT_VERSION, scope, candidate, evidenceIds: [] }, new AbortController().signal);
  assert.equal(ok.status, "partial");
  assert.deepEqual(ok.scope, scope);
  assert.equal(ok.evidence[0].observedAt, "2026-11-01T00:00:00.000Z");
  assert.equal(ok.facts[0].field, "neighborhood");
  const none = await createEvidenceProviderAdapters({ network: false, now: () => now }).inspect!({ version: PROVIDER_CONTRACT_VERSION, scope, candidate, evidenceIds: [] }, new AbortController().signal);
  assert.equal(none.status, "unavailable"); assert.deepEqual(none.facts, []);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(adapters.inspect!({ version: PROVIDER_CONTRACT_VERSION, scope, candidate, evidenceIds: [] }, aborted.signal));
  const market = await adapters.market!({ version: PROVIDER_CONTRACT_VERSION, scope, cityId: "houston" }, new AbortController().signal);
  assert.equal(market.status, "unavailable"); assert.deepEqual(market.context, []);
});
