# RestaurantOS — Shared Game Design Specification

**Version:** 1.0 · HackPrinceton Fall 2026  
**Applies to:** Tactical (Asilbek) + Strategic/Expansion (Rain)  
**Status:** Visual and interaction foundation for future Codex prompts; **not** permission to implement all features at once.  
**Read with:** root `AGENTS.md`, the appropriate feature-level `AGENTS.md`, Tactical/Expansion specifications, and the shared contract proposal.

> **North star:** RestaurantOS should *feel like an approachable restaurant-management / city-building simulator*, but work like a trustworthy business decision tool. **Play with a decision, inspect the evidence, and save a scenario.**

## 1. Final art and technology decision

### Choose **2D**, not true 3D, for the hackathon

**Required MVP approach:**

- **Tactical:** an editable, **top-down 2D restaurant floor plan**, using warm, game-like illustrated SVG objects. Slight 2.5D shadows, bevels, and furniture sprites are welcome; the underlying geometry is **strictly 2D** so owners can place furniture accurately.
- **Strategic:** a real **2D interactive city map** with H3 hexagons, actual property markers when data is available, selected-area highlights, and floating data panels. A city-builder *visual mood* without a simulated 3D city.
- **Shared UI:** subtle tycoon-game HUD, readable panels, playful but restrained interactions, missions, scenario preview, and an optional **Analyst Details** drawer.
- **No Three.js, React Three Fiber, 3D asset pipeline, volumetric maps, animated NPCs, or complex game physics** for the MVP. Do not attempt AI generation of hundreds of consistent 3D models.

Why: 2D scenes are cheaper to produce, easier for Codex to maintain, precise enough for restaurant layout editing, accessible, performant, and easier to integrate with real business data. We can create a convincing aesthetic through lighting, shadows, consistent illustrations, interaction feedback, and typography without real 3D.

**Future option:** an isometric *view-only renderer* of the same 2D floor plan. It must remain optional and read from the same saved plan; do **not** make an isometric projection the source of truth for editing measurements.

### Reference screenshots supplied by the team

- **Tactical reference:** `docs/references/tactical-restaurant-reference.png` — cheerful restaurant-management game: visible room/furniture, warm wood floors, clear table placement, restrained HUD. Borrow the *composition and feel*, not the characters, artwork, text, icons, or proprietary assets.
- **Strategic reference:** `docs/references/strategic-city-reference.png` — city-building view: dense urban context, a highlighted selectable building, a compact information card. Borrow the *map + selection + inspector* interaction; simplify toward real map data and analysis.

The screenshots are **private design references**, not production assets. Do not copy them into the public deployed application, reproduce proprietary art, or commit them to a public repo unless distribution rights are cleared. This Markdown document is self-contained without the screenshots.

## 2. Product principles (non-negotiable)

1. **Game first, credible second-by-second.** Default screens are legible and interactive. A first-time owner should know where to click in under ten seconds.
2. **Everything interactive serves a decision.** No decorative clickable furniture that leads nowhere. Tables open capacity/layout tools; zones open the relevant operational insight; map cells open scored evidence.
3. **No fake business outcomes.** Scores, revenue, customer sentiment, site feasibility and profitability must be based on inputs and calculations or clearly labeled *Demo*/*Assumption*/*Scenario*.
4. **Real layout, simplified visualization.** Restaurant owners can customize their own room, tables, doors and zones. The picture need not match reality photorealistically, but saved object positions and dimensions should be meaningful.
5. **Progressive disclosure.** Simple game-facing results by default; source data, formulas, confidence, assumptions, sensitivity and limitations in **View analysis**.
6. **One visual language.** Tactical and Expansion use identical tokens, typography, component anatomy, HUD, mission formatting, input patterns, feedback states, and interaction verbs.
7. **Reversible experimentation.** `Edit` → `Preview` → `Compare` → `Save scenario`; a simulated change must never silently overwrite the restaurant's saved real layout, observed sales, or property facts.
8. **No account required for initial demo.** Launch a clearly labeled example restaurant and example expansion area before real data is available.

## 3. Look and feel

