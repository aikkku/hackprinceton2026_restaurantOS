# Sprout design rollout

Updated November 15, 2026. **Phases 1–4 are implemented; HR is next.** This is a presentation and navigation redesign, not a replacement of the product with the smaller reference prototype.

**Presentation target:** laptop screens. Per the latest user direction, dedicated mobile layout/navigation work is deferred. Existing narrow-screen fallbacks are retained, but new design reviews and new tests target laptop dimensions.

## Direction and boundaries

The supplied `Build Sprout Restaurant Advisor` app and `HackPrinceton F26-1.pdf` inform the visual direction: cream canvas, forest green primary actions, sage surfaces, warm orange accents, friendly typography, rounded cards, clear progress, and a calm conversational tone. Their sample content, hardcoded advice, simulated analysis and reduced feature set are **not implementation requirements**.

Use the `sprout.` brand and “Small business. Bigger possibilities.” in the new experience. Keep RestaurantOS identifiers and existing URLs stable. AI controls and results remain purple. Status colors retain their meanings: red overlap/critical, yellow caution, green healthy. Supply remains free of AI. Every financial number still comes from deterministic code. No design change may conceal evidence, units, source labels, limitations or failure states.

Rain's current `frontend/sprout/` already implements much of the supplied visual language for Expansion. Coordinate token and navigation changes with Rain; do not replace his pages or edit his module during Tactical work.

## Step-by-step sequence

| Step | Deliverable | Status / review gate |
| --- | --- | --- |
| 1 | Welcome and onboarding, conditional Demo mode, honest upload preview, connected mock restaurant | Implemented in this change; review `/` and `/onboarding` |
| 2 | Reuse Sprout tokens and redesign the persistent Tactical shell for laptops | Implemented; all six destinations and unsaved-work protection retained |
| 3 | Floor Plan | Implemented; detailed room and furniture materials, larger laptop scene, existing editing behavior retained |
| 4 | Customer Reviews and Social Media | Implemented; compact filters, rating/theme rail, review cards and consistent network/evidence surfaces |
| 5 | HR | Review team, schedule, hiring and AI evidence |
| 6 | Supply Management | Review stock/expiration filtering without adding AI |
| 7 | Financial Intelligence | Review Report, Price playground, Cash calendar and Nessie independently |
| 8 | AI Assistant and cross-page evidence presentation | Review failure behavior and purple differentiation |
| 9 | Profile/data-source presentation and deferred photo page | Preserve existing routes and current capabilities; real ingestion is separate scope |
| 10 | Coordinate Expansion consistency with Rain | Visual audit and proposed changes, then implementation by agreement |
| 11 | Whole-platform laptop, accessibility and regression pass | Release only after every preserved workflow passes |

Complete and review one page at a time. A page is done only when its design, current functionality, keyboard use, laptop layout, source disclosure and error states all work. Do not turn a working panel into a decorative screenshot.

## 1. Onboarding — implemented

### Journey

1. `/` introduces Sprout with a storefront illustration, a clear start action and a direct link to the existing workspace. There is no pretend login.
2. `/onboarding` asks for restaurant name, location and a goal. Name/location are optional for the demo. The goal offers current operations, expansion or both.
3. The information step offers four file selectors/drop areas: menu, space, sales and other material. Files can be removed individually. A small **Demo** checkbox is checked by default.
4. With Demo checked, setup sends **only `{ "demo": true }`**. Entered business details, filenames and file bytes are not sent. Arbitrary selected file contents cannot change the restaurant. No file parsing or AI analysis is claimed.
5. The server reads the same validated mock dataset selected by `TACTICAL_DATA_SOURCE` as the existing Tactical pages. The ready screen displays its actual name and record counts, then links to Floor Plan, Finance or Reviews. Expansion/both goals additionally show a link to Rain's separate workspace.
6. `/register` redirects to onboarding. Existing `/tactical/*` and `/expansion` links still work directly; onboarding is not a new access gate.

### Data behavior

