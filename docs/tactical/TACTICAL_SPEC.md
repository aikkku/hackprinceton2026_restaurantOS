# RestaurantOS — Tactical Intelligence (Asilbek)

> Historical MVP specification. The later [product refinement brief](PRODUCT_REFINEMENT_BRIEF.md) extends this scope. See [implementation status](IMPLEMENTATION_STATUS.md) for what is actually built; this specification is not a completion checklist.
**Status:** foundation for follow-up Codex prompts; not an instruction to generate the entire application immediately.  
**Owner:** Asilbek  
**Partner domain:** Rain's Expansion/Strategic Intelligence  
**Product mode:** game-first, analyst-grade detail on demand

## 1. Vision

Tactical is the playable business-improvement side of RestaurantOS. An owner should understand what customers/operating data suggest, choose from useful interventions, and see **modeled** effects on their existing restaurant. The experience resembles a friendly restaurant tycoon simulator, but its results must remain explainable, data-bound, and reversible.

**One-line user journey:** `restaurant data → opportunities/missions → choose an action → simulate → compare → review evidence → save decision`.

**Not the pitch:** "Chat with AI about your restaurant."  
**The pitch:** "Play through business improvements using your restaurant's actual signals and transparent what-if models."

## 2. Users and inputs

Owner/manager is the primary user. Two separate teammates own restaurant contact and data gathering, not Asilbek. Tactical must accept both real permissioned records and approved example fixtures.

Potential inputs, each optional depending on the mission:
- Restaurant metadata: name, cuisine, location, approximate seats, hours.
- Customer reviews: CSV/imported text with source/date/rating where available.
- Menu: items, prices, and optional ingredient or contribution costs.
- Business assumptions: average check, operating days, table turns, occupancy, incremental margin, investment budget.
- Optional authorized photos/floor-plan details (with permission; no identifiable customers).
- Optional Nessie sandbox finance data (must be clearly tagged simulated).

Do not make users complete an exhaustive onboarding form or disclose sensitive data before seeing a demo.

## 3. Game-first user experience

### Overview / Restaurant World
A warm, lightweight, ideally isometric or pseudo-isometric restaurant illustration (2D/SVG is sufficient); it need not reflect actual interior geometry. A slim HUD may show revenue/cash, capacity, customer satisfaction, and suggested opportunity count **only if modeled or provided with explicitly stated origin**. Visible areas/objects can open missions or related insights. Support keyboard navigation, mobile fallback, and reduced motion.

### Mission Board
Cards generated from analysis (or clearly labeled fixture examples):
- Title and human explanation of business issue.
- Why it surfaced (review clusters, counts, quote references, supplied metrics).
- Priority, estimated applicability, unknowns.
- 2–3 feasible action choices, one marked recommended only if justified.
- Button: `Try a scenario`.

### Scenario Playground
The owner picks an intervention (e.g. add seats, rearrange tables, improve turnover, reprice a dish), adjusts levers, runs the calculation, and sees **before/after projected outcomes**. A visual restaurant element can animate to reflect the choice. It is a simulation preview, never a modification of physical restaurant state.

### Analyst Drawer
Expand on demand for the exact input table, formulas, assumptions, source IDs/reviews, uncertainty, notes about what data is missing, and a clear comparison of scenarios. Keep primary game view understandable without the drawer.

### Saved Decisions
Save scenario inputs and calculated output as a reproducible snapshot. The owner can compare alternatives and revert to the baseline. No real-world changes or purchases occur.

## 4. Recommended first vertical slice — 'The Seating Problem'

The AI identifies seating/wait complaints in permitted review data (if actually present) or displays a **demo-labeled fixture mission**. User chooses one of: rearrange room, add N seats, or improve turnover. For MVP, only one option needs detailed financial modeling; other choices can be unavailable or clearly illustrative until implemented.

### Example inputs
`additionalSeats`, `turnsPerDay`, `occupancyFraction`, `averageCheck`, `operatingDaysPerMonth`, `incrementalContributionMargin`, `investmentCost`.

### Example deterministic calculations

```text
additionalCoversPerDay = additionalSeats × turnsPerDay × occupancyFraction
incrementalRevenuePerMonth = additionalCoversPerDay × averageCheck × operatingDaysPerMonth
incrementalContributionPerMonth = incrementalRevenuePerMonth × incrementalContributionMargin
simplePaybackMonths = investmentCost / incrementalContributionPerMonth
  (only if incremental contribution > 0; otherwise not reachable)
```

These formulas represent a **simplified incremental-capacity what-if**, **not** an empirical forecast. They require extra demand to fill added seats and ignore displacement, table-size mismatch, permit/space constraints, some fixed costs, financing, taxes, and demand uncertainty. Clearly show these limits. Add optional pessimistic/base/optimistic assumptions only after the baseline works; do not call them statistical confidence intervals.