**Style:** modern cozy management game × professional analytics. Not a neon dashboard, not a cartoon mobile game, not a dense finance terminal. The artwork is charming; the numbers are serious.

### Shared tokens (initial proposals — put in one source of truth)

| Token | Value | Use |
|---|---|---|
| `--ros-forest` | `#183F38` | Main nav, primary action, active state |
| `--ros-forest-hover` | `#24564A` | Hover/focus progression |
| `--ros-canvas` | `#F7F8F5` | App background |
| `--ros-surface` | `#FFFFFF` | Panels and cards |
| `--ros-ink` | `#24332F` | Primary text |
| `--ros-muted` | `#66766F` | Secondary text |
| `--ros-border` | `#E2E8E3` | Dividers and borders |
| `--ros-sage` | `#B7D7C5` | Calm highlights |
| `--ros-amber` | `#F0BD70` | Missions, opportunities |
| `--ros-danger` | `#D97770` | Genuine risk or error, never for merely unselected |
| `--ros-info` | `#648FB5` | Informative context |
| `--ros-wood` | `#C89155` | Tactical floor/furniture illustration only |

- Typography: **Geist or Inter**, one family across both modules. Friendly weight/size hierarchy, not novelty typefaces.
- Spacing: 4/8/12/16/24/32 px scale. Cards: ~12 px radius. Default control height: ~40 px.
- Shadows: restrained. Cards may float subtly above the scene; avoid glossy mobile-game chrome.
- Icons: one Lucide set for UI; custom **simple SVG sprites** for restaurant objects.
- Color should never be the sole carrier of meaning. Every score/status also receives a label, icon or number.
- Use CSS variables + shadcn/ui semantic tokens rather than hardcoding feature-local colors. Map score palette is centralized and distinct from UI semantic status colors.

### Illustrations and 2D sprites

- **Tactical:** simple consistent SVG assets: table (2-top/4-top), chair, booth, counter, kitchen station, doorway, plant, wall, divider, entrance marker. Use one projection (**true top-down**) and one stroke/texture style. Subtle edge shading is allowed.
- **Strategic:** actual map basemap and H3 polygons; not invented isometric buildings. Highlight the *selected* property/cell via a stroke, halo or raised pin, then show its data in a card.
- No mismatched clip art, emoji in place of in-scene assets, or individual AI-generated images of tables with inconsistent camera angles.
- Prefer vector primitives and small manually approved sprite set; if using AI art generation, generate a **single consistent sprite sheet** for all furniture, then review and normalize sizes. Scene must still work if art is replaced by simple shapes.

## 4. Shared screen frame (same across both modes)

```text
┌─────────────────────────────────────────────────────────────────────┐
│ RestaurantOS   [ Manage restaurant | Explore expansion ]   [Demo]  │
├───────────────┬─────────────────────────────────────┬───────────────┤
│ Objectives /  │                                     │ Context panel │
│ short tools   │      INTERACTIVE 2D CANVAS         │ selected item │
│ (collapsible) │      (floor plan OR real map)      │ actions       │
│               │                                     │               │
├───────────────┴─────────────────────────────────────┴───────────────┤
│ [Scenario controls] [Preview / Reset / Save]   [View analysis]      │
└─────────────────────────────────────────────────────────────────────┘
```

- Canvas is the primary focal area, not a tiny picture surrounded by metrics.
- HUD stays slim: restaurant name, mode toggle, **only sourced or explicitly modeled resource indicators**, demo badge. Avoid game levels and coins masquerading as actual cash. If using fun achievements, label them as engagement-only, separate from finances.
- Right inspector has the **same anatomy in both modes**: title → summary → key metrics → relevant action(s) → `View analysis`.
- `View analysis` opens the **same shared drawer pattern** in both modes (desktop side drawer, narrow-screen full-screen sheet).
- Small screens: collapse auxiliary rails; keep core visualization accessible via pan/zoom and a list/table alternative. Do not attempt complicated drag editing on a narrow mobile screen in the MVP.

### Shared interaction grammar

