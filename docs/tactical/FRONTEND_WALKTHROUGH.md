# Tactical frontend walkthrough

[Documentation index](README.md) · [Current inventory and backlog](IMPLEMENTATION_STATUS.md)

Use Node.js 22.18 or newer, run `npm ci` and `npm run dev`, then open `/` for Sprout welcome and onboarding, or `/tactical` to open the existing workspace directly. The core restaurant layout, assumptions and review excerpts come from the editable [demo fixture](../../src/features/tactical/frontend/data/demo-restaurant.json). Browser storage holds saved layouts and scenarios independently.

## Sprout onboarding review

1. Open `/`, choose **Let’s get started**, and optionally enter any restaurant name/location and goal.
2. Continue to the upload step. **Demo** starts checked. Select or drop arbitrary menu, space, sales or other files; remove a file to check the preview. No file bytes are sent to the server.
3. Uncheck Demo: real document processing is clearly unavailable and completion is disabled. Recheck it and choose **Set up demo**.
4. The ready screen shows the current mock restaurant and dataset-derived counts, regardless of the entered details or selected files. Open Floor Plan, Finance or Reviews. The current saved work remains available.
5. Try `/register`, a narrow screen, keyboard navigation, Back, and reload. Basic answers/mode return in this tab; files need reselection. A dataset outage shows a retryable error rather than a false success.

See the [complete redesign sequence](DESIGN_REDESIGN_PLAN.md). Existing page walkthroughs follow below.

## 1. Explore the starting layout

Choose **Demo template**. The supplied Juniper Table fixture has 23 seats and 6 tables. Select a table in the scene or through **Select furniture**. Zoom in, scroll the scene to pan, then choose **Fit room**. On narrow screens, the furniture list and numeric inspector provide the same editing controls.

## 2. Edit and reverse changes

Add furniture with the palette and click the floor, or choose **Place in clear spot**. Drag, nudge, rotate, duplicate, or delete it. Edit exact position, dimensions, rotation, and seat count in its details. **Undo** and **Redo** restore prior edits. Objects must fit inside the room, and overlaps display a warning before a seating preview can run.

Expand **Room dimensions** to rename the draft, switch between meters and feet, or resize the room. Switching units preserves the physical layout. A room resize that would exclude existing furniture displays an error.

## 3. Save and transfer layouts

Choose **Save draft**, reload, and check the saved layout. **Reset draft** restores the current editing baseline. **Blank layout**, **Demo template**, and **Open saved draft** switch the working plan, with confirmation for unsaved changes.

**Export layout** downloads versioned JSON. **Import layout** validates a file for the current restaurant and opens it as an editable draft. Invalid geometry, unsupported versions, another restaurant's ID, or files over 1 MB produce a visible error. Save the imported draft when ready.

## 4. Inspect the mission evidence

Open **Read 2 cited reviews** and **Why this mission?** to inspect the supplied evidence, demo priority, applicability, and missing information. Open **Customer Reviews & Social Media** in the navigation to explore theme counts, average rating, and rating distribution. Search review text, select a theme, or enable **Mission evidence only**. A search with no matches offers a way to restore all reviews.

Topics and mission details are authored in the demo file. Counts are calculated from those records. Live review AI and review uploads are future work; the separate photo provider path is described below.

## 5. Try adding seats

Choose **Try adding seats**, add a table, and inspect the changed draft capacity. Give the scenario a name, edit its baseline and financial assumptions, then choose **Preview outcome**. Results show additional daily covers, monthly revenue, monthly contribution, and simple payback. Changing inputs after a preview prompts you to calculate again before saving.

## 6. Try faster turnover

Choose **Try faster turnover**. Set target turns per seat above the baseline turns and preview. This calculation uses baseline seats multiplied by the change in turns and occupancy. With the supplied assumptions, increasing turns from 1.5 to 2 on 23 seats produces 7.475 additional modeled daily covers. The interface rounds displayed results.

Try zero occupancy or zero contribution margin to see unavailable payback. Added demand, service capacity, and actual costs remain assumptions that an owner needs to verify.

## 7. Read the analysis and compare

