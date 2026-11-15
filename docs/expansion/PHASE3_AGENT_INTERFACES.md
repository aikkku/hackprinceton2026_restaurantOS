# Phase 3 → Phase 4 agent interface v1

Contract freeze: 2026-11-14 (America/New_York). Phase 3 implementation is in progress; this contract commit does not claim the worker integration is complete. Phase 4 may implement against synthetic fixtures. Changes to required fields or meanings require coordination and a new version.

## Existing Phase 2 contracts remain canonical

- `domain/matching.ts`: `candidateSchema`, `assessedCandidateSchema`, `factSchema`, `evaluateCandidate`, `assessCandidates`. A candidate is an offered **space**, not its building. Candidate IDs and evidence IDs are opaque source IDs; never construct or infer them. Preserve every assessment's requirement ID, status, reason code, source value and evidence references. Ordering is deterministic.
- `domain/tools.ts`: `requiredSalesTool`, `occupancyRangeTool`, `invokeTool`. Required sales request `{fixedCostsMonthly, contributionMargin}`; response `{status: "available", requiredSalesMonthly}` or `{status: "unavailable", requiredSalesMonthly: null, reason}`. Occupancy input `{candidate, extrasMonthly: number|null, inclusion}`; response uses `known` and either `low/high/notes/serviceInclusion` or `reasonCode/reason/serviceInclusion`. Python never computes these values.
- `domain/schemas.ts`: existing `evidenceSchema` and origin enum. Inspection facts use existing `factSchema`, including `entityScope: "space"`, `entityId`, source, limitations, origin and demo flag. Building context cannot become suite verification.

## Run, artifacts and events

`domain/agent-scope.ts` defines `expansion-agent-v1` and a strict scope: `{runId, sessionId, revisionId, datasetId, snapshotId}`. `snapshotId` is an opaque SHA-256 snapshot identity (includes the actual cache identity and import metadata); it is not a source observation date.

`domain/runs.ts` retains `expansion-run-v1`, its existing statuses and candidate-page schema. Additive optional fields: `executionMode: "deterministic"|"agent"`, `agent: AgentState`. Old stored runs remain readable. Do not add a competing Phase 4 run lifecycle. Agent completion requires persisted validated outputs, not virtual files or model prose.

`domain/agent.ts` exports strict artifact schemas and `agentStateSchema`. Artifacts are exactly `profile.json`, `market.json`, `candidates.json`, `inspection.json`, `finance.json`, `summary.json`. Candidate artifact contains at most three finalists using the full **existing** `assessedCandidateSchema`; the existing run candidate API retains the full citywide result, not just these finalists. Inspection/finance results are space-scoped. Optional `providerResult` slots preserve validated adapter output without changing the baseline candidate report. Follow-up investigation should create a new assessment revision rather than rewrite historical facts.

SSE: `GET /api/expansion/runs/:id/events`, event name `progress`, monotonically increasing numeric `id`, payload `{version, runId, seq, at, type, stage, message}`. Event types: `run_started`, `stage_started`, `tool_completed`, `stage_completed`, `unavailable`, `error`, `completed`, `cancelled`. Stages: `planner`, `readiness`, `market`, `site_scout`, `space_inspector`, `finance`. Reconnect with `Last-Event-ID` (or initial `?after=`); consumers deduplicate by `(runId, seq)`. Messages are controlled stage/tool summaries, never hidden reasoning or raw provider payloads.

## Provider registration boundary (Phase 4 owns implementations)

`domain/agent-providers.ts` exports `expansion-agent-providers-v1`, strict request/result schemas and `AgentProviderAdapters`. `backend/agent-providers.ts` exports `registerAgentProviders(adapters)` and `getAgentProviders()`. Register once in server startup/instrumentation, before runs; registry is server-only and process-local. Registration returns a disposer for tests. No providers are registered by default. No dynamic module path or URL is accepted from a browser/model.

The optional hooks are:

- `market(request, signal)`: request contains version, scope, cityId; result echoes version/scope/cityId and includes status, evidence, gaps and context items `{label, value: string|null, origin, evidenceIds}`.
- `inspect(request, signal)`: request contains version, scope, canonical candidate, evidenceIds; result echoes version/scope and candidateId, with status, evidence, gaps and suite-scoped facts.
- `financeInputs(request, signal)`: request contains version, scope, candidateId, evidenceIds; result echoes version/scope/candidateId with status, evidence, gaps, `inputs: RequiredSalesInput|null`, `inputEvidenceIds`, assumptions. Return only explicitly supplied future-site inputs, never current-location values silently treated as future costs. Phase 3 invokes the existing TypeScript calculator and validates the result. Phase 4 owns additional financial tools and saved briefs.

Every result must match the requesting run/snapshot/candidate. Every fact/context/input reference must resolve to supplied or existing evidence. Respect AbortSignal; Phase 3 applies a bounded timeout and at most one transient retry. Provider errors become explicit unavailable evidence, never fabricated fallback observations. Adapter implementations must validate source mappings, suite association, permissions and units. Credentials stay server-side; raw payloads do not enter model prompts/logs/traces.

The internal worker bridge is private authenticated stdio, not a browser tool API. Bootstrap supplies a per-process random capability and immutable scope. Requests are strictly allowlisted role operations with artifact references only; models cannot submit financial overrides, raw facts, URLs or filesystem paths. Durable artifacts/events extend the existing file-backed run store; no new database is introduced and MongoDB connectivity does not block this phase.

## Integration checkpoints

- Shared synthetic cross-language fixture: `agent/fixtures/contract.json`.
- Contract test: `node --test --test-concurrency=1 src/features/expansion/agent-contracts.test.ts` (2 passed at freeze).
- Phase 3 will test real framework dispatch with deterministic chat/tool doubles and separately record a bounded live Gemini run.
- Phase 4 should add adapter schema/mapping tests with synthetic results. Final integration must register those actual outputs, execute the real Python worker, and verify resulting persisted inspection/finance/summary artifacts plus the browser journey. A contract-only or mocked UI test does not satisfy this integration gate.