- **Demo checked:** use the existing synthetic restaurant in the local fixture or configured MongoDB document. This opens existing work; it does not reset, clone, seed, overwrite or rename it. Previously saved browser drafts and MongoDB versions remain intact.
- **Demo unchecked:** setup is visibly unavailable. Explain that document processing is not implemented; disable completion. Never silently substitute mock data when the user opted out. Selected files remain local, even in this state.
- The API strictly rejects extra fields, non-demo setup, oversized bodies and cross-origin requests. It is read-only and does not grant AI/bank access.
- The completion summary is derived from the current server-selected dataset, not hardcoded independent counts. MongoDB failures produce a retryable error, not an undisclosed switch to another source.
- Basic answers, goal, checkbox and current editable step are kept in this tab's versioned `sessionStorage`. Files and their names are only held in React state. Refresh requires reselecting files and rechecking the dataset before reaching Ready. Corrupt/blocked browser storage does not block use.
- Upload preview has a 20-file display limit; it does not read contents, so it does not pretend to validate document types.
- This is demo onboarding, **not production registration**. No accounts, real ingestion, shared profile handoff, private workspace creation or personal upload storage was introduced.

### Code map

| Location | Responsibility |
| --- | --- |
| `src/app/page.tsx`, `src/app/onboarding/page.tsx`, `src/app/register/page.tsx` | Thin public routes |
| `src/features/tactical/frontend/components/onboarding/` | Welcome, wizard and illustrative SVG; shared brand/tokens live in adjacent `sprout/` |
| `src/features/tactical/frontend/onboarding-store.ts` | Hydration-safe browser draft subscription and versioned persistence |
| `src/features/tactical/domain/onboarding.ts` | Draft/request/response schemas and derived summary |
| `src/features/tactical/backend/onboarding.ts` | Read-only validated completion handler |
| `src/app/api/tactical/onboarding/route.ts` | POST adapter using the existing dataset loader |
| `src/features/tactical/onboarding.test.ts` | Isolation, validation, failures and counts |
| `src/features/tactical/frontend/e2e/onboarding.spec.ts` | User journey, ignored uploads, checkbox, retry, reload and narrow-screen checks |

## 2. Design foundation and persistent shell — implemented

### Establish the visual rules

| Element | Direction | Important constraint |
| --- | --- | --- |
| Canvas | Warm cream `#FAF8F4` | Avoid applying global overrides that break Expansion or SVG colors |
| Primary | Forest `#183B35` | Green is navigation/action identity; not every green element means a healthy metric |
| Supporting surfaces | Sage `#E8EEE8`, white detail cards | Use whitespace and borders before adding shadows |
| Accent | Orange `#E99A53` | Decorative emphasis; sufficiently dark text required on orange |
| Text | `#262923` with a readable muted tone | Keep labels readable; do not copy the reference's tiniest text sizes into dense data views |
| AI | Purple foreground, pale lavender surface, AI label/icon | Distinct from normal analytics and status colors |
| Status | Existing good/caution/error semantics | Icons or labels alongside color; preserve hover/focus explanations |
| Typography | Current bundled Geist body; generous, friendly headings | No remote font dependency required. Coordinate any later font change with Rain |
| Geometry | 12–16px inputs/cards; larger 20–26px containers; pill primary actions | Dense editing controls may remain compact rectangles |
| Spacing | 4/8/12/16/24/32/48px scale | Allocate space to the primary task, not decorative blank panels |
| Motion | Short, subtle state transitions | Respect reduced motion; no artificial waiting/analysis animations |

Onboarding and Tactical now share `frontend/components/sprout/tokens.css` under `.sprout-theme`, plus one reusable brand primitive. The shell maps existing Tactical `--ros-*` colors to that palette. Rain's `--sx-*` tokens and shared root styles are unchanged; cross-domain adoption still requires coordination.

### Shell implementation

1. Inventory the existing persistent mount behavior: floor edits, selected furniture, review state, finance tabs and AI access must survive section changes as they do today.
2. Introduce a compact Sprout header, current restaurant/source indicator and explicit Manage / Expansion switch.
3. Use a persistent laptop sidebar for all six sections, with compact spacing on shorter laptop windows. A dedicated phone menu is deferred. No lost destinations, dead icons or hidden source states.
4. Keep one page title and contextual action area per view. Move repeated explanatory text into relevant disclosures, not out of the product.
5. Standardize buttons, field labels, status badges, cards, tabs, evidence drawers, loading, retry and empty states.
6. Preserve the unsaved-layout confirmation when leaving Tactical. Add an unobtrusive way back to setup without introducing an automatic reset.

