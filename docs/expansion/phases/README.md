# Expansion implementation — five executable phases

Status: implementation instructions prepared; no phase has been implemented by creating these documents.

## Start here

Run phases sequentially in the same repository. Each phase has a copyable AI-agent prompt, specific deliverables, tests and a completion gate. Every agent reads and updates [DECISIONS.md](../DECISIONS.md), the shared record of actual implementation state. A new chat can start from the phase prompt without the earlier conversation.

| Phase | Working result | Prerequisite | Prompt and acceptance tests |
|---|---|---|---|
| 1 | Cedar Kitchen profile review/edit/validate/save in the browser | Existing application | [Profile and contracts](01-profile-and-contracts.md) |
| 2 | Full-city space search, deterministic requirement assessments and calculation tools | Phase 1 contracts and profile screen | [Search and deterministic tools](02-search-and-deterministic-tools.md) |
| 3 | Required Python Deep Agents planner + five specialists, real tools and live progress | Phase 2 callable tools and run records | [Deep Agents workflow](03-deep-agents-workflow.md) |
| 4 | Evidence enrichment, investigation, financial comparison and saved decision brief | Phase 3 agent-backed run path | [Investigation and decisions](04-investigation-and-decisions.md) |
| 5 | Integrated regression tests, persistence/access controls, deployment and operational proof | Phases 1–4 core gates | [Release and operations](05-release-and-operations.md) |

**Deep Agents is required.** Phase 3 is a product milestone, not a stretch item. The completed application uses actual Python `deepagents` execution with a planner and readiness, market, site, inspection and finance specialists. Static progress messages, a generic chatbot, or a handwritten workflow labeled “Deep Agents” do not pass. Deterministic search remains available if the model is unavailable, but that fallback does not satisfy the agent integration gate.

The [original detailed plan](../PROFILE_DRIVEN_IMPLEMENTATION_PLAN.md) remains the background requirements/work-package inventory. These five phase documents replace its previous eleven-step execution order. On conflicts, follow the current user instruction, repository guidance, these phase instructions, then the background plan. Keep shared-contract changes coordinated with Asilbek.

## Rules every phase follows

1. Read root and Expansion `AGENTS.md`, relevant specs, this file, the phase file and the entire handoff ledger. Inspect `git status` and current source. Preserve unrelated/uncommitted work.
2. Check prerequisite evidence in the ledger against the actual files and contracts. Do not treat an old “passed” sentence as a current test run. Repair a small in-scope predecessor defect and record it; report a material incompatible dependency without inventing completion.
3. Implement the requested phase end to end. Use the actual package manager and existing UI tokens. Keep new domain contracts local to Expansion. Do not implement unrelated later phases or alter Tactical ownership boundaries.
4. Keep fictional profile, synthetic test fixtures, actual property snapshots, derived observations and user assumptions separately labeled. No fake listings, missing-evidence defaults, fabricated progress or guaranteed shortlist size.
5. Put TypeScript Node tests directly in `src/features/expansion/*.test.ts` unless the test script is deliberately extended: the current `npm test` glob does not discover arbitrary nested tests. Browser tests belong in `src/features/expansion/frontend/e2e/`. Document any new Python test command/environment.
6. Run the checks below, fix regressions, perform the phase's browser acceptance path and record evidence. Tests that only mock the full application boundary do not establish that its backend works.
7. Update ledger state, contracts, decisions, actual file paths and next-phase notes before the final report. Report changes, touched files, commands/results, data mode, risks and remaining work. Do not automatically start the next phase.

## Common verification gate

Run from repository root, sequentially when build/server state may conflict:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Use the installed Node version meeting `package.json` and the existing Playwright configuration. If an installed Chrome is needed, set `PLAYWRIGHT_CHANNEL=chrome`; record that choice. Do not modify assertions or skip regressions merely to turn the gate green. A changed UI may require updating old selectors to its equivalent functional behavior; explain those changes.

Maintain a test-owned, seeded synthetic backend environment and exercise new routes against it without intercepting every API response. Tests must not overwrite private caches or depend on external tile access. Use API mocks only for controlled provider failures and deterministic browser edge cases.

If configured, separately run the existing real-data integration path using `EXPANSION_E2E_LOCAL=1` and record its command/outcome. A skipped private-dataset test is not real-dataset proof. No private-data setup is required for synthetic unit/integration tests. Do not paste source records or credentials into reports.

For Python changes, run the repository's existing helper tests where dependencies are available:

```bash
python -m unittest discover -s tests -p test_data_access.py
```

The phase introducing the worker must add and document a separate discoverable worker/contract test command. Use a dedicated virtual environment and lock the added dependencies. At each subsequent phase, run both affected Python suites as well as the common checks.

Record an unavailable prerequisite, browser runtime, dependency or credential as an unrun/blocked check with the exact reason. Fix what can be fixed within scope, preserve the working baseline, and do not mark the affected gate complete. “All tests pass” requires actual commands and results.

## Handoff and completion semantics

Phase statuses: `not_started`, `in_progress`, `partial`, `blocked`, `complete`. A phase is `complete` only when every required deliverable and gate passes. These are project ledger labels, independent of any chat/goal-tool status.

Core local results and external integrations have separate gates. A source may correctly return `unavailable`, but that does not prove a live provider integration. Phase 4 can finish its core UI while an external evidence gate remains blocked; its overall phase stays `partial`. Phase 5 may harden completed core behavior while those gaps are visible, but cannot call the full release complete until required gates pass or the user explicitly changes scope. No agent may silently move required work into “optional.”

At the end of every phase append a dated handoff with: delivered behavior, files/contracts, tests with pass/fail/skip counts, live versus synthetic evidence, remaining work, blockers, and the exact next task. Update the current-state table without deleting earlier entries.