| Action | Tactical | Strategic |
|---|---|---|
| **Select** | Table/room zone | Hexagon/property |
| **Inspect** | Capacity, dimensions, seating mission | Score factors, data coverage, property details |
| **Edit assumption** | Add seats, turns, costs | Rent, budget, site weights |
| **Preview** | Layout/financial outcome | Expansion/financial outcome |
| **Compare** | Existing vs proposed layout/scenario | Site A vs Site B/scenario |
| **Save** | Layout draft / scenario | Property shortlist / scenario |
| **View analysis** | Formula, review excerpts, spatial caveats | Inputs, score breakdown, sources, uncertainties |

The exact visuals may differ, but button labels and semantics must stay consistent.

## 5. Tactical — Asilbek: customizable restaurant management board

### Core visual

Make a cozy, readable **top-down 2D plan** of a restaurant. Warm floor tiles; tables, chairs and fixtures; walls and doorway; small optional decals. **Much simpler than the screenshot:** no NPC crowd simulation, star rewards or dozens of floating game HUD buttons.

The owner can choose **Start from template**, **Blank layout**, or **Edit existing layout**. Allow manual entry of room size and units. A saved plan is a valid restaurant layout *draft*, not a certified architectural drawing.

### Required layout editor (MVP)

1. **Room canvas:** initially rectangular room with configurable width and depth (meters or feet, internally normalize units). Grid and ruler; optional snap-to-grid toggle.
2. **Object palette:** `Table for 2`, `Table for 4`, `Booth`, `Counter`, `Kitchen zone`, `Entrance/door`, `Divider`, `Plant` (some objects can be simple placeholders at first).
3. **Place and move:** click object from palette, place on canvas; click to select; drag to reposition; keyboard arrow nudges; rotate by 90° where applicable; delete; duplicate. Clearly mark the selected object.
4. **Room representation:** perimeter walls; simple interior boundaries/zone overlays; entrance marker. Prefer manual editable objects over claiming to infer the layout from photos.
5. **Undo/reset:** undo the last layout changes; `Reset draft` returns to the last saved baseline.
6. **Save/load:** serialize layout as versioned JSON; show `Unsaved changes`; save to app persistence if available, otherwise local demo state with clear temporary-state messaging.
7. **Summary:** count seats and tables from objects, show **draft capacity**; offer an editable baseline capacity for cases where the plan isn't complete.
8. **Scenario handoff:** `Simulate this layout` runs the shared capacity/finance engine with user-specified occupancy, average check, turns, operating days, contribution margin and renovation cost.

**Not required for MVP:** arbitrary polygon walls, 3D placement, pathfinding NPCs, automatic furniture detection, photorealistic reconstruction, code-compliant floor-plan certification, or real-time collaborative editing.

### Floor-plan model (draft concept; align with shared contract before implementation)

```ts
// Suggested Tactical-local model; production boundary must use Zod.
type LayoutObjectType =
  | 'table_2' | 'table_4' | 'booth' | 'counter'
  | 'kitchen_zone' | 'door' | 'divider' | 'plant';

type LayoutObject = {
  id: string;
  type: LayoutObjectType;
  x: number;             // normalized real-world units from room origin
  y: number;
  width: number;
  depth: number;
  rotation: 0 | 90 | 180 | 270;
  seats?: number;         // only for seating furniture
};

type RestaurantLayout = {
  schemaVersion: 1;
  restaurantId: string;
  name: string;
  unit: 'm';              // internal representation; UI may convert feet
  room: { width: number; depth: number };
  objects: LayoutObject[];
  updatedAt: string;
};
```

**Editor geometry rules:** drag math converts viewport coordinates to room units; snapping applies in room units; object positions stay inside room bounds; rotations and dimensions must not create invalid geometry. Flag obvious furniture overlaps as *warnings*. Do not claim full evacuation/accessibility/fire-code validation. Paths and clearance are complex and jurisdiction-dependent.

**Optional image import:** owner may upload a floor-plan image as a **locked, scaled background reference**, then manually trace/place objects. Not an auto-measured conversion. The image is private user content; obtain appropriate permissions and never commit it as a fixture.

### Tactical game loop

