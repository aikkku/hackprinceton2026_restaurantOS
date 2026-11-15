# HR workspace

`/tactical/hr` has a compact AI assessment row and three views: Schedule, Team, and Hire employees. All displayed staffing and demand records are fictional. No employee performance decisions or external job posting take place.

## What works

### Sprout design update — November 15, 2026

HR now reuses the Sprout palette, card shapes and compact view navigation. The assessment row pairs source-derived numbers with explicit purple AI markers and colored status badges. Hover/focus explanations and Data & assumptions still expose evidence and limits. Missing AI remains neutral; errors remain generic.

The seven-day schedule sits in a white calendar frame with sticky sage day headers, station-colored shift cards and a bounded keyboard-scrollable region. Week navigation, station filtering and shift disclosures are unchanged. Team has seven initial-avatar cards with contact, pay assumptions, tenure and availability behind a disclosure. Hiring separates a lavender brief from the editable draft, with a neutral empty state and explicit purple generated fields.

All three HR views now stay mounted. Schedule week/filter, open roster details, requirements and owner-edited job fields survive switching HR views and navigating to other Tactical sections. A reload or changed source dataset still clears the component draft; this is not durable database persistence. Textarea labels remain stable as their values change.

The changes are contained in `hr-page.tsx`, `hr-calendar.tsx`, `hr-hiring.tsx` and `hr.css`; backend context, schemas, arithmetic and MongoDB storage contracts are unchanged. The new browser case checks keyboard calendar scrolling and retained hiring edits/station filters across views. Existing fallback layouts remain; dedicated mobile redesign is deferred.

Verification: 299 unit tests passed, one existing skipped; all 82 existing Tactical browser checks passed; all eight final HR checks passed in Chromium/Firefox, including the new laptop cases. Lint, typecheck and production build passed with existing Expansion warnings. All three HR views, the saved AI assessment and a live generated hiring draft were visually inspected in the local preview. Indeed posting stayed disabled.

- **Schedule:** dated seven-day calendar with 36 shifts, station colors/filter, week navigation, expandable shift details, and a day selector on narrow screens. Weeks outside the fixture are empty; shifts are not silently repeated. This is a viewing interface, not a schedule editor.
- **Team:** seven employees in compact expandable cards. Hours are checked against structured shifts; contact, tenure, availability and pay assumptions are on demand.
- **AI assessment:** coverage, peak service load, labor cost and workload receive green/yellow/red interpretations with a text status, purple AI marker, and hover/focus explanation. Escape dismisses the focused explanation. Missing analysis remains neutral; failures show `Something is wrong` and Retry.
- **Hire employees:** choose a position and optional requirements, generate an evidence-grounded job description, edit every job field and copy it. Changing the brief marks the old result stale and disables copying until updated. The disabled **Post to Indeed** button is intentionally a placeholder. Edited drafts survive HR/Tactical view changes in the current workspace; copy before reloading or leaving Tactical.
- **Sources:** Data & assumptions exposes formulas' inputs, targets, synthetic provenance, model/date and cited source records. Sources are read-only in this page; change the central fixture or use the validated dataset API to change assumptions.

## Data and arithmetic

`frontend/data/demo-restaurant.json` contains `operations.employees` and optional `operations.workforce`. The example covers November 9–15, 2026, with seven employees, 255 paid working hours, 452 orders, seven daily peak-order totals and dated unit quantities/prices for all 24 menu items. The weekly demand sample is independent of the historical finance ledger; it is not a reconciliation or replacement.

`domain/workforce.ts` validates dates, Monday week boundaries, unique shifts, same-person overlaps, station assignments, daily order/quantity consistency and peak windows. `domain/dataset.ts` checks employee/menu references and hours against shifts. Existing datasets without `workforce` still load, but cannot receive a dated HR analysis.

`domain/hr.ts` computes base labor as shift duration × assumed hourly rate, weekly sales as item quantity × price snapshot, labor/sales fraction (unavailable at zero sales), orders and menu/station totals. Peak coverage uses the union of shift intervals; simultaneous staff add staff-hours without hiding uncovered time. Hours above the weekly guide are aggregate planning data. Breaks, payroll premiums, benefits, opening hours and individual skill differences are not modeled. The sample assumes scheduled time is paid working time.

The AI sees those code-calculated metrics, aggregate roles/pay assumptions, item demand, reviews and the separate ledger summary. Employee names, emails, mood, performance ratings and demographic attributes are not included. Customer feedback is qualitative evidence; its date may predate this sample and does not establish staffing causality. AI colors are interpretations of this fictional week, not measured performance or validated optimization.

## API and persistence

- `GET /api/tactical/hr?restaurantId=...`: reads a matching overview if one exists; never generates.
- `POST /api/tactical/hr`: `{ restaurantId, task: "overview" }` or `{ restaurantId, task: "hire", role, requirements }`. Requires the existing signed AI session, same-origin request and generation budget.
- `backend/hr-service.ts`: structured Gemini output, local schema/evidence validation, per-process in-flight deduplication, bounded requests and generic failure responses.
- Shared database collection **`restaurantos.tactical_hr_analysis`** stores validated results by hash of restaurant, task, requirements, model, prompt version and source context. Changed data invalidates cached interpretations. In local demo mode results use bounded process memory instead. There is no background database watcher or cross-process generation lease; simultaneous cold requests on separate workers may generate twice, although only one stored value wins.
- Opening HR reads the saved overview. If absent and AI is unlocked, it generates and saves it. No AI fallback status is invented. Original generated hiring outputs are cached; owner edits are browser component state and are not written back to MongoDB.

## File ownership

| Layer | Files |
| --- | --- |
| Thin route | `src/app/api/tactical/hr/route.ts` |
| Pure contracts/math | `domain/workforce.ts`, `domain/hr.ts`, `domain/dataset.ts` |
| Model and storage | `backend/hr-service.ts` |
| UI | `frontend/components/hr-page.tsx`, `hr-calendar.tsx`, `hr-hiring.tsx`, `hr.css` |
| Verification | `hr.test.ts`, `frontend/e2e/hr.spec.ts` |

## Remaining work

Design field note: hidden mounted sections preserve user edits and calendar filters without adding a second store or triggering model calls. Bounded calendars need an explicit focus target and sticky headers. Textareas inside wrapping labels need a stable accessible name so typed content cannot become part of their label. ChatOverflow was unavailable (`command not found`), so this note is recorded locally.

Editable shifts/drag-to-reschedule, unpaid breaks and overnight split-shift authoring, saved owner-edited job drafts, real order/POS ingestion and calibrated staffing assumptions are future work. Indeed authentication/publishing, recruiting, actual employee records and payroll are outside this demo. No Expansion files or shared domain contracts were changed.
