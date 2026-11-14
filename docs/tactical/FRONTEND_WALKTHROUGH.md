# Tactical frontend walkthrough

Use Node.js 22.18 or newer, run `npm ci` and `npm run dev`, then open `/tactical`. The root route also opens Tactical. All business records and review excerpts come from the editable [demo fixture](../../src/features/tactical/frontend/data/demo-restaurant.json). Browser storage holds saved layouts and scenarios independently.

## 1. Explore the starting layout

Choose **Demo template**. The supplied Juniper Table fixture has 23 seats and 6 tables. Select a table in the scene or through **Select furniture**. Zoom in, scroll the scene to pan, then choose **Fit room**. On narrow screens, the furniture list and numeric inspector provide the same editing controls.

## 2. Edit and reverse changes

Add furniture with the palette and click the floor, or choose **Place in clear spot**. Drag, nudge, rotate, duplicate, or delete it. Edit exact position, dimensions, rotation, and seat count in its details. **Undo** and **Redo** restore prior edits. Objects must fit inside the room, and overlaps display a warning before a seating preview can run.

Expand **Room dimensions** to rename the draft, switch between meters and feet, or resize the room. Switching units preserves the physical layout. A room resize that would exclude existing furniture displays an error.

## 3. Save and transfer layouts

Choose **Save draft**, reload, and check the saved layout. **Reset draft** restores the current editing baseline. **Blank layout**, **Demo template**, and **Open saved draft** switch the working plan, with confirmation for unsaved changes.

**Export layout** downloads versioned JSON. **Import layout** validates a file for the current restaurant and opens it as an editable draft. Invalid geometry, unsupported versions, another restaurant's ID, or files over 1 MB produce a visible error. Save the imported draft when ready.

## 4. Inspect the mission evidence

Open **Read 2 cited reviews** and **Why this mission?** to inspect the supplied evidence, demo priority, applicability, and missing information. In **Review insights**, explore theme counts, average rating, and rating distribution. Search review text, select a theme, or enable **Mission evidence only**. A search with no matches offers a way to restore all reviews.

Topics and mission details are authored in the demo file. Counts are calculated from those records. Live AI and review uploads are future work.

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