```text
Import reviews / restaurant inputs
       ↓
AI spots a grounded issue → creates a “Mission”
       ↓
Owner clicks relevant restaurant object / mission
       ↓
Adjust room layout or operating assumptions
       ↓
Preview a before-vs-after *modeled* impact
       ↓
Save a proposed scenario → inspect evidence / assumptions
```

**Example mission:** “Could six additional seats justify the renovation?” Open room editor preconfigured with a `+6 seat` draft; owner places tables, specifies constraints, then compares projected monthly contribution and simple payback. If the room cannot physically fit the objects without overlaps, do not imply they were placed successfully.

**Do not call customer mood a measured score** unless it is derived from a defined analysis with visible sources. Use `Review themes` rather than an unexplained 83% “happiness” gauge.

### Tactical priority order

1. Working editable top-down room with add/move/rotate/save.
2. One useful AI-generated mission from permitted review data.
3. Scenario calculation and before/after outcome panel.
4. Analyst Details drawer.
5. Decorative sprites/polish after actual interaction works.

## 6. Strategic — Rain: data-first city expansion explorer

### Core visual

Use the supplied city-building image as **interaction reference**, not a mandate to render the city in 3D. Build a **2D real basemap** with:

- H3 hexagon fill overlay expressing a **documented site/area suitability score**, not decorative red/green heat.
- Actual available property markers **only when verified source records exist**.
- Selected hexagon or property highlighted with a clear boundary/halo.
- A right-side inspector showing 3–5 meaningful metrics and a short AI explanation tied to sources.
- Simple filters (city, budget, space requirements, factors); optional factor-weight editor in Analyst Details.

### Two selection levels

**Area selected (hex):** area's factors, coverage, comparison to nearby cells, notable limitations, and `See properties`. A hex is **not** a parcel or a neighborhood boundary.

**Property selected (marker):** listing's actual attributes, asking rent in correct units, dimensions, verified conditions and provenance, `Compare`, `Simulate opening here`. A property is **not** interchangeable with its hexagon's area score.

### Strategic game loop

```text
Choose city and business requirements
       ↓
Explore scored hexes (“Scout area”)
       ↓
Select and inspect actual property markers
       ↓
Compare 2 properties / adjust assumptions
       ↓
Preview opening-cost or break-even scenario
       ↓
Shortlist / save scenario / inspect underlying evidence
```

**Game element:** area scouting, subtle reveal animations, milestones like “Compared 2 sites.” Do not award “territory capture” or suggest a property is acquired by clicking `Save`.

**Financial semantics:** property score ≠ probability of success, estimated rent ≠ total occupancy cost, and a model's break-even sales threshold ≠ predicted actual revenue. Unknown market demand should be labeled unknown.

### Strategic priority order

1. Interactive 2D basemap + H3 overlays + selected-area inspector.
2. Property markers with verified demo/source labels and a clear area/property distinction.
3. Side-by-side comparison + financial scenario.
4. Analyst Details with score decomposition, provenance, coverage, uncertainty.
5. Polish/optional game progress, never before valid data semantics.

## 7. Shared components — build once

Use feature-neutral component names and props; shared components must not import feature internals.

| Component | Responsibility |
|---|---|
| `GameShell` | Nav, top HUD, responsive rails, mode switch |
| `ModeSwitch` | Manage / Explore |
| `ResourceStat` | Labeled observed/derived/assumed/demo indicators |
| `MissionCard` | Finding, objective, evidence badge, CTA |
| `SceneInspector` | Selected object/area/property summary and actions |
| `ScenarioToolbar` | Preview, reset, compare, save |
| `OutcomeCompare` | Baseline vs scenario, units, modeled delta |
| `EvidenceBadge` | Source, date and demo/assumption markers |
| `AnalystDrawer` | Inputs, source list, formulas, coverage and limitations |
| `GameToast` | Non-intrusive confirmations and warnings |
| `LoadingState` / `EmptyState` | Consistent system feedback |

Suggested folders:

```text
src/
  components/game/              # shared; coordinated ownership
  features/tactical/            # Asilbek only
    components/floor-plan/
    schemas/
  features/expansion/           # Rain only
    components/map/
    schemas/
  lib/decision/                 # shared deterministic calculations
  lib/ai/                       # shared model adapters / prompt rules
  schemas/                      # agreed shared business contracts

docs/GAME_DESIGN.md             # this document
```

### Shared states (every feature)

- `loading` — progress, no fabricated results.
- `empty` — inviting instructions to import or use clearly labeled demo fixture.
- `selected` — highlight and inspector.
- `editing` — visible unsaved changes / draft marker.
- `simulating` — short predictable pending state; no fake monetary animation before result exists.
- `success` — displayed deterministic output plus source/assumption badge.
- `error` — explanation and retry without losing user edits.

## 8. Motion and feedback

Make interfaces feel alive without suggesting unrealistic simulation precision.

- Hover/select: **120–160 ms** border/glow or 2px lift.
- Panel/inspector transitions: **180–240 ms** ease-out.
- Placing furniture: 120–200 ms snap feedback; no oversized bounce.
- Map camera: smooth pan/zoom; maintain selection; avoid forced flyovers.
- Scenario result: animate *presentation* of the computed result, not the underlying arithmetic; never fabricate intermediate values.
- Respect `prefers-reduced-motion`. Tooltips and all actions must work by keyboard or in list alternatives where practical.
- Sound effects **off by default**; no audio dependency for core interactions.

## 9. AI design rules

AI is **ambient decision intelligence**, not the default screen:

1. **Discover:** classify review themes and extract supported operational opportunities; preserve evidence references.
2. **Frame:** suggest missions and explain why each matters; do not infer verified physical constraints from an image alone.
3. **Configure:** suggest scenario inputs but label unknowns and allow editing.
4. **Explain:** summarize deterministic outcomes and tradeoffs with citations to local data/source IDs.
5. **Optional companion:** contextual assistant knows selected layout object or selected map property, but uses explicit tools and authorized data only.

Model-generated prose is never a source of numeric truth. Label every datum as `observed`, `derived`, `assumed`, `simulated`, or `unavailable`; show `Demo` for fixture data. Changes in game visuals reflect **hypothetical scenario state** until the user saves a draft; never imply a physical upgrade occurred.

## 10. Team ownership and Codex instructions

**Asilbek owns:** Tactical floor-plan editor, operations scene, Tactical missions, Tactical scenarios.  
**Rain owns:** Strategic map, hex layers, site/property selection, site scoring, expansion scenarios.  
**Shared work:** root visual tokens, `GameShell`, components in `src/components/game`, business contracts, shared finance helpers. Agree on shared interface changes before implementation.

For every UI task, Codex must:

1. Read root `AGENTS.md`, this `GAME_DESIGN.md`, the relevant nested `AGENTS.md`, and the affected feature spec.
2. Stay **2D**. Do not add a 3D library or generate 3D models without an explicit new instruction.
3. Reuse shared tokens and components. No Tactical-only or Expansion-only version of mission/HUD/analysis patterns.
4. Implement the **minimum functional interaction** before decorative polish.
5. Clearly distinguish actual data, example data, assumptions and simulations.
6. Avoid scope creep or unrelated shared-file rewrites. Do not touch another developer's domain.
7. Test with a repeatable fixture and verify at least one end-to-end interaction in the browser.
8. At completion report UI behavior, changed files, validation, and unimplemented assumptions.

### Suggested implementation technology

- **Core:** Next.js, TypeScript, Tailwind, shadcn/ui, Zod.
- **Tactical canvas:** **React SVG** (`viewBox`, polygons/rects/symbols, pointer events, room-unit coordinate conversion). Keeps initial editor simple and AI-dev-friendly. Avoid third-party canvas/game engines until limitations are demonstrated. Render selection hitboxes separate from art.
- **Strategic map:** Mapbox GL JS *or* MapLibre GL JS based on credentials/terms, plus `h3-js` to prepare GeoJSON hex polygons. Centralize overlay palette and scoring definitions.
- **Animation:** CSS transitions and/or Motion when already installed. Avoid adding a library for one animation.
- **Data:** existing normalized backend/provider adapters; fixture data must have visible demo badges.