Acceptance: all current links and saves work; active navigation is announced; source/access disclosures close with Escape and return focus; labels and actions fit 1280 × 720 and 1440 × 900 laptop screens; AI unlocking stays protected and Supply does not initialize AI. See [shell implementation](SPROUT_SHELL.md).

## 3. Floor Plan — implemented

**Layout:** an expansive cream/sage scene inside a quiet frame. Slim top row with furniture search, saved-version dropdown and Save. Icon-only controls remain on the map's lower-right. Properties appear only when relevant; The Seating Problem stays a small expandable purple area below the map.

**Preserve:** free movement, selection, dragging, keyboard nudging/rotation/duplicate/delete, undo/redo/reset, smart seating resize, cashier stand, room bounds, units internally, version save/reopen, local persistence, protected cloud saves and AI access to coordinates and versions. No grid snapping, zoom controls, kitchen zone, old saved-plans section, backup UI, movement button pad or scenario page should return.

**Implement in order:** restyle canvas frame and furniture materials; consolidate top controls; restyle selection/properties; refine warnings; style seating analysis/evidence; laptop toolbar and keyboard pass.

**Gate:** overlap is red and clearance caution yellow, both with discoverable details; resize changes seats; saved plans restore coordinates; AI failure stays “Something is wrong”; controls do not cover important furniture or escape the viewport.

The scene now uses a warm timber floor with staggered joints/grain, layered walls and skirting, subtle daylight and soft shadows. Furniture has upholstered cushions, stitching, beveled wood tops, place settings, stone counters, detailed plants and a recognizable cashier register. Palette previews share the same art. Laptop canvas height follows the available screen height; controls and disclosures remain compact. `floor-scene-art.tsx`/`.css` isolate decoration from gestures and domain geometry. No new fixtures, seats or database records are generated by decorative artwork.

Validation: 272 unit tests passed with one existing skip, and all 80 Tactical browser checks passed across Chromium and Firefox. Typecheck, lint and production build passed, with existing Expansion warnings. Browser checks retain red overlap previews, resize-driven chair counts, keyboard editing, undo, version reload and AI preview behavior. Manual review targets the laptop scene; dedicated mobile design remains deferred.

## 4. Customer Reviews & Social Media — implemented

**Layout:** calm two-column review workspace with a bounded, independently scrollable theme rail and review feed. Keep search/filters visible without making the page a wall of controls. Use subnavigation for Reviews, Relationship network and Content & connectivity; retain every current graph/detail workflow.

**Preserve:** search, ratings, sentiment/theme/high-priority filtering, incremental saved AI classifications, reason tooltips, source evidence, editable/copyable purple AI replies, disabled one-click Reply, imports, review-to-seating navigation. Preserve relationship filters, SVG and accessible tables, metrics, save/reopen/export, source-linked propagation paths, timelines, public/permissioned import and AI hypotheses.

**Implement in order:** review card hierarchy; scroll regions; filters and selection; reply composer; graph panel/table styling; evidence drawers and narrow layouts.

**Gate:** no reappearance of “Why this priority?” or “Draft only · posting unavailable” copy. Reasons remain available by hover/focus. Long themes and quotes scroll/wrap. Reply stays clearly disabled rather than implying a published response. Data-source and hypothesis labels remain visible.

Implemented a three-view navigation bar with announced selection, compact saved-classification status, sage rating card, independent purple theme rail, single-row laptop filters and wider white review cards. Stars summarize source ratings; no reviewer identities or new reviews were fabricated. Source IDs, reason tooltips, copy/edit/regenerate and the disabled Reply control remain available. Review and source-message scroll regions are keyboard-focusable.

The relationship explorer places filters and metrics beside its graph, with import/permission details in a disclosure. The content pipeline shares the same cards, source badges, step indicators, tables and evidence surfaces. All selectors remain mounted so switching views preserves filters and in-progress state. Styles are scoped to Customer Reviews; Finance's sponsor panels and Expansion are unchanged. No backend, schema or database migration was needed.

