# Tactical pages

[Documentation index](README.md) · [Detailed inventory and backlog](IMPLEMENTATION_STATUS.md)

All six sections share the persistent Tactical shell and one validated, server-selected synthetic dataset. Choose local fixture or MongoDB mode through server configuration; MongoDB errors remain visible. See [database setup](MONGODB_SETUP.md). Internal links preserve open editor state. Browser reload restores saved floor-plan versions from the configured source.

| Page | Implemented | Next work |
| --- | --- | --- |
| Floor Plan — `/tactical` | Freeform map, searchable furniture, keyboard shortcuts, automatic seat sizing, placement warnings, saved versions and expandable Gemini seating analysis | Measured furniture and service data |
| Customer Reviews & Social Media — `/tactical/reviews` | Fixture review search, rating distribution, supplied theme filters and mission citations | Authorized CSV/JSON imports, source/sentiment/date/dish filters, trends, evidence-linked AI findings and editable response drafts; observed social network analysis only when data exists |
| HR — `/tactical/hr` | Central fictional directory, schedule, contact/pay/availability/mood profiles and base-labor estimate | Structured shift validation and job-description preview |
| Supply Management — `/tactical/supply` | Central inventory, category filters, suppliers, costs, thresholds and derived stock/restock indicators | Reorder-cost preview and UI polish |
| Financial Intelligence — `/tactical/finance` | Reconciled synthetic ledger, month/channel/type filters, channel contribution, dated sample dish prices, price/volume and capacity experiments | Real-data imports, saved pricing scenarios and shared edited assumptions |
| AI Assistant — `/tactical/ai` | Purple single-turn Gemini advisor with evidence | Durable history, multi-turn context and external data remain deferred |

Legacy `/tactical/scenarios` and `/tactical/decisions` redirect to Floor Plan. The standalone photo editor is at `/tactical/analyze`. See the [floor plan guide](FLOOR_PLAN_GUIDE.md) for editing, saving and analysis.

## Sponsor tools added to existing pages

- **Finance → Nessie Sandbox:** explicit local-demo/API source choice, protected read-only refresh, deposit/withdrawal evidence, editable investment/reserve/burn, deterministic cash cushion and months-to-reserve, downloadable scenario.
- **Reviews → Relationship network:** synthetic sample or permissioned observed JSON import, relationship/node filters, SVG plus accessible tables, degree/components/topic-engagement metrics, linked evidence, local save/reopen/export, purple AI hypotheses.

See [setup, limitations and eligibility gates](SPONSOR_INTEGRATIONS.md). These tabs preserve the existing page routes and do not change Expansion.

- [Arlequin Track 2 implementation](ARLEQUIN_TRACK2.md): Reviews → Content & connectivity, public conversation imports, AI themes joined to actor communities, source-linked paths/timeline, export and submission guide.