For a turnover improvement, calculate using existing seating capacity and the **change** in turns, rather than pretending additional seats were built. For pricing, consider unit contribution and demand sensitivity; never assume a price increase increases profit without considering volume.

### Acceptance criteria for this slice
1. A user can load a demo restaurant or upload a small review dataset.
2. An insight appears with evidence references (not just AI prose).
3. The user can choose an action and edit assumptions.
4. Projections update consistently and are verified by unit tests.
5. The restaurant scene/HUD offers meaningful but nondeceptive visual feedback.
6. The Analyst Drawer reveals formula, inputs, source provenance, and missing data.
7. The user can compare/revert a scenario without losing baseline data.
8. The page works without a live external API using a **clearly marked** fixture.

## 5. AI implementation model

**AI's job:** classify reviews, recognize recurring topics, extract evidence references, identify missing information, propose limited actions, and explain *computed* results in natural language.

**Code's job:** validation, aggregate counts, numerical simulation, ranking rules, persistence, data provenance, and scenario comparison.

Proposed flow:

```text
Uploaded reviews
  → parse + deduplicate + validate
  → structured AI classification (topic/sentiment/evidence refs)
  → deterministic aggregation
  → evidence-backed mission proposals
  → user selects and edits scenario
  → deterministic simulation
  → AI explanation of calculated outcome (optional)
  → save scenario + provenance
```

Do not expose raw private business data unnecessarily to third-party model services; use minimal input and clear permissions. Handle invalid model output and outages; do not invent successful analyses.

## 6. Tactical implementation slices

| Milestone | Deliverable | Working demo evidence |
|---|---|---|
| T0 | Domain types, fixture, view skeleton | Demo restaurant loads, no false live metrics |
| T1 | Review ingestion + AI analysis | Review text → topic counts and cited findings |
| T2 | Mission pipeline | Finding → mission with real or fixture evidence |
| T3 | Seating scenario engine + tests | Edited input → reproducible projected values |
| T4 | Game scene/mission feedback + analyst drawer | Same scenario accessible in fun and detailed modes |
| T5 | Saved scenario + comparison | Baseline and alternate scenario persisted/compared |
| T6 | Sponsor integration / contextual advisor | Only if T0–T5 are stable and requirements verified |

Milestones are priorities, not a promise to ship every one. Codex should implement **only the current requested slice**.

## 7. HackPrinceton tracks and proof of work

| Track | Tactical contribution | What would count as convincing proof |
|---|---|---|
| **Main: Business & Enterprise** | Turn real restaurant observations into actionable decisions | Working analyze → mission → simulation → explained result |
| **Capital One / Nessie (candidate)** | Cash-flow or investment mission using simulated banking data | Real Nessie API requests + documented mapping into financial inputs; distinguish sandbox from real finance |
| **Amazon AI (candidate)** | Structured review understanding and natural-language recommendation explanations | Working AI pipeline and required Amazon technology **if** sponsor challenge demands it |
| **Arlequin (stretch)** | Connected social/review graph analysis | Genuine observed edges and graph-derived patterns; review sentiment alone is insufficient |
| **Peri (team-managed candidate)** | Solve one concrete issue supplied by the outreach teammates | Real business consultation evidence/permission and a tailored workflow; outreach itself is not Tactical dev ownership |
| **CoStar** | Tactical findings can feed expansion preferences | Rain owns property/map integration; no duplicate Tactical implementation |
| **Photon (optional)** | Saved analyses can be queried by future messaging interface | Only a qualifying working channel integration counts |

Track-specific rules, API keys, data availability, and sponsor submissions must be verified independently. No feature should claim verified eligibility merely because it resembles a sponsor theme.

## 8. Integration with Rain's Expansion

Use shared restaurant identity, evidence model, recommendation/mission shape, and scenario conventions. Tactical can publish a capacity-related opportunity and suggested property constraints; Expansion can consume it to inform **user-controlled** filters. Tactical should not depend on Rain's geographic implementation, and Expansion should not import Tactical internals. See `SHARED_CONTRACT_PROPOSAL.md`.

## 9. What not to build yet

Full POS and inventory system; production payment processing; real employee scheduling; auto-applied business changes; complex restaurant NPC simulation; physically accurate floor-plan optimization; generalized agent orchestra; persistent avatar/leveling mechanics disconnected from evidence; unrelated admin dashboards.

## 10. Questions to resolve through future prompts

- Exact visual reference/style for the restaurant scene.
- Whether to use React/SVG, Canvas, or static isometric illustration.
- Actual availability of customer reviews, menu, sales, and capacity information.
- Which financial mission is the first fully modeled one.
- Which sponsor APIs are already accessible and what they explicitly require.
- Which shared contract shape both developers will freeze together.