Verification: the initial full regression run passed all 80 existing checks; the added laptop navigation/keyboard check had a test-selector mismatch, corrected to match the existing label. All 30 focused review, AI, social and sponsor checks then passed across Chromium/Firefox, including both new laptop cases. Unit tests: 272 passed, one existing skipped. Typecheck, lint and production build passed with existing Expansion warnings. Browser review loaded 30 saved MongoDB classifications and nine high-priority records and inspected all three views. HR is the next page to redesign.

## 5. HR

**Layout:** compact AI status row, Team / Schedule / Hire employees subnavigation. Team cards show essential details with expandable secondary fields. Keep the schedule a real dated calendar. Hiring uses a focused role/draft panel.

**Preserve:** seven-person roster, weekly hours, dated shifts, role/station evidence, green/yellow/red AI health cards with explanations, current demand/order/menu/review context, role dropdown, editable hiring suggestions and copy, disabled Indeed posting. Do not suggest that a visual calendar supports schedule editing unless that capability is separately built.

**Implement in order:** status hierarchy and purple AI identity; condensed team; weekly calendar and existing agenda presentation; editable hiring draft; evidence and failure states.

**Gate:** every shift remains readable, status explanations work by keyboard/touch, the selected role drives suggestions, edits stay editable, and no mock employment action is represented as a real posting.

## 6. Supply Management

**Layout:** generous inventory cards or aligned rows, clear quantity and expiration, small filter bar, expandable cost/delivery details. Distinguish unknown expiration from expired stock.

**Preserve:** stock/category/search filters, quantities/units/thresholds, expiration, cost and delivery details. Supplier pages stay removed. **No AI controls, AI network calls, AI summaries or purple recommendation cards.**

**Implement in order:** filter bar; item spacing and typography; expiration/status badges; detail disclosure; laptop column spacing.

**Gate:** full inventory remains accessible; long names fit; quantities retain units; expiration states remain tied to their dates; hiding details does not remove data feeding cash forecasts.

## 7. Financial Intelligence

Use the existing four-part structure, with a consistent header and subnavigation. Keep the report's narrative hierarchy while bringing its colors, borders and controls into Sprout.

### Report

Retain period/source assumptions, all item sales and costs, purple AI observations, evidence, comparable prices, delivery contribution, slow sellers, recommendations, full menu table, and ledger access. Restyle comparisons and summaries; place formulas and limitations in accessible disclosures. Never replace computed numbers with decorative chart values.

### Price playground

Retain all editable raises, demand-loss assumptions, suggested changes/reset, per-item results, total outcome and break-even calculations. Preserve state across tab changes. Use readable financial typography and a readable laptop item editor. Persistence across reload is still future functionality, not promised by the redesign.

### Cash calendar

Retain the 90-day deterministic forecast, calendar/agenda, next/previous month, opening/lowest/cushion indicators, reserve colors, selected-day details and source links, obligation editor, payout/payroll assumptions, manual entries, bill matching, save/reopen, local versus MongoDB storage and explicit Nessie refresh. Keep the accessible mobile day sheet and Escape behavior.

Design the summary, date navigation and day detail as a coherent workspace. Do not obscure expenses, negative balances or stale-source warnings for a cleaner screenshot. No actual payments are triggered.

### Nessie Sandbox and ledger

Retain explicit sandbox versus local sample source, protected reads, deposits/withdrawals, account balance, editable scenarios, downloads and the independent historical ledger. Keep sandbox provenance visible. Cash-calendar live bill support must not be presented as real observed bills when the account has none.

**Gate for all four:** existing calculation tests remain unchanged and pass; column order/labels clarify periods and units; no currency/percentage truncation; errors leave existing results intact; source and assumptions are always reachable.

## 8. AI Assistant and common evidence

**Layout:** welcoming prompts and a focused conversation/results panel using purple AI accents. Keep evidence close to each finding. Reuse a common drawer pattern across Floor Plan, Reviews, HR and Finance.

**Preserve:** protected server-side Gemini calls, current dataset/layout-version context, validated structured findings, source IDs, uncertainty and limitations, and exact generic failure copy. Do not imply durable chat history or multi-turn context while the assistant remains single-turn.

