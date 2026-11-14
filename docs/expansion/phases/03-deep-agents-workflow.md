# Phase 3 — required Deep Agents planner and five specialists

## Working result and prerequisite

The owner starts an agent-backed scouting run. An actual Python Deep Agents planner delegates to five specialists, invokes real allowlisted tools, persists versioned results, and streams actual progress to the existing Next.js UI. AI failure leaves the deterministic Phase 2 search usable but visibly distinct. This phase is required for product completion.

Consume Phase 2 run/assessment/calculation contracts; verify them against source and tests. Use a new isolated worker directory under `src/features/expansion/` (suggested `agent/`), a locked Python environment, Next.js server bridge/events routes and frontend run-progress components. Do not move the frontend or duplicate financial/scoring logic.

## Implement in order

1. Check official Deep Agents documentation and pin compatible versions. Add the genuine Python `deepagents` dependency plus the minimal required provider/transport dependencies. Reuse already configured provider access if appropriate; do not add competing model clients casually. Record exact setup/start/test commands and required environment names without reading values into reports.
2. Define validated Python models matching Phase 2 tool DTOs, plus versioned stage/event/result envelopes. Commit synthetic cross-language fixtures and verify both TypeScript and Python parse them. Schema changes require a version/migration, not silent contract drift.
3. Build a narrow authenticated internal bridge to deterministic TypeScript tools. Bind every tool call to run ID, owner/session, profile revision and dataset snapshot. Accept bounded queries/IDs only. Reject arbitrary URLs, shell commands, filesystem paths and cross-run access. The Python worker calls financial tools rather than reproducing arithmetic.
4. Create the actual Deep Agents planner and these five configured specialists:

| Specialist | Required real tool path | Structured result |
|---|---|---|
| Readiness | Profile/completeness evaluator; agreed Tactical report only if present | Missing data/follow-ups, not an invented readiness score |
| Market | Source-capability and available geography/market lookup | Sourced context or explicit unavailable reasons |
| Site scout | Phase 2 citywide search/assessment tools | Candidate IDs, counts, reasons and versions |
| Space inspector | Candidate/evidence lookup and supported inspection adapters | Suite-scoped facts, gaps and verification tasks |
| Finance | Phase 2 deterministic calculation/completeness tools | Validated required-sales/cash results or missing inputs |

5. Enforce dependencies: readiness and available market context can run independently; site search must not require missing market scores; inspection follows candidates; finance follows supported inputs; planner composes validated outputs. For the Cedar Kitchen acceptance run, demonstrate all five genuine delegations, including unavailable results where evidence is absent. Do not require an irrelevant provider call or fabricate observations to keep a role busy.
6. Share allowlisted run-scoped virtual artifacts (`profile.json`, `market.json`, `candidates.json`, `inspection.json`, `finance.json`, `summary.json`). Validate before writing/reading, isolate runs, and persist final validated results through the application run store. Do not treat the agent virtual filesystem as durable account storage.
7. Enforce bounded calls, timeouts, retry policy, cancellation, duplicate-run protection and safe recovery. Validate candidate/evidence IDs and numeric results against tool output. Block outputs that invent IDs, alter hard requirements or replace unavailable values. Untrusted property text is source data, not instructions.
8. Add replayable SSE events with sequence IDs: run/stage started, tool completed, unavailable/error, completed/cancelled. Stream real events only; show stage summaries rather than hidden reasoning. Support reconnect without duplicate results. Redact private payloads from logs/tracing; optional LangSmith is not a substitute for durable run state.
9. Surface “Agent-assisted scouting,” actual specialist stages, missing evidence and final grounded explanation. Retain an explicit deterministic-search path when worker/model access fails. Agent execution is complete only after the persisted output validates; no success badge for failed/abandoned calls.

## Required tests and live proof

- Worker tests use a deterministic model/tool test double to exercise genuine Deep Agents framework dispatch for all five specialists; do not replace the framework with a handwritten planner in the test.
- Contract fixtures round-trip between Python and TypeScript; reject unknown evidence/candidate IDs, invalid numeric results and mismatched revisions/datasets.
- Tool auth/session/run isolation, path/URL injection, source-text instruction injection, malformed model output and refusal.
- Timeout/retry budget, partial provider failure, cancellation mid-tool, duplicate submission, worker restart and SSE sequence/reconnect behavior.
- Browser: start → see actual stage events → inspect grounded results → cancel another run → retry model outage through the explicit deterministic path. Add backend/worker integration coverage beyond browser mocks.
- Run common Node/build/browser gates, Python helper tests and the new worker/contract suite.
- Separately perform a bounded live provider run using explicitly labeled synthetic restaurant/property facts permitted for model processing. Record timestamp, framework/provider versions, five delegated role names, tool-call counts, terminal status and validated output evidence without secrets/private payloads. This proves real model/framework wiring; it does not prove private-data or external-source integration.

If model access is missing or denied, deliver the testable wiring and honest error path, record the live proof as blocked, and leave Phase 3 `partial`/`blocked`. Mocks alone cannot satisfy the required live Deep Agents gate.

## Completion and next handoff

Complete only when genuine framework execution, tool/contract validation, UI streaming and bounded live proof all pass. Record versions, worker commands/config names, internal bridge/auth contract, event schema, artifact ownership/lifecycle, provider verification and pending evidence adapters. Phase 4 adds real evidence and decision UI without replacing the planner or creating another run system.

## Copyable agent prompt

```text
Implement Phase 3, the REQUIRED Deep Agents integration, in /Users/nofear/Documents/GitHub/hackprinceton2026_restaurantOS.

Read root/Expansion guidance, applicable specs, docs/expansion/phases/README.md, DECISIONS.md and docs/expansion/phases/03-deep-agents-workflow.md. Verify Phase 2 tool/run contracts. Follow every deliverable and gate in the phase document. Deep Agents is central scope, not optional.

Implement an actual Python deepagents planner with readiness, market, site-scout, space-inspector and finance specialists. Use authenticated, bounded tools and validated shared run artifacts. Matching/financial arithmetic stays in TypeScript. Connect durable run results and replayable real SSE stage events to Next.js. Preserve deterministic search during model outages while clearly labeling its different execution mode.

Test genuine framework delegation with deterministic test doubles, cross-language contracts, evidence validation, run isolation, timeouts/retries, cancellation, reconnection and the browser journey. Run Node/common and Python checks. Perform the bounded live model/framework proof using labeled synthetic data; if access is unavailable, record the blocker and do not call the integration complete. Never fake agent progress or external-source evidence.

Update docs/expansion/DECISIONS.md with actual framework/provider versions, startup/test commands, tool/event contracts, proof of all five delegations, remaining adapters and precise Phase 4 handoff. Report working behavior, validation evidence and limitations. Stop after Phase 3.
```
