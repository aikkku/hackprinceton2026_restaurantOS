# Floor-plan editing and recovery

This guide describes the main SVG editor at `/tactical`. Photo analysis is separate and was not changed in this batch. Restaurant inputs are still explicitly mocked. Layouts and scenarios save in this browser; this is not automatic MongoDB synchronization.

## Review the new behavior

1. **Create an alternative.** Save your current draft, then use the library name field and Duplicate. Duplication copies the saved configuration, not unsaved changes. The editor names both its active save target and the saved comparison baseline.
2. **Describe custom furniture.** Choose Custom object, enter its description first, then its name, category and dimensions. Place it on the canvas or use Place in clear spot. These are manually declared properties; no AI infers measurements from the description. Metadata is editable in the inspector and survives save/reload/export.
3. **Declare chair ownership.** Select a chair and use Seat ownership. Standalone adds its declared seats to capacity. Included in a table/booth/counter represents seats already included in that group's capacity and adds zero. The canvas shows `+0` for assigned chairs. Assigned seats cannot exceed the group's included capacity. Deleting a group asks before removing its assigned chairs; Undo restores the entire change. Duplicating a group copies its footprint and included capacity, without cloning separate chair objects.
4. **Inspect gaps.** Select any object. The inspector shows the shortest room-edge gap and shortest gap to another object's rectangular footprint. Rotations of 90°/270° swap width/depth. Zero means touching or overlapping. Empty rooms have no nearest-object measurement. Values are not aisle widths, walkable paths, door-swing checks, customer preferences or compliance judgments.
5. **Act on an overlap.** Open an Overlapping footprints finding. Inspect affected objects highlights both objects and opens the first in the inspector. Preview a clear position displays a dashed ghost at the nearest available 0.25 m grid point. Apply suggested move commits one undoable move; Reject changes nothing. Other layout edits invalidate the proposal. If no grid position fits, rearrange/resize manually. A clear footprint does not guarantee acceptable clearance or solve every overlap in the room.
6. **Save and simulate.** Save draft replaces the active saved configuration. Saving the baseline updates new scenario seat defaults. Existing saved snapshots retain their original numbers. Blank layout and Demo template become unsaved replacements of the current configuration; Reset draft asks before returning to the saved checkpoint. All library comparisons use saved versions.

## Capacity compatibility

Version 1 layouts remain readable with unchanged seat counts. A layout with `seatOwnerId` uses **schemaVersion 2** so an older editor that only understands version 1 rejects it rather than silently double-counting assigned chairs. Version 2 keeps the same meter units, rotated rectangular bounds and object limits. No ownership is guessed from proximity.

Only chairs can name a `seatOwnerId`, and the referenced object must be a table, booth or counter in the same layout. Each group validates the total assigned-chair seats against its included capacity. Removing an assignment restores that chair's independent contribution. Users must still declare whether a chair is additional or already included. Seating-group dimensions and the illustrated chair markers should not be treated as measured circulation space.

## Backups, conflicts and recovery

Open **Back up or recover saved floor plans**:

- Export saved library downloads all saved configurations, their IDs and active/baseline selection. It excludes unsaved edits, scenario history and photo drafts.
- Export layout in the main editor downloads its current working draft, including unsaved changes.
- Import library backup validates up to 4 MB, at most 50 configurations, unique IDs, baseline/active references, layout geometry and restaurant ownership. The preview lists configurations before any writes.
- Apply library backup asks before replacing the library and working draft. The previous stored bytes are saved at `<library-key>:recovery` first. If that backup write or replacement fails, the existing library is not intentionally deleted. Download previous library exports the last recovery copy; one recovery slot is retained, not unlimited history.
- Download stored bytes exports the current browser value even when it cannot be parsed. Corrupt data is not silently reset. A validated backup can explicitly replace it.
- Another tab changing the library blocks saves without discarding the working draft. Export your draft, then Reload saved library to accept the newer library. Re-import your exported draft to reconcile manually.
- Storage is checked again immediately before writes. This prevents stale-client overwrites already visible in storage; it is **not an atomic cross-tab transaction**. Account-backed cloud synchronization remains future work.

Keys remain restaurant-scoped: `restaurant-os:tactical:<restaurantId>:layouts:v1`. The library envelope remains version 1 while individual layouts can be version 1 or 2. Browser storage quota failures remain visible; the working draft stays available for export. The older scenario storage path has a separate recovery/conflict backlog.

## Implementation locations

| File | Responsibility |
| --- | --- |
| `domain/schemas.ts` | Layout versions, chair/group ownership and geometry validation |
| `domain/layout.ts` | Capacity, edge gaps and bounded clear-position search |
| `frontend/layout-edit.ts` | Validated inspector updates and unit conversion |
| `frontend/layout-storage.ts` | Bounded library parsing, stale-write checks and recovery copy |
| `frontend/components/library-backup.tsx` | Backup preview/export/reload/recovery controls |
| `frontend/components/layout-inspector.tsx` | Custom metadata, ownership and gap measurements |
| `frontend/components/floor-plan.tsx` | Seat labels, affected-object outlines and proposed-position ghost |
| `frontend/components/tactical-workspace.tsx` | Draft/history orchestration and explicit apply/save actions |

## Still open

Wall/ceiling attachment semantics, whole-layout arrangement suggestions, review-linked interior findings, measured occupancy/service data, shared Floor Plan/Finance assumptions, baseline identity/version in scenario snapshots, authenticated cloud saving and a full accessibility audit remain unfinished. Photo changes are deferred per the user's direction. No changes to Rain's Expansion code are part of this increment.

## Verification

140 repository unit tests and 16 Tactical browser runs passed, alongside lint, typecheck and production build. Browser checks include both Chrome and Firefox. The two existing Expansion filesystem-tracing build warnings remain outside this batch.
