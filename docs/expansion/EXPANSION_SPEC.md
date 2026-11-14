# RestaurantOS — Strategic / Expansion Intelligence (Rain)

**Status:** hackathon foundation; refined by later prompts. **Owner:** Rain. **Partner:** Asilbek / Tactical. **Default:** playful strategy-map view, advanced analysis on demand.

## 1. Product goal

Give independent restaurant owners an interactive, game-like way to assess **whether, where, and how** to expand. The product should feel like scouting regions and choosing a new location in a strategy game; its recommendations must be auditable, data-bounded business decision support, not fabricated game results.

**Core journey:** `choose market → inspect opportunity map → scout area → inspect property → configure expansion scenario → compare alternatives → save/revisit`.

Do not build the entire game from these docs. Implement only the next specifically prompted feature.

## 2. Input data / safe defaults

Potential inputs (any may be missing):
- Existing restaurant: restaurant ID, cuisine, current footprint/seats, known cash/budget, preferred location and expansion goals.
- Market: supported city and geographic bounds (initial intended cities: **Houston, TX** and **Los Angeles, CA**, depending on actual sponsor data coverage).
- Geography: mapped polygon/hex cell identifiers and sourced area-level factors where available.
- Property: actual permitted commercial property record, precise listing location if included, floor area, permitted use, asking rental/price basis, availability status if sourced, accessibility/parking attributes when included, timestamps.
- Financial assumptions: renovation/upfit, deposit, fixed operating costs, contribution margin, operating days, planned capacity, working capital.
- Tactical handoff: capacity pain point or expansion preference *with evidence and user approval*.

A sparse, **clearly labeled demo fixture** should permit a complete evaluation even without CoStar access. It must be impossible to confuse this with a current real listing or verified ranking.

## 3. Game mode experience

### A. Market selection: "Choose your city"
- Show only cities for which supported data or explicit demo fixtures are present.
- Clear local-versus-fixture/source labels.
- A concise mission objective, such as: **Find a suitable restaurant space within a monthly occupancy budget**.

### B. The expansion world map
- Base map with a grid of **hexagonal suitability areas**; reference inspiration is the colored green/yellow/orange/red hexagon overlay on a city map in `HackPrinceton F26.pdf`, page 3.
- Map legend explains metric, color direction, score coverage, and unavailable/gray cells.
- Overlay individual commercial-property pins separately from hexagons.
- Clicking a hexagon opens an **Area Scout** panel; clicking a property pin opens a **Property Scout** panel.
- Visible filters could include budget, minimum usable area, parking/accessibility, and weights where data supports them.

### C. Area scouting
- Area score or `Not enough data`, factor breakdown, known pros/cons, count of sourced candidate properties, evidence links and data coverage.
- AI may translate actual factor contributions into plain language, without manufacturing missing information.
- Next action: `View properties in this area`.

### D. Property scouting
- Record title/address (where authorized), source, floor area, rental basis, constraints/unknowns, property-specific fit and a comparison action.
- Do not assume a property is leased/available if current listing status is missing.
- Next action: `Try opening here` (a hypothetical financial scenario, not real transaction).

### E. What-if expansion simulator
- Let users adjust investment/upfit, area, rent, operating expenses, gross/contribution margin, initial working capital and any real/estimated sales assumption.
- Calculate break-even sales or required additional contribution and compare scenarios.
- If demand is unobserved, show **required sales**, not invented expected sales.
- Allow `Save scenario`, `Compare`, and `Reset to baseline`.

### F. Analyst Mode
- Expand a drawer with inputs, units, formulas, factor weights, data coverage, original source references, assumed-versus-observed values, caveats, and calculation version.
- Game Mode can be simplified, **not deceptive**. Important caveats (mock, estimated, stale, insufficient data) remain visible in both modes.

## 4. Screen concepts (shared style with Tactical)

| Screen / area | Game-first surface | Advanced detail |
|---|---|---|
| City selection | World/market selector | Data availability/source list |
| Expansion explorer | Zoomable hex opportunity map | Score factors, legend, coverage |
| Area scout | Territory card / area highlights | Source values, methods, uncertainty |
| Property scout | Building card / point marker | Record provenance, rent units, constraints |
| Scenario simulator | "Try opening here" controls and before/after | Math, assumptions, sensitivity and cash requirements |
| Saved strategies | Shortlisted scenarios and comparisons | Full reproducible snapshots |

