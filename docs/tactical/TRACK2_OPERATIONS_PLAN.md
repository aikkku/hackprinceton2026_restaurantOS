# Track 2 → operations: implementation plan (steps 1, 3, 4)

Goal: turn **Reviews → Content & connectivity** from an analysis view into an operating tool. Customer conversations tell the owner **what to fix first, for which customers, and where in Tactical to fix it**.

Builds on the existing pipeline in [ARLEQUIN_TRACK2.md](ARLEQUIN_TRACK2.md). Nothing here changes Expansion or shared contracts.

## Demo story this plan is built to produce

> "Wait times come up most, but only among weekend dine-in regulars. Soggy takeaway is mentioned less, yet it has reached four customer groups — and it took off after vented takeaway boxes dropped below threshold. Fix packaging first: Supply → Vented takeaway boxes (22 of 60)."

The existing fixture data already supports this:

- **Supply:** `i34` Vented takeaway boxes, 22 on hand vs. a threshold of 60, last ordered 2026-11-13, next delivery 2026-11-18.
- **HR:** demand peaks Fri 11-13 (52 peak orders) and Sat 11-14 (61), with only three floor shifts. Sunday 11-15 has a single floor shift. `workforceMetrics()` in `domain/hr.ts` already computes `peakOrdersPerFloorHour` for each day.
- **Menu:** Sweet Potato Fries, House Burger and Crispy Chicken Sandwich, with delivery prices and packaging cost per dish.

The social conversation is the one piece that has to be rewritten (see step 0).

---

## Step 0 — Rewrite the demo conversation (prerequisite) · ✅ done

The old `demo-social.json` had 24 messages, all posted within 23 minutes on one day. It couldn't show spread over time and didn't line up with the operations dates.

Result: 40 messages from 17 actors. The graph partition recovers four groups (`abcde`, `fghi`, `jklm`, `nopq`) with modularity 0.632. Packaging stays in 1 group before Nov 13, then reaches all 4 by Nov 15. This is checked in `social.test.ts`.

**New `frontend/data/demo-social.json`** (still `provenance: "synthetic"`, within the 40-actor / 40-message limits):

- **~18 actors in about four intended groups:** weekend dine-in regulars, delivery/takeaway customers, students, weekday lunch crowd. Groups must come out of the reply/repost structure. Don't label them in the data.
- **~40 messages across 2026-11-01 → 11-15**, so they overlap the HR week (11-09 → 11-15).
- **Wait time:** ~14 messages, almost all replies *inside* the regulars group, spread evenly over the period.
- **Takeaway packaging (soggy fries, crushed boxes):** ~8 messages. One or two before 11-08, then they rise. Reposts cross into three or four groups after the boxes run low.
- **Pricing/fees:** ~6 messages, mostly mixed or neutral, two groups.
- Keep texts plain and unambiguous, so live Gemini labels them consistently.

**New `frontend/data/demo-social-semantics.json`** is a recorded semantics result for that dataset, checked with `validateSemantics()`. It's for unit and e2e tests only. The UI never uses it as a fallback (that keeps the existing "no fabricated AI results" rule).

**Done when:** the fixture parses, `analyzeSocial()` finds 3–5 groups, and the asserts in step 1 pass.

---

## Step 1 — Rank issues by reach, not just mention count · ✅ done

Implemented in `domain/social-operations.ts` (`issueSignals`, `rankIssues`, `issueReason`, `rankingHeadline`) and the **Fix first** panel in `social-pipeline.tsx`. Covered by `social-operations.test.ts` and the "Fix first" browser test in `e2e/social.spec.ts`.

**New pure module `domain/social-operations.ts`** (`social.ts` is already dense). It takes `analyzeSocial(dataset, semantics)` output plus the annotations and computes this for each topic:

| Signal | Layer | Definition |
|---|---|---|
| `mentions` | content | messages labeled with the topic |
| `negativeShare` | content | share of those messages with tone `negative` or `mixed` |
| `groupsReached` | connectivity | groups with ≥1 topic message ÷ total groups |
| `crossGroupLinks` | both | existing same-topic reply/repost links that cross groups |
| `pickedUp` | connectivity | replies plus reposts that the topic's messages received from *other* actors |
| `newGroupsLast7d` | both + time | groups whose first topic message falls in the last 7 days of the sample |

**Three rankings, shown side by side.** Together they make a small ablation study:

1. **Content only:** negative mentions (`mentions × negativeShare`). This is what a normal review dashboard does.
2. **Connectivity only:** groups reached, then `crossGroupLinks` as the tie-break (ignores tone and volume).
3. **Combined ("Fix first"):** negative mentions × groups reached, then `crossGroupLinks` as the tie-break.

