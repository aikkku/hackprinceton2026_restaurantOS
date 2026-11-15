# Sprout workspace shell

Phase 2 of the [design rollout](DESIGN_REDESIGN_PLAN.md), November 15, 2026. The presentation target is **laptops**. Dedicated phone navigation and mobile refinement are deferred by user direction.

## What changed

- Persistent left sidebar with Sprout branding, restaurant name/cuisine/location, all six Tactical sections and a distinct purple AI destination.
- A compact header and **Demo data** disclosure with the configured source, storage and MongoDB revision when applicable.
- A consistent page heading, generous working area and cream/forest/sage styling. Existing component tokens inherit the same palette as onboarding.
- AI unlock controls sit in a compact purple disclosure on applicable pages. Floor Plan keeps its controls with its AI workflow; Supply has no AI access controls or initialization.
- Expansion and restaurant setup remain separate destinations. Leaving through the brand, setup or Expansion asks before discarding unsaved floor changes. Opening another tab does not trigger a discard prompt.
- Keyboard skip link, active-page semantics, page-title focus after section navigation, and Escape/focus return for header disclosures.
- Compact sidebar spacing on shorter laptop windows; the sidebar can scroll when necessary.

## What stayed in place

`TacticalWorkspace` still owns the floor context and keeps Floor Plan, Reviews, HR, Supply, Finance and AI components mounted across section changes. The shell wraps these existing views. Saved floor versions, price experiments across tabs, review filters, cash forecasts, backend handlers and AI protection retain their existing behavior.

Per-page content redesigns are future phases. Floor Plan is next. The photo route remains accessible, and scenario/decision redirects are unchanged. Rain's Expansion module, contracts and styles were not edited.

## Code structure

| File | Responsibility |
| --- | --- |
| `frontend/components/tactical-workspace.tsx` | Mounted pages, floor context and AI access provider |
| `frontend/components/sprout/workspace-shell.tsx` | Sidebar, navigation, source disclosure, headings, exit guards and focus |
| `frontend/components/sprout/workspace-shell.css` | Laptop layout and bridge from Tactical tokens to Sprout |
| `frontend/components/sprout/tokens.css` | Palette, spacing, radii and timing reused by onboarding and shell |
| `frontend/components/sprout/brand.tsx`, `primitives.css` | Reusable brand and base focus style |
| `frontend/components/tactical.css` | Existing page styles; obsolete horizontal-shell rules removed |
| `frontend/e2e/workspace-shell.spec.ts` | Laptop navigation, disclosure, exit protection, state retention and Supply isolation |

These primitives remain Tactical-owned. Their core palette matches Rain's Sprout palette; promoting them into app-wide ownership requires coordination.

## Review path

1. Open `/tactical` at laptop size. All six sections are on the left; Floor Plan is active.
2. Open **Demo data** and inspect its source/revision. Escape closes it.
3. Nudge a table, visit HR, then return. The position and unsaved state remain.
4. Click setup, Expansion or the Sprout brand. Cancel the warning; the draft remains intact.
5. In Finance, change a price-playground input, switch sections and return. The input remains.
6. Open AI access; its form and lock behavior remain available. Supply does not initialize AI access.

## Validation

All 74 existing Tactical browser checks passed after the shell change. The six new laptop shell checks passed in Chromium and Firefox after correcting test selector/request timing. Unit tests: 272 passed, one existing skip. Typecheck and production build passed; lint has no errors and retains one existing Expansion warning. Existing Expansion filesystem-tracing build warnings remain. No database records or credentials were changed.

## Implementation field note

A shell redesign should wrap the persistent workspace rather than conditionally mount each page, which loses form/layout state on navigation. Test every new exit link. Scope access-form selectors to the shell because the persistent floor editor retains its hidden form. Observe a fresh Supply page for no-request assertions so an earlier page's pending request is not incorrectly attributed to Supply. ChatOverflow was unavailable (`command not found`), so this note is recorded locally.
