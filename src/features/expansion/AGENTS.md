# Expansion Domain — Rain / Codex Instructions

> Scope: Rain-owned Expansion/Strategic code under `src/features/expansion/`, its route(s), and associated `docs/expansion/`. Inherit the repository's root `AGENTS.md`. **Foundation only: wait for feature-specific user prompts.**

## Mission
Help an independent restaurant owner evaluate **whether and where to expand** using an interactive, game-like geographic strategy interface backed by traceable property/market evidence and deterministic financial reasoning.

## Ownership
- **Rain owns:** geographic exploration, H3 hex-cell analysis, maps, available property visualization/comparison, site scoring, expansion-feasibility scenarios, and Expansion-specific AI explanations.
- **Asilbek owns:** Tactical (reviews, seating improvements, menu/pricing, current-location operating decisions). **Do not edit `src/features/tactical/`** without explicit coordination.
- **Shared and jointly agreed:** app shell, design tokens, recommendation/evidence/scenario schemas, financial primitives, AI provider interface, persistent restaurant identity, and data-source badges.
- **Other teammates own:** outreach/interviews/permissions; implement against labeled fixtures while awaiting permissible real records.

## Read before every Expansion task
1. Root `AGENTS.md`.
2. This file.
3. `docs/expansion/EXPANSION_SPEC.md` and the most relevant other Expansion spec.
4. `docs/tactical/SHARED_CONTRACT_PROPOSAL.md` before creating cross-domain types or integration.
5. Existing repository source/tests; do not assume the starter kit created any runtime modules.

## Game-first product rules
- The default experience is a **strategy/tycoon map**, not a dense analytics dashboard or chat-first app.
- A user can choose city → explore colored hex areas → select an area → inspect available properties → run a what-if decision → compare and save options.
- Use shared UI/design primitives. Rain may use a full-viewport map workspace; it must still look like the same RestaurantOS as Tactical.
- Support **Game Mode** with clear overlays, mission prompts and responsive feedback, plus **Analyst Mode** for exact factors, data origin, limitations and formulas.
- Prefer meaningful interactions over fake coins/XP, invented property rankings, complex 3D, or decorative map animations.
- Changing a simulated decision **must not** change actual business records, mark a property as leased, or represent a real expansion commitment.

## Distinguish geographic objects
- **Area / H3 cell:** an approximate geographic analysis region with aggregated factors and coverage; not an individual lease listing.
- **Property:** a distinct verified, authorized commercial listing/record with its own attributes, price units, status, and source.
- An area score is not a property score; display them separately. A colored hex cannot be claimed to be available commercial space.
- H3 is a visual/analytical grid, not neighborhood boundaries or a causal prediction of sales.

## Scoring and financial integrity
- Run numeric scoring, weighting, normalization, and financial math in **pure, tested TypeScript functions**, not in an LLM prompt.
- Every score has inputs, units, directions, normalization definitions, weights, data coverage and `modelVersion`.
- Use `null`/unscored for unsupported results; don't silently replace missing data with fabricated or neutral values.
- Asking rent alone is not total occupancy cost. Preserve basis (`$/SF/year`, monthly, etc.), size, and extra expense assumptions before calculating totals.
- Financial scenario results are *what-if thresholds*, not guaranteed demand, future profit, customer footfall, or ROI.
- Support changes in weights/assumptions, reversible comparison, and the same input producing the same output.

## AI rules
- AI can organize/interpret text, propose candidate constraints, explain a selected cell/property score, summarize tradeoffs, and describe missing evidence.
- AI **cannot** invent CoStar records, market demand, traffic, demographic attributes, property vacancy, price, customer quotes, sources, or numeric scores.
- Tool/model calls happen server-side; schema-validate structured outputs and evidence IDs; avoid sending confidential sponsor data outside permitted uses.
- The map and property comparison must work meaningfully without an AI assistant. A contextual advisor is optional, later.

## Implementation guidance
- Tentative stack: repo-standard Next.js/TypeScript/Tailwind/shadcn/ui, Mapbox GL JS + `h3-js` if approved, Supabase for persistence, Zod at data boundaries.
- Use a provider adapter (e.g. `CoStarProvider` interface) so fixtures and real permitted CoStar data have one normalized shape. Never claim fixture mode is an active integration.
- Keep raw sponsor payloads isolated; make sanitized normalized records available to the frontend; no sponsor API credentials in client-side code.
- Avoid downloading or committing restricted property datasets, photographs, or licensed assets without permission.
- Render a bounded number of visible hexagons; build/aggregate off the render loop, update on zoom/filter, and handle map token/network failures.
- Accessible selection, controls, color legend, tooltip/panel, keyboard alternative and reduced-motion support are required. Do not communicate suitability with color alone.

## Cross-domain integration rule
- The existing `docs/tactical/SHARED_CONTRACT_PROPOSAL.md` is a **draft** and canonical discussion starting point; it is not finalized code.
- Keep Expansion-local types until both developers agree on shared schemas. Avoid silently editing `src/schemas/shared.ts` or shared calculation logic.
- Tactical can hand off a capacity-related recommendation through a *user-approved* action, not by importing Expansion internals. Expansion can hand back a property's explicit occupancy-cost assumptions without asserting those are fully verified total costs.

## HackPrinceton track proof
- **Main: Business & Enterprise:** an actual evaluate-location/compare-cost flow for independent restaurants.
- **CoStar candidate (highest Expansion priority):** permitted real dataset/API use, record attribution, map/property evaluation, clear demonstrated impact. Confirm challenge rules and access.
- **Capital One Nessie candidate:** Expansion can consume sandbox cash/expense inputs via a jointly owned integration; do not duplicate the finance client or assert real business balances.
- **Peri candidate:** restaurant-specific needs gathered by non-developer teammates inform filters/decisions; consent/evidence owned by the team.
- **Amazon AI candidate:** structured and grounded decision explanations only if specific sponsor technology/rules are met.
- **Arlequin / Photon / Deep Agents:** stretch only if a distinct, working, verifiable qualifying feature exists.

## Completion report required from Codex
For every scoped task report: (1) user-visible flow completed, (2) files modified, (3) proof of tests/lint/build or unrun commands, (4) data source used: fixture vs real, (5) model limitations and unresolved assumptions, (6) coordination needed with Asilbek, if any.
