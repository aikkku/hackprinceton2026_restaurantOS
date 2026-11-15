# Floor Plan editor

Open Tactical → Floor Plan. The map is the main editing surface. A single bordered workspace contains the furniture menu, Save, version selector, and a settings icon. The neutral floor, thin architectural walls, wood tables and sage seating share scene tokens scoped to this editor. Furniture artwork uses room units so chairs retain their proportions as tables grow. The small purple analysis disclosure remains below the map; selected furniture details stay collapsed.

- **Furniture** opens a searchable menu of items you can add. The menu includes furniture thumbnails and a search field. Select one and click the canvas, press Enter, or use the check icon to place it in a clear spot. Escape cancels placement; clicking outside closes the menu.
- **Save** creates a version. Use the dropdown beside it to reopen an earlier version. Opening a version prompts before discarding unsaved edits. The last opened version is remembered on this device after reload.
- Select furniture by clicking it or tabbing to it on the map. Drag it to move freely. Arrow keys move it by 0.1 meters, and Shift with an arrow moves it by 0.5 meters. R rotates 90 degrees, Shift+R rotates back, D duplicates, Delete removes, and Escape clears selection or placement and cancels an active drag or resize without committing it.
- Resize with the small handle on the selected object's lower-right corner or by entering dimensions in **Furniture details**. Seating groups add slots as their footprint grows and remove slots as it shrinks. Tables and booths add pairs for each additional 0.6 meters of width. Four-seat tables also respond to depth. Counters add one slot per 0.65 meters of width. The initial dimensions and seat count anchor these estimates so several smaller edits accumulate. An individual chair keeps one seat. Attached chair objects count toward their group's included capacity.
- Yellow outlines mark close or overlapping footprints and update during drag and resize. Hover for a compact on-map tooltip with the affected object and the measured gap or overlap. Yellow warnings stay visible during drag previews; purple fill retains AI provenance when an AI-assisted object also has a warning. The measurements use rectangular footprints and describe proximity in the plan.
- **The Seating Problem** expands to show the Gemini control. Unlock the workspace and run the analysis to see evidence-linked seating and circulation findings. If AI offers a valid move, preview it and then apply or reject it. Edits invalidate the visible proposal.
- The settings icon beside the version dropdown opens **Plan settings**, which contains room dimensions, a version name, and the original and blank templates. Photo estimation has its own route at /tactical/analyze.

## Saved coordinates and AI context

On a MongoDB-backed workspace, use the existing workspace access code before saving. The file fixture mode stores versions in the browser. **Save** appends an independent snapshot with coordinates, rotation, dimensions and seating. A protected route validates the restaurant and rechecks the MongoDB revision on concurrent writes. The library accepts up to 50 saved versions and is subject to the dataset size limit.

The editor reads previous browser versions using their existing storage key. In MongoDB mode the next save also appends available browser versions so they become visible to the advisor. Kitchen zones are removed from editable layouts and the Juniper Table template places a cashier stand near the entrance. Closed historical financial snapshots remain available at the data layer for reproducibility.

The seating analysis and advisor receive the current working map and saved versions. Coordinates are meters from the upper-left corner. To bound repeated geometry, each saved version supplies objects added, changed or removed relative to the previous version, beginning with the working layout. AI responses remain subject to the request and prompt size limits. A failed AI request shows **Something is wrong**.

## Implementation locations

| File | Responsibility |
| --- | --- |
| domain/floor-editor.ts | Free placement helpers, seating resize, proximity checks and legacy layout normalization |
| frontend/components/floor-editor.tsx | Editing, shortcuts, version selector and seating analysis |
| frontend/components/floor-plan.tsx | Canvas gestures, geometry previews, furniture art and hover details |
| backend/floor-versions.ts | Protected append-only MongoDB writes |
| backend/ai-context.ts | Working and saved geometry supplied as evidence |

## Regression checks

Browser coverage includes free drag and live warnings, resize-driven chair counts, keyboard edits, AI preview/apply/staleness, saved version reload and selection persistence, Escape during a drag, palette search/empty results/keyboard placement, narrow layouts and hydration. Model responses in the automated browser suite are controlled test fixtures; live provider availability is a separate integration check.

## Collision colors

Overlapping furniture gets a red border and red hover explanation, including during drag/resize. Near-clearance warnings remain yellow. Attached chairs intentionally sharing their assigned table footprint are exempt. Geometry drives the color, including for AI-highlighted objects.
