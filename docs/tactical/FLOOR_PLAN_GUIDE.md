# Floor Plan editor

Open Tactical → Floor Plan. The map is the main editing surface.

- **Furniture** opens a searchable menu of items you can add. Select one and click the canvas or choose **Place in clear spot**.
- **Save** creates a version. Use the dropdown beside it to reopen an earlier version. Opening a version prompts before discarding unsaved edits.
- Select furniture by clicking it or tabbing to it on the map. Drag it to move freely. Arrow keys move it by 0.1 meters, and Shift with an arrow moves it by 0.5 meters. R rotates 90 degrees, Shift+R rotates back, D duplicates, Delete removes, and Escape clears selection or placement.
- Resize with the small handle on the selected object's lower-right corner or by entering dimensions in **Furniture details**. Seating groups add slots as their footprint grows and remove slots as it shrinks. Tables and booths add pairs for each additional 0.6 meters of width. Four-seat tables also respond to depth. Counters add one slot per 0.65 meters of width. The initial dimensions and seat count anchor these estimates so several smaller edits accumulate. An individual chair keeps one seat. Attached chair objects count toward their group's included capacity.
- Yellow outlines mark close or overlapping footprints and update during drag and resize. Hover for the affected object and the measured gap or overlap. The measurements use rectangular footprints and describe proximity in the plan.
- **The Seating Problem** expands to show the Gemini control. Unlock the workspace and run the analysis to see evidence-linked seating and circulation findings. If AI offers a valid move, preview it and then apply or reject it. Edits invalidate the visible proposal.
- **Plan settings** contains room dimensions, a version name, and the original and blank templates. Photo estimation has its own route at /tactical/analyze.

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
