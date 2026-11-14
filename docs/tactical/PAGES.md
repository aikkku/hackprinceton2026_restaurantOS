# Tactical pages

The persistent Tactical layout holds editor and scenario state while Next.js routes select the visible workspace. Internal navigation preserves unsaved edits and scenario inputs. Reload restores explicitly saved browser data.

| Page | Implemented | Future work |
| --- | --- | --- |
| Floor plan — /tactical | Template, blank and saved layouts, editable room size, feet/meters, furniture placement and precise measurements, rotation, seats, undo/redo, overlap warnings, zoom, JSON import/export, mission evidence and scenario entry points | Custom art direction, optional scaled floor-plan background, broader room shapes, backend layout storage |
| Scenarios — /tactical/scenarios | Seating and turnover models, editable financial assumptions, named previews, stale-input detection, analyst drawer, evidence, occupancy sensitivity, save snapshots | Additional validated operational models, live inputs, stronger demand assumptions, backend persistence |
| Saved decisions — /tactical/decisions | Saved snapshot list, reopen/delete, compare two alternatives with inputs, outputs and evidence, legacy compatibility and damaged-entry recovery | Server-backed history, account access, decision status and realized-outcome tracking |
| Customer signals — /tactical/reviews | Demo review list, search, theme filters, cited-only filter, rating distribution, deterministic counts, seating mission link | Permissioned review upload, AI classification, more evidence-backed missions, live refresh |

Backend and integrations remain future phases. All business inputs currently come from the editable demo JSON and user-entered scenario assumptions. Expansion is available through the workspace navigation and remains Rain's feature.

For review, start with each page's layout and controls, then evaluate the labels and information shown. The main product decisions still needed are the visual direction, first real restaurant dataset, next operational scenario, and which integrations to prioritize. Engineering can then add the backend and validated data adapters against those choices.
