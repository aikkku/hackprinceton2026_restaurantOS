# Tactical Domain — Asilbek / Codex Instructions

> Scope: Tactical code under `src/features/tactical/`. Inherit repository `AGENTS.md`. **This is a foundation, not a command to implement everything.** Await specific feature prompts.

## Tactical mission
Help an independent restaurant owner **improve the restaurant they already operate**. Turn supplied restaurant information into evidence-backed improvement missions, let the owner test possible actions in a fun restaurant-tycoon interface, and show transparent financial or operational tradeoffs.

## Priorities, in order
1. **Restaurant context:** a profile and safe, clearly labeled demo fixtures/import contracts.
2. **Customer intelligence:** validate uploaded review text/CSV, extract structured themes with AI, aggregate deterministically, and retain links to source reviews.
3. **Mission generator:** derive a bounded set of actionable missions (problem, evidence, possible actions, unknowns). Do not use arbitrary generic AI advice.
4. **Decision simulator:** a real, deterministic scenario model for one high-value mission (prefer a seating/capacity or table-turnover scenario, subject to later prompts).
5. **Game presentation:** small restaurant scene, mission cards, reversible decisions, projected indicators, and visual feedback. Game is an interface to a real model.
6. **Advanced details:** a drawer/panel revealing formulas, assumptions, supporting evidence, and model limitations.
7. **Optional sponsor feature:** Nessie sandbox financial data if integration access is available and challenge requirements are met; other tracks only as requested.

## Explicitly not Tactical scope
- No commercial expansion geospatial map, H3 cells, CoStar properties, or site scoring; Rain owns Expansion.
- No employee personal-data ingestion, POS integration, real-world purchase/ordering, production accounting, automated pricing changes, or unvalidated staffing optimization.
- No elaborate 3D restaurant builder, pathfinding, NPC physics, or unconstrained agent swarm for the MVP.
- No generic chatbot as the core user experience. An advisor may later access Tactical's saved analyses through shared tools.

## Tactical architecture
- Use `src/app/tactical/` for Next.js route entry points. Put Tactical UI, browser storage, and demo fixtures in `frontend/`, and keep pure calculations and validation schemas in `domain/` so the browser and future server code can reuse them.
- Reserve `backend/` for server-side data access, actions, and integrations. Keep server dependencies out of `frontend/` and `domain/`. Coordinate abstractions shared with Expansion before moving them outside Tactical.
- Keep numerical methods as **pure tested functions** in the shared decision library when the same formula will serve Expansion; otherwise put them in a clearly named Tactical module and propose promotion later.
- Separate three concepts: (1) observed facts, (2) editable simulation assumptions, and (3) calculated projections.
- Never call an LLM from a render component. Run model calls server-side, validate responses, use caching/persistence when appropriate, and show error/retry states.
- Make mission, scenario, recommendation, evidence, and business identifiers stable so saved analyses can be revisited.
- Use the proposed shared contract in `docs/tactical/SHARED_CONTRACT_PROPOSAL.md` as discussion input, not a license to overwrite Rain's types.

## Mission interaction pattern
**Discover mission → inspect evidence → choose action → configure scenario → simulate → compare results → save/revert → view analysis.**
- Showing a projected improvement must not silently modify the underlying restaurant profile.
- Game HUD metrics (cash, happiness, capacity, score) need definitions and provenance. If not supported by supplied data, show them as clearly labeled illustrative demo estimates or omit them.
- Do not award "success" based solely on an attractive animation or AI assertion.
- Always provide a path from simplified feedback to model inputs and limitations.

## AI requirements
- Extract themes and sentiment from provided reviews and optional authorized images; use structured outputs and local validation.
- Each actionable insight carries evidence IDs, confidence/limitations, and recommended next steps.
- AI may suggest a set of scenario assumptions, but they are **editable estimates**, never unseen facts.
- Financial/payback values are computed by code, not asked from the LLM.
- Do not claim image-based seating optimization without measurements or a valid floor plan. Images alone do not establish exact room dimensions, counts, or capacity.

## Coding quality and collaboration
- Before modifying shared UI/contracts or shared dependencies, check for ownership and request coordination in the PR or task notes.
- Avoid editing `src/features/expansion/`.
- Add tests for deterministic scenario calculations including zero volume, zero margin, invalid input, and assumption changes.
- Use stable fixtures and no API secrets in the browser. Mark fixture data visibly.
- After each task, describe what the user can now demonstrate end to end, plus what remains mocked or unimplemented.

## Tactical track evidence
- **Business & Enterprise:** demonstrate how a restaurant owner identifies an operational issue and evaluates a decision.
- **Capital One Nessie (conditional):** real integration with sandbox endpoints and a clear finance scenario; do not substitute a locally fabricated record while claiming sponsor integration.
- **Amazon AI (conditional):** AI mission discovery/structured analysis is plausible, but verify the specific required service and judging rules.
- **Arlequin (stretch):** sentiment classification alone is not network analysis; only claim it if genuine observed graph relationships and pattern analysis exist.
- **Peri (team-managed):** ingest permissioned non-sensitive restaurant findings gathered by the other members; development shouldn't depend on meeting arrangements.