`pickedUp` and `newGroupsLast7d` are shown as supporting signals but are not part of any score. Counting internal replies would mostly repeat the mention count.

The formulas were fixed before the step 0 fixture was written; don't tune them to force the story. Show them in the UI under a disclosure. If the public Hacker News sample ranks differently, that's fine and honest.

On the step 0 fixture with its recorded semantics:

| Theme | Negative mentions | Groups reached | Content only | Connectivity only | Combined |
|---|---|---|---|---|---|
| Weekend table wait | 16 | 1 of 4 | **#1** (16) | #4 | #2 (16) |
| Soggy takeaway packaging | 10 | 4 of 4 | #2 (10) | **#1** | **#1** (40) |
| App and menu prices | 3 | 2 of 4 | #3 (3) | #3 | #3 (6) |
| Dishes guests praise | 0 | 3 of 4 | #4 (0) | #2 | #4 (0) |

Connectivity alone ranks praise #2. Content alone ranks wait time #1. Only the combination puts packaging first and praise last.

**UI (`social-pipeline.tsx`):** above the existing "Where AI themes meet observed connections" section, add a **"Fix first"** panel:

- A row per issue with its three ranks and a ↑/↓ badge where the combined rank differs from content-only.
- One line of plain-English reason that code generates from the numbers, e.g. "8 mentions · reached 4 of 4 groups · 3 cross-group reposts · 3 new groups this week".
- Each row's existing **Trace this theme** button.
- Purple AI styling, since topics and tone come from AI.

**Tests (`social-operations.test.ts`):** using the step 0 fixtures:
- Wait time ranks #1 on content-only.
- Packaging ranks #1 combined.
- Every signal matches a hand count.
- Empty or no-links datasets return zeros, never NaN.

---

## Step 3 — Send each issue to the right Tactical page · ✅ done

Implemented as `issueAction()` / `operationsLinksApply()` in `domain/social-operations.ts`, the **Where to fix it** list in the Fix first panel, the `day` target kind, and HR calendar day keys. On the demo: packaging → Supply · Vented takeaway boxes (22 of 60, below threshold); wait time → HR · Sat, Nov 14 (61 peak orders, 10.17 per floor-staff hour vs. target 6); prices → Finance menu item.

One change from the design below: for staffing, code picks the day guests **name** most (weekend → Sat/Sun), then the highest load. The highest load overall is Tue, Nov 10 (14.0 per floor-staff hour), but no guest talks about Tuesday. That day is used only when no weekday is named, and the link says so. Issues with no negative mentions (praise) get no fix link.

**AI picks the area, code picks the record.** Extend `semanticModelSchema`/`semanticSchema` so each topic carries `area: "staffing" | "supply" | "pricing" | "floor" | "food" | "other"`, and update the prompt in `backend/social-service.ts`. The AI is good at "soggy fries → packaging/supply". Code then selects exact records, so the model never names a record ID:

| Area | Record selection (deterministic, in `social-operations.ts`) | Target |
|---|---|---|
| supply | Inventory whose name/category tokens appear in the topic's messages, below-threshold items first (→ `i34` Vented takeaway boxes) | `{page:"supply", kind:"inventory"}` (already supported) |
| food / pricing | Menu items named in the topic's messages (→ Sweet Potato Fries) | `{page:"finance", kind:"menu"}` (already supported) |
| staffing | Workforce day with the highest `peakOrdersPerFloorHour` from `workforceMetrics()` | **new** `kind:"day"` on the HR calendar |
| floor | Floor overview | `{page:"floor", kind:"overview"}` |
| other / no match | No link; the card says "No matching record in your data" | — |

**Navigation reuses the assistant's location system:**
- Pass `locate` from `tactical-workspace.tsx` → `ReviewInsights` → `SocialPipeline` as `onLocate`, plus `data.operations`.
- Add `"day"` to `assistantTargetSchema.kind` in `domain/assistant.ts`.
- Add `data-assistant-key={\`day:${date}\`}` to the HR calendar day column.
- Add `useAssistantLocation("day", …)` in `hr-page.tsx` to open the calendar view.

**UI:** each "Fix first" row gets an action chip, e.g. "Supply · Vented takeaway boxes · 22 / 60 below threshold → Open". The chip shows the real record values, read from operations data, not from AI.

**Only for this restaurant's own conversation.** For an imported or Hacker News dataset, hide the chips and say "Operations links apply to this restaurant's own customer conversation". Public data still gets step 1.

**Tests:**
- Unit: area validation rejects unknown values. Packaging → `i34`. Staffing → the busiest-per-floor-hour day. No-match → no target.
- E2E: clicking the chip lands on `/tactical/supply` with `[data-assistant-key="inventory:i34"]` highlighted. Same for the HR day.

---

## Step 4 — Line up the spread with what happened in the restaurant · ✅ done

