# Phase 5 — release verification, accounts and operations

## Working result and prerequisite

An authenticated owner can run the complete profile → actual Deep Agents → investigation → compare → saved brief journey with durable private storage, recoverable runs and a repeatable deployment procedure. Another reviewer can reproduce the result from setup instructions without manual code edits. Deterministic search still works during AI outages, and no success state conceals missing integrations.

Read all handoffs, inspect actual code and recheck prerequisite evidence. Required unresolved Phase 3 live execution or Phase 4 source gates stay visible. Do not label the full release complete until they pass or the user explicitly reduces scope. Independent release-hardening work can proceed.

## Implement in order

1. Replace local-session-only ownership with authenticated restaurant/profile/run/scenario ownership. Use the agreed Supabase arrangement where available; keep schema migrations scoped to Expansion and coordinate shared restaurant identity. Enforce ownership/RLS/server authorization on every read, write, event stream and worker tool call. A random run ID is not authorization.
2. Introduce versioned repositories for durable profiles/revisions, runs/stages/events, candidate assessments, facts, scenarios and briefs. Preserve provenance, immutable snapshots and schema/model versions. Define bounded retention for raw artifacts/events, refresh policy and deletion behavior; do not publicly expose licensed source data. Migrate existing browser drafts/briefs only through explicit import, preserving originals on failure.
3. Deployable runtime: Next.js frontend/API, persistent Python Deep Agents worker/queue and private dataset storage. Document concrete startup/health/readiness commands and environment names. Keep restricted datasets on a persistent permitted host or approved private database adapter; do not assume ignored local SQLite exists on frontend hosting. Use durable jobs/leases, heartbeat/recovery and idempotent writes so restarts cannot leave permanent fake-running states.
4. Add redacted operational diagnostics: stage duration, tool/model call counts, bounded usage, failures, source capability and retry status. Do not log confidential profiles/source payloads or hidden reasoning. Verify secrets stay server-side and traces do not leak records. Show actionable setup/unavailable messages while preserving owner drafts/results.
5. Create a repeatable synthetic demo seed and documented real-local setup. Pin Node/Python dependencies and document cache import/schema migration. Add CI checks that do not require private data/credentials; separate opt-in live provider tests with unmistakable results. Existing Tactical behavior/styles and demo/local mode remain regression requirements.
6. Verify production mode, not just the development server. Test a built Next.js server plus the worker using test-owned synthetic backend state; verify authenticated end-to-end runs, streaming, save/restore, worker restart and model/source outage. Check deployment health, migrations and smoke path in the target environment when accessible; otherwise record target-deployment proof as blocked.
7. Write `docs/expansion/RELEASE_RUNBOOK.md` with setup, architecture/contracts, commands, data locations without secrets, health checks, test matrix, two-minute demo path, capability table, known gaps, rollback and restore procedure. Exercise recovery using a nonproduction database/run store and record the outcome. Prepare deployment artifacts within authorized scope; distinguish prepared configuration from an observed hosted deployment.

## Required tests and verification

- Full lint/typecheck/Node/build/Playwright gates plus Python helper/worker/contract suites.
- Database migration up/re-run and supported rollback/restore on synthetic state; unique identifiers and immutable profile/run snapshots preserved.
- Two-user tests: owner B cannot read or mutate owner A's profile/run/candidates/brief/events or invoke its worker tools; include unauthenticated and expired-session cases.
- Production-mode browser journey with the actual worker framework, deterministic synthetic providers and real internal tools. No unhandled page/server errors; inspect mobile, keyboard, reduced motion, map-network failure and no horizontal overflow.
- Cancellation/retry/duplicate run, queue restart, API timeout, partial inspection, model refusal, invalid model evidence IDs, external source outage, and saved-brief access during source failure.
- Startup without optional credentials yields accurate capability/error states. Missing required model access cannot masquerade as a completed live agent run.
- One bounded end-to-end live model run proving the five specialists and persisted grounded results; separately record live source capabilities and dataset rights. Keep synthetic proof distinct from actual restaurant/property proof.
- Target-environment smoke test and nonproduction restore exercise. Record exact commands, timestamps, runtime versions, counts, exit codes and redacted evidence references.

Do not relax tests, invent evidence or omit failed gates to reach “release ready.” Fix in-scope defects and rerun affected checks; broaden tests when the changes justify it. Remaining infrastructure/credential gaps mean partial/blocked release status.

## Optional integrations, explicitly separate

Preserve a backlog for Nessie sandbox finance, Photon messages/alerts, broker-message drafting, MCP bridges and sponsor tracing/submission evidence. They are not blockers for the core release and must not delay its verification. Implement one only when explicitly selected in the implementation task and track it as a separate gate. Nessie needs shared ownership coordination; alerts need opt-in and a permitted refreshable source; sending a message requires explicit user authorization. Never claim a sponsor track fulfilled from names, mocks or configuration alone.

## Completion and handoff

Update `DECISIONS.md` with a final capability/gate matrix, actual deployed versus local status, tested runtime/source versions, deployment/restore evidence, remaining optional backlog and reproducible reviewer instructions. Required Deep Agents and source gates must be resolved or explicitly scoped out by the user. The next agent should be able to distinguish shipped functionality, tested local functionality and prepared-but-unverified infrastructure.

## Copyable agent prompt

```text
Implement Phase 5 release/operations work in /Users/nofear/Documents/GitHub/hackprinceton2026_restaurantOS.

Read repository/Expansion guidance, relevant specs, docs/expansion/phases/README.md, the entire DECISIONS.md ledger and docs/expansion/phases/05-release-and-operations.md. Verify earlier phase evidence against actual code. Complete the phase's authenticated ownership, durable storage, worker recovery, production-mode verification and release runbook deliverables, coordinating shared contracts and preserving Tactical boundaries.

Deep Agents is mandatory: verify real Python framework/planner/five-specialist execution, tools, evidence validation and live proof. Preserve deterministic fallback without calling it agent success. Do not disguise blocked source, credential or hosting gates as completed integrations. Finish independent hardening even when an external gate is blocked. Optional sponsor/messaging work stays a separate backlog unless explicitly selected.

Run full Node/common/Python suites, two-user isolation tests, production-server-plus-worker browser flow, failure/restart cases, target-environment smoke checks where accessible and a nonproduction restore exercise. Fix regressions and record actual results without weakening assertions.

Write docs/expansion/RELEASE_RUNBOOK.md and update DECISIONS.md with the final capability matrix, deployed/local/prepared distinctions, test/restore evidence and remaining work. Report working flow, changed files, commands/results, source modes and risks. Mark complete only when every required gate passes or the user explicitly changes scope. Stop after Phase 5.
```