Use the same app shell, typography, tokens, mission/status cards and analyst drawer patterns as Tactical. Different layout does not mean different visual identity.

## 5. AI-native features, not chat-first

1. **Area explanations:** articulate actual scoring factors and missing data for an area selected by the player.
2. **Smart constraints:** turn approved restaurant profile/Tactical findings into suggested **editable** filters (e.g., minimum seats or size), without converting a guess into a fact.
3. **Tradeoff briefing:** after comparing locations, summarize actual numeric differences and caveats.
4. **Question prompts:** suggest meaningful decisions such as "How much monthly revenue would this rent require?" rather than a blank chat prompt.
5. **Optional contextual advisor:** later, query current selection, saved scenarios, and valid calculation tools; not a prerequisite for a functioning map.

AI is not the scorer. Scores, cash requirements and financial projections come from deterministic, tested code. Source metadata follows every analysis.

## 6. MVP vertical slice (recommended)

**The mission: "Scout a new restaurant site."**

1. Load one **demo-marked** city region and 2–4 example candidate properties.
2. Show a small interactive hex-grid overlay (even if initially backed by a deliberately small static GeoJSON fixture).
3. Select a hex and inspect its factors, score and evidence/coverage.
4. Select a property and inspect its **individual** attributes.
5. Edit cost and financial assumptions; compute required revenue/break-even under a simple transparent model.
6. Compare two property scenarios and reset/save one.
7. Open Analyst Mode to see the methodology.
8. If available: replace fixture source with normalized **authorized CoStar** data, clearly marking what the source actually contains.

**Acceptance:** one reproducible interactive path, no manual source-code edits between actions, no undisclosed dummy values, no fake data passed off as CoStar, all numerical results tested. A real-time AI explanation is optional to the first vertical slice.

## 7. Incremental engineering plan

| Slice | Outcome | Proof |
|---|---|---|
| E0 | Route skeleton + shared shell + fixture boundaries | City workspace loads and is labeled Demo |
| E1 | Hex/polygon layer + legend | Click area; map and inspector agree on cell ID |
| E2 | Deterministic area scoring + coverage | Changing weights updates score; null is not assigned a color score |
| E3 | Candidate property markers/cards | Pins select verified fixture property, independent of area scores |
| E4 | Scenario engine + property compare | Inputs update required sales; two snapshots compare reliably |
| E5 | CoStar provider adapter (conditional) | Real permitted records mapped, labeled, and attributed |
| E6 | Contextual AI + Tactical handoff (conditional) | Grounded explanation and approved link from Tactical |
| E7 | Polish / demo reliability | One clean walkthrough, errors and empty states tested |

These are priorities, not blanket implementation authorization.

## 8. Out of scope for hackathon baseline

Nationwide accurate demand forecasts; true catchment/travel-time modeling without verified data; automated lease negotiation; physical space remodeling; regulatory/zoning determination; consumer demographic targeting; scraping restricted data; realistic city-builder economics; property valuation claims unsupported by data; immersive 3D city-building engine; autonomous property transactions.

## 9. Track relevance (conditional)

- **Business & Enterprise (main):** transparent site comparisons and financially informed business decisions.
- **CoStar (primary Expansion sponsor target):** actual authorized sponsor property/dataset contribution to site selection; map plus evidence-backed comparisons.
- **Capital One Nessie (joint, candidate):** connect simulated bank account/bill/transaction inputs to expansion financing scenarios via the shared financial layer.
- **Peri (team-managed, candidate):** tailor constraints/missions to a real participating restaurant via the outreach team's consented observations.
- **Amazon AI (candidate):** AI-grounded explanation/decision support, contingent on exact sponsor service/requirements.
- **Arlequin, Photon, Deep Agents (stretch):** only include if separate verified functionality helps the core product.

Do not claim track qualification before checking current sponsor challenge criteria.

## 10. Decisions for future prompts

- CoStar data delivery method, usage permission, schema, and real city coverage.
- Which map provider and whether a working API token exists.
- H3 cell resolution, geographic extent, and performance strategy.
- Which factor scores can be derived from actual available data.
- Property scoring vs region scoring and any explainable default weights.
- First financial decision formula/input set and shared calculation reuse with Tactical.
- Exact shared recommendation/scenario schemas with Asilbek.
- Game art/animation treatment once the core interaction works.