**Gate:** output is visually distinct; evidence links resolve; no private provider error leaks; an unavailable model does not produce a fabricated answer. Empty, locked, generating, successful and failed states all receive a design.

## 9. Profile, information and photo compatibility

The design reference contains a richer profile screen, but it is not permission to invent working imports. Plan a source overview that explains which data is demo, imported, derived or unavailable and links to existing capabilities. Real document processing, OCR, menu extraction, live review import, POS ingestion, accounts and private workspace creation need separate implementation plans.

Keep `/tactical/analyze` working as the existing photo editor; a visual cleanup should preserve review/correction behavior. The user's earlier request deferred new photo work, so do not expand it as part of this rollout. `/tactical/scenarios` and `/tactical/decisions` remain compatibility redirects.

## 10. Expansion coordination

Review with Rain: header/wordmark, spacing, buttons, source labels, statuses, AI purple treatment and small-screen navigation. His current Sprout home, profile, needs, places/map, property details, compare, costs, plan, search and advisor views retain their complete behavior and live data adapters.

Do not wire Tactical onboarding answers into Expansion's profile implicitly. Today the link opens a separate workspace. A genuine shared restaurant handoff requires an agreed schema, explicit provenance, version mapping and tests on both sides. Log proposals in the shared-contract document before implementation.

## 11. Release checklist and test strategy

For each page:

- Record the current actions, inputs, results, saved state, evidence and data sources before editing.
- Compare before/after functionality; visual simplification may reorganize information but may not delete it.
- Run focused browser flows in Chromium and Firefox; run the complete Tactical suite at integration milestones.
- Check 1280 × 720 and 1440 × 900 laptops plus a larger presentation display. Tables may scroll within named regions; the whole page must not overflow. Dedicated phone/tablet redesign is deferred.
- Check keyboard-only use, focus return, labels, disabled controls, status announcements, contrast, touch access to hover details and reduced motion.
- Exercise loading, empty, provider failure, invalid input, blocked browser storage and MongoDB outage behavior.
- Run lint, typecheck, all unit tests and production build before delivery. Keep known unrelated warnings explicitly separated.
- Inspect actual screenshots. Update `PAGES.md`, `STRUCTURE.md`, walkthroughs and implementation status as each phase ships.

## Database and AI implications

This design phase does not introduce another store or rewrite existing records. Existing `tactical_datasets`, floor versions, review/HR artifacts, bank snapshots and cash forecasts keep their current ownership and schemas. Onboarding completion only reads the configured synthetic dataset; basic draft answers stay in the browser tab. AI/bank access codes still protect their existing endpoints.

The separate [Connected data and AI plan](CONNECTED_DATA_AND_AI_PLAN.md) remains the architectural proposal for centralized context, durable AI artifacts and shared decisions. Integrate its phases explicitly later; do not claim the redesign alone implemented them.

## Phase 1 verification

- Unit tests: **272 passed, 1 existing skipped** across the repository, including four onboarding tests.
- Tactical browser suite: **74 passed** in Chromium and Firefox, including eight onboarding checks across both browsers.
- Typecheck and production build passed. Lint has no errors and one existing Expansion warning; the build retains existing Expansion filesystem-tracing warnings.
- Browser checks cover ignored arbitrary uploads, entered-name isolation, unchecked Demo, ready-to-workspace navigation, reload, file removal, generic retry, keyboard focus, reduced motion, blocked storage and 320px/390px widths.
- Manual visual review covered welcome, setup, upload/opt-out and ready states. The live MongoDB-backed flow opened Juniper Table with 24 menu items, 30 reviews, 7 employees and 37 inventory items. Setup did not write to MongoDB.

## Field note

Demo onboarding is safest and most consistent when it reads the exact loader used by the workspace and submits only an explicit demo flag. Keep file bytes and entered business data out of that request, derive the summary from the returned dataset, and never mutate shared saved work during setup. A `useSyncExternalStore` subscription lets tab-local drafts restore without server/client hydration differences. ChatOverflow was unavailable in this environment (`command not found`), so this note is recorded locally rather than published.