Implemented as `restaurantEvents()`, `issueSpread()` and `alignmentHeadline()` in `domain/social-operations.ts`, plus an optional `operations.events` log in `domain/dataset.ts`. Each "Where to fix it" row has a daily strip: mention bars, a customer-groups-reached line, and event markers.

- **Logged events:** the demo restaurant has one. On Nov 12, vented takeaway boxes went below reorder point and delivery orders were packed in flat boxes (`i34`). It's synthetic, like the rest of the fixture.
- **Derived events:** schedule days where the floor ran above its orders-per-staff-hour target. That's every demo day except Wed, Nov 11.
- **Rule as built:**
  - Windows are equal-length before and after each event, up to 7 days, clipped to the sample.
  - An event aligns only if mentions rose **and** the issue reached more customer groups than before **and** more than one.
  - The "more than one group" condition was added during the build. Without it, weekend waits "aligned" with Friday's floor strain just by reappearing in their one group (0 → 1). That isn't spread.
- **Demo result:**
  - Packaging: "After Nov 12 · …: mentions 1 → 8, customer groups 1 → 4 (4 days before vs. after)".
  - Wait time: shows 6 strain markers but never aligns.
  - Pricing: no events.
- No owner UI for logging events yet; they come from the dataset.
- Per the no-explanation-text rule, the UI shows no methodology or "not proof of cause" notes. The wording "After" (never "because") and this doc carry that caveat.

**Restaurant events, built from existing data:** `operationalEvents(operations)` in `social-operations.ts`.
- **Low stock:** each below-threshold inventory item becomes an event dated at its `lastOrdered`. Label it honestly ("below threshold as of last order"), because there's no stock history.
- **Peak strain:** for each workforce day, flag it if `peakOrdersPerFloorHour` > `targetOrdersPerFloorHour`, using `workforceMetrics()`.
- **Optional owner-entered events** (e.g. "switched box supplier 11-06", "raised delivery prices 11-03") go in a new optional `operations.events: {id, date, area, label, recordId?}[]` in `domain/dataset.ts`. Add one or two to the fixture, labeled as synthetic.

**Alignment rule (deterministic, conservative).** For each Fix-first issue, look for an event in the same `area` dated before the issue's sharpest rise. Compare the 7 days before the event with the 7 days after: mentions and new groups reached. Show the alignment only if both went up. Wording is fixed: "Rose after", never "caused by".

**Visualization:** one small chart per issue, laid out as a strip.
- Bars: daily mentions.
- Step line: cumulative groups reached.
- Vertical markers: matching events, labeled.
- Headline sentence from code, e.g. "After *Vented takeaway boxes below threshold* (Nov 13): mentions 2 → 6, groups 1 → 4."

Hand-rolled SVG (like the existing graph) plus an accessible table. No new chart dependency.

**Tests:**
- Unit: events derived from the fixture match a hand check. The alignment fires for packaging and does **not** fire for wait time.
- E2E: the strip renders, its markers link to the same targets as step 3, and it fits at a 390 px width.

---

## Build order and rough effort

| # | Work | Main files | Est. |
|---|---|---|---|
| 0 | New conversation + semantics fixtures | `data/demo-social*.json` | 1–1.5 h |
| 1 | Ranking signals + three rankings + Fix-first panel | `domain/social-operations.ts`, `social-pipeline.tsx/.css` | 2 h |
| 3a | `area` in AI schema + prompt | `domain/social.ts`, `backend/social-service.ts` | 0.5 h |
| 3b | Record selection + action chips + navigation (`day` target) | `social-operations.ts`, `social-pipeline.tsx`, `tactical-workspace.tsx`, `review-insights.tsx`, `domain/assistant.ts`, `hr-page.tsx`/`hr-calendar.tsx` | 1.5 h |
| 4 | Events + alignment rule + timeline strip | `social-operations.ts`, `domain/dataset.ts`, `social-pipeline.tsx` | 2 h |
| — | Tests, live Gemini check on the new fixture, update `ARLEQUIN_TRACK2.md` and the report export | `social-operations.test.ts`, `e2e/social.spec.ts` | 1.5 h |

If time runs out, cut step 4's owner-entered events first, then the connectivity-only ranking column. Keep content-only vs. combined: that comparison is the core evidence that both layers matter.

## Risks

- **Live AI labels vary.** Gemini may split or merge topics, which changes ranks. Mitigation: clear fixture text, and tests that use the recorded semantics. Rehearse the live demo once and keep the exported report from a good run.
- **Small sample.** Groups come from ~40 messages. Keep the existing wording that groups are algorithmic and sample-dependent.
- **Timing is not proof of cause.** Step 4 only reports timing that lines up, under a fixed rule, and the copy says so.
