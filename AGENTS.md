# RestaurantOS — Repository Guidance for Codex

> **Status:** initial foundation / working agreement. Product requirements in future prompts take precedence. This file is intentionally neutral between Tactical (Asilbek) and Expansion (Rain).

## Product in one paragraph
RestaurantOS is an AI-powered **restaurant business simulator** for independent restaurants. It makes serious operational and growth decisions approachable through a tycoon/strategy-game experience. The default interface is playful and visual; advanced calculations, assumptions, evidence, uncertainty, and data provenance are accessible on demand. **This is decision-support software, not a game that fabricates business results and not a chatbot-only product.**

## Ownership and boundaries
- **Asilbek:** Tactical — improve the existing restaurant (reviews, menus/pricing, seating, operations, costs, simulations).
- **Rain:** Strategic/Expansion — evaluate where and whether to grow (geographic opportunity map, properties, comparisons, financial feasibility).
- **Other teammates:** restaurant outreach/interviews, permissions, and relevant data collection. Developers must not block on outreach; build against clearly labeled fixtures.
- Modules share app shell, design tokens, business entities, scenario/calculation conventions, recommendations, and source/evidence records.
- Prefer `src/features/tactical/` for Tactical code and `src/features/expansion/` for Expansion code. Shared modules belong under `src/components/`, `src/lib/`, and `src/schemas/` after both developers agree on the contract.
- **Do not edit another developer's owned module without explicit permission.** Propose shared-contract changes instead of silently introducing breaking types.

## Stack — proposed defaults, not irrevocable decisions
Next.js App Router + TypeScript, Tailwind CSS, shadcn/ui, Zod, MongoDB (user-selected shared `restaurantos` database; feature-owned collections), an AI model with structured outputs, lightweight React/SVG/motion for the game presentation, and deterministic TypeScript functions for numeric simulation. Use the repo's actual package manager and installed libraries once established. Avoid introducing a second backend or full game engine without a specific need.

## Product conventions
- Both modes use **Mission → Action → Scenario → Outcome → Evidence** as shared concepts.
- Default to **Game Mode**: clear missions, visual changes, and intuitive projected indicators. Provide an **Analyst Mode** drawer/panel for sources, formulas, assumptions, limitations, and sensitivity analysis.
- Favor tasteful game mechanics (missions, comparisons, progress, reversible simulation) over fake progress, misleading rankings, or invented rewards.
- Every result distinguishes `observed`, `derived`, `assumed`, `simulated`, and `unavailable` values. Never imply a model output is measured ground truth.
- AI interprets unstructured data, proposes scenarios, and explains tradeoffs. AI **does not invent customer quotes, financial values, source records, or property data** and **does not calculate canonical financial results**. Deterministic code performs arithmetic.
- Do not scrape personal or platform-restricted content without permission. Treat business files as potentially sensitive; avoid logging them, exposing secrets, or committing them to git.
- Every external integration is an adapter with a demo-data fallback that is unmistakably labeled; a fallback is **not** a completed sponsor integration.

## UI consistency
- Centralize colors, spacing, typography, radii, status colors, map/simulation palettes, and animation durations as tokens. No independent Tactical/Expansion design languages.
- Reuse app shell, buttons, cards, typography, forms, source badges, mission cards, scenario cards, evidence panels, loading/empty/error states.
- Tactical may use a restaurant scene; Expansion may use a map. Different layouts, **same visual language and interaction grammar**.
- Keep the UI responsive and keyboard-accessible; animation must not block interaction and must respect reduced-motion preference.

## AI-assisted development protocol
1. For every new task, read this file, applicable nested `AGENTS.md`, and the relevant specifications. When editing Tactical code, read `src/features/tactical/AGENTS.md` even if Codex was launched from the repository root.
2. Confirm scope; inspect existing files; prefer a minimal vertical slice over speculative scaffolding.
3. Write or update validation schemas before integrating data sources. Keep API/model output schema stable.
4. Implement only what the current user prompt requests. **Do not proactively build the full product** from this foundation alone.
5. Don't introduce production dependencies or change shared contracts casually. Flag nontrivial shared changes for coordination.
6. Write focused tests for calculations, mappings, and error/empty cases. Run available lint, typecheck, tests, and build commands; if not configured, report that instead of claiming success.
7. At completion, report: changes, touched files, validation performed, remaining risks, and any assumptions.

## Hackathon alignment
- **Main track:** Business & Enterprise — help independent restaurants improve operations and business decisions.
- Potential sponsor tracks must correspond to **working, verifiable integrations/features**, not naming or visual imitation. Tactical may support Capital One/Nessie (sandbox financial records), Amazon AI (depending on exact challenge), and Arlequin (only if genuine network/relationship analysis is implemented). Peri consultation is supported by other teammates; Expansion/CoStar belongs to Rain.
- Do not assert that a sponsor's requirements are fulfilled unless access, implementation, and current challenge criteria have been verified.

## Working documents
- `docs/tactical/TACTICAL_SPEC.md` — Asilbek's product scope and MVP.
- `docs/tactical/SHARED_CONTRACT_PROPOSAL.md` — draft cross-domain interface, **not final until both developers agree**.
- `src/features/tactical/AGENTS.md` — more specific instructions for Asilbek's code.

## Definition of done for a feature
A reviewer can follow a realistic end-to-end path without manual code changes; data source and simulation assumptions are explicit; the feature handles loading/empty/error states, respects shared UI and contracts, and passes available checks.
