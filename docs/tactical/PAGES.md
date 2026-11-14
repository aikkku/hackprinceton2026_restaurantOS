# Tactical pages

[Documentation index](README.md) · [Detailed inventory and backlog](IMPLEMENTATION_STATUS.md)

All six sections share the persistent Tactical shell. The core editor/reviews use the restaurant fixture; HR/Supply/Finance still contain hardcoded demo records and labels, so complete selected-restaurant propagation remains unfinished. Internal links preserve open editor state. Browser reload restores explicitly saved layouts and scenarios.

| Page | Implemented | Next work |
| --- | --- | --- |
| Floor Plan — `/tactical` | Existing SVG editor; named persistent configurations; duplicate/rename/open/delete; explicit baseline; AC, chair, wall, window, light, decoration and custom objects; editable names/descriptions; geometry comparison; heuristic insights; seating/turnover scenarios and saved comparisons inline | More expressive art, measured operational data, AI interpretation with evidence, photo-to-layout conversion |
| Customer Reviews & Social Media — `/tactical/reviews` | Fixture review search, rating distribution, supplied theme filters and mission citations | Authorized CSV/JSON imports, source/sentiment/date/dish filters, trends, evidence-linked AI findings and editable response drafts; observed social network analysis only when data exists |
| HR — `/tactical/hr` | Fictional directory, schedule and expandable profiles | Consolidate fixtures; synthetic contacts, pay, availability, labor estimates and job-description preview |
| Supply Management — `/tactical/supply` | Fictional inventory, category filters, suppliers and stock indicators | Consolidate fixtures; costs, displayed thresholds and derived restock summary |
| Financial Intelligence — `/tactical/finance` | Existing demo revenue/transaction/pricing views and capacity what-if | Validated financial records, accounting filters, explicit channel costs, pricing and volume scenarios, persistence and shared calculation reuse |
| AI Assistant — `/tactical/ai` | Explicit inactive placeholder | Intentionally deferred |

Legacy `/tactical/scenarios`, `/tactical/decisions`, and `/tactical/analyze` redirect to Floor Plan. Photo analysis is an expandable separate editor inside Floor Plan. It does not update the measured floor plan or financial model.

## Named layouts

`restaurant-os:tactical:<restaurantId>:layouts:v1` stores a validated library with active and baseline IDs. On first load, the old single-layout draft is copied into the library in memory; the old key remains intact. The next explicit library save writes the new format. Corrupt libraries are preserved and library writes disabled rather than silently overwriting saved work.

Save draft updates the active configuration. Duplicate copies the selected saved configuration. Unsaved edits require confirmation before switching, renaming, duplicating or deleting. Save first to keep them. Baseline selection initializes new scenario assumptions; saved scenario snapshots retain their original inputs. Room area per seat is a density heuristic, not a comfort, accessibility or aesthetics score.

## Verification

Use Node >=22.18. Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. After building, run `PLAYWRIGHT_CHANNEL=chrome npx playwright test --config playwright.tactical.config.ts` for the named-layout and photo-editor regression journeys. The tests run Chrome/Chromium and Firefox on port 3057. Install Firefox with `npx playwright install firefox`; use installed Chrome with the channel variable, or omit it with Playwright Chromium installed. Reload tests check that Firefox does not restore stale disabled button states before hydration.