## 11. Acceptance tests / visual QA

### Tactical

- Load blank layout and supplied demo layout; place, select, drag, rotate, delete and save a table.
- Changing table positions changes the **rendered** plan and draft object data; reloading returns same saved layout.
- Room/unit conversion does not distort actual object geometry.
- Table count and seat count are calculated from furniture objects, not decorative sprites.
- Out-of-bounds/obvious overlap placements produce warnings; no false compliance certification.
- Running an upgrade scenario compares baseline and hypothetical outcomes without altering saved layout automatically.
- `View analysis` shows input assumptions and sources.

### Strategic

- Load actual map and a bounded fixture area; each colored hex is tied to a documented score and coverage.
- Select a hex to see area data; select a property marker to see **property-specific** data.
- Adjust a supported filter/weight and observe an explainable, deterministic change.
- Compare two properties with normalized cost units; show unavailable fields rather than inferred values.
- `View analysis` shows score factors, sources, missing data, calculation version and caveats.

### Cross-module

- The same `GameShell`, fonts, component radii, mission format, evidence badges and drawer appear in both modules.
- Switching modes preserves the current restaurant identity.
- At least one Tactical mission can hand off compatible constraints (e.g. desired seats or space) to Expansion without importing Expansion internals into Tactical.
- All UI renders acceptably with narrow browser widths and reduced motion enabled.

## 12. HackPrinceton tracks and demo proof

**Main track: Business & Enterprise.** The play-like interface must still showcase a practical business workflow: data → mission → action → transparent simulation → decision.

| Target | Visible proof in product | Owner | Conditions / caveats |
|---|---|---|---|
| **Business & Enterprise** | End-to-end owner decision workflow | Both | Real utility beyond cosmetic game mechanics |
| **Peri Forward Deployed** | Mission reflecting findings from a real restaurant consultation | Other teammates + Tactical | Include permission/evidence; dev work must not depend on outreach completion |
| **CoStar** | Source-backed Houston/LA property comparison in strategy map | Rain | Actual authorized dataset/API, not merely CoStar-inspired graphics |
| **Capital One Nessie** | Sandbox-connected cash-flow scenario in simulation | Tactical/shared | Working Nessie calls; clearly state transactions are simulated |
| **Amazon AI** | AI review-to-mission workflow and explanations | Tactical/shared | Verify precise sponsor challenge and required services |
| **Arlequin** | Observed graph/network patterns inform missions | Optional | Sentiment analysis alone is insufficient for a network-analysis challenge |
| **Photon** | Advisor reachable from a messaging channel | Optional | Working messaging integration required |

These are **candidate alignments**, not assertions of prize eligibility. Check official current track rules before submission.

### Two-minute demo route

1. **Manage:** launch a simple 2D restaurant; select a table, show one data-backed mission.
2. **Experiment:** add/adjust tables and run a seat/finance scenario; show projected before/after.
3. **Explore:** transition to the actual expansion map; select a hex and a property.
4. **Decide:** compare a site or opening scenario; open **View analysis** briefly to show sources, model inputs and limitations.
5. **Close:** articulate which sponsor integrations are live versus fixture-only and explain the real restaurant business value.

## 13. Priorities if time becomes constrained

**P0** Shared app shell + tokens, one Tactical floor-plan edit loop, one Strategic hex selection loop, correct state labels.  
**P1** Tactical scenario, Expansion comparison, Analyst Details.  
**P2** AI mission generation, contextual explanations, meaningful cross-module handoff.  
**P3** Decorative sprites, advanced animations, sprite shadows, extra furnishings, companion chatbot, optional isometric preview.

**Do not trade a functional 2D editor or an explainable real map for a prettier static mockup.**

---

## Decision log

- **2026-11-14:** Choose **2D MVP**; Tactical true top-down room editor with soft isometric aesthetic, Strategic 2D real map with simplified city-builder visual framing. Advanced analysis hidden by default but one click away.
- This document describes the intended experience. It does not override future explicit feature-level user prompts or the agreed shared data schemas.