**View analysis** shows the snapshot's inputs, model version, formulas, cited reviews, missing information, and contribution at lower/base/higher occupancy. Those sensitivity examples vary occupancy by ten percentage points within 0–100%.

Save a named seating scenario and a named turnover scenario. Expand **Compare saved scenarios** and select A and B. The table shows their inputs, model versions, evidence IDs, and outcomes. A notice appears when baseline or demand assumptions differ.

## 8. Revisit decisions

Reload, open either saved scenario, and inspect its original values. **Load scenario layout** is available when a seating snapshot has a different layout. Loading it creates a working draft. Saving a scenario preserves its input, evidence, and calculated output snapshot. Deleting a saved scenario requires confirmation.

Earlier seating snapshots are supported. Valid scenarios can be recovered when another saved entry is damaged, with a visible notice. Clearing browser storage removes locally saved work.

## Current implementation boundary

The frontend uses fixture data, deterministic calculations, and local browser storage. Backend persistence, live review analysis, sponsor integrations, and the Expansion handoff are future phases. Root visual tokens remain shared, and cross-domain contracts still need agreement with Rain.

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` for repository checks. The test suite covers geometry, file validation, review aggregation, scenario math, backward compatibility, and saved-data recovery.


## 9. Compare named layouts

In **Saved floor plans**, enter a name such as “Comfortable Dining” and choose **Duplicate** on a saved row. Save current edits before duplicating: it copies the saved version. Edit the new configuration and choose **Save draft**. Use **Open** to switch, **Rename** with the name field to rename, and **Use as baseline** to select the comparison baseline. The comparison shows saved seats, room area per seat and simulated revenue change; expand its assumptions. Delete an alternative with confirmation, then reload to verify the remaining library.

## 10. Inspect custom objects and layout hypotheses

Place an **AC unit**, **Window** or **Custom object**. Edit its name and description in the inspector, then save/reload and reselect it. Put a seating object within two meters of the AC/window center to see a proximity hypothesis under **Layout insights**. Use **Inspect affected object** to select the seating object. These are rule-based suggestions, not measured preference or safety findings.

## 11. Try the separate photo draft editor

Expand **Estimate a separate draft from photos** on Floor Plan. Use **Sample plan** to exercise selection, editing, undo/redo and exports without credentials. Invalid JSON should show an error and retain the current draft. The sample editor uses feet and a different JSON format; it cannot yet be imported directly into the main editor.

For an authorized photo, unlock AI and generate with Gemini. A missing key or failed/invalid response shows only Something is wrong; no sample substitutes for the result. Correction lessons are prompt memory, not model training. Current photo drafts are not automatically saved across reloads: export them first.

## 12. Review the supporting sections

HR shows seven fictional employees, a calendar and editable AI hiring drafts. Supply shows dated fictional inventory cards with no supplier directory or AI controls. Finance opens a dated item-sales report with purple AI observations, sample comparisons, delivery and slow-seller analysis. Switch to **Price playground**, apply suggested raises, increase the customer-loss estimate and reset; inspect evidence and reopen dismissed assumptions. The independent ledger remains collapsed below the report; Nessie has its own utility entry. These pages use the central validated fixture/MongoDB dataset and retain explicit synthetic labels. See [Finance workflow](FINANCE_WORKFLOW.md) and [AI setup](AI_FEATURES.md).

For exact remaining capabilities, use the [page guide](PAGES.md) and [implementation inventory](IMPLEMENTATION_STATUS.md).


## 13. Seed or upload the mock dataset to MongoDB

Follow [MongoDB setup](MONGODB_SETUP.md) for the shared database, server credentials, create-only seed, authenticated upload and optimistic revision updates. MongoDB mode shows its source/revision in the header. Working layout/scenario saves are still browser-local; dataset upload does not automatically synchronize them.

## Cash calendar

Open Finance → Cash calendar. Click the lowest balance to inspect that day; edit reserve/payout assumptions, save a named forecast, reload and reopen it. Unlock workspace access for Refresh bank data; the source changes to Nessie API and all funds remain simulated. A failed refresh preserves the prior snapshot with a stale warning. Check Month/Agenda on a narrow screen. See [cash calendar guide](CASH_CALENDAR.md).
