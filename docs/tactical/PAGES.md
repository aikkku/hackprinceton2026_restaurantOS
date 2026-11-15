# Tactical pages

[Documentation index](README.md) · [Detailed inventory and backlog](IMPLEMENTATION_STATUS.md)

All six sections share the persistent Tactical shell and one validated, server-selected synthetic dataset. Choose local fixture or MongoDB mode through server configuration; MongoDB errors remain visible. See [database setup](MONGODB_SETUP.md). Internal links preserve open editor state. Browser reload restores saved floor-plan versions from the configured source.

| Page | Implemented | Next work |
| --- | --- | --- |
| Floor Plan — `/tactical` | Freeform map, searchable furniture, keyboard shortcuts, automatic seat sizing, placement warnings, saved versions and expandable Gemini seating analysis | Measured furniture and service data |
| Customer Reviews & Social Media — `/tactical/reviews` | Review search, ratings, saved AI themes/sentiment/high-priority filters, scrollable themes, per-review AI draft/copy and disabled Reply | Platform posting, live review ingestion, source/date/dish filters and trends; see [review workflow](REVIEW_WORKFLOW.md) |
| HR — `/tactical/hr` | Seven-person team, dated calendar, AI status cards with hover evidence, editable AI hiring drafts | Schedule editing, saved owner edits, real payroll/Indeed publishing |
| Supply Management — `/tactical/supply` | Roomy inventory cards, mock expiration dates, search/category/stock filters, expandable costs and delivery details; supplier UI removed | Batch-level expiration tracking and real stock imports |
| Financial Intelligence — `/tactical/finance` | Dated menu report, purple AI observations/evidence, comparable prices, delivery/slow-seller analysis, editable price playground; 90-day cash calendar, source-linked daily events and saved forecasts; independent ledger and Nessie tools | Real-data imports, saved pricing scenarios and shared edited assumptions |
| AI Assistant — `/tactical/ai` | Purple single-turn Gemini advisor with evidence | Durable history, multi-turn context and external data remain deferred |

Legacy `/tactical/scenarios` and `/tactical/decisions` redirect to Floor Plan. The standalone photo editor is at `/tactical/analyze`. See the [floor plan guide](FLOOR_PLAN_GUIDE.md) for editing, saving and analysis.

## Sponsor tools added to existing pages

- **Finance → Nessie Sandbox:** explicit local-demo/API source choice, protected read-only refresh, deposit/withdrawal evidence, editable investment/reserve/burn, deterministic cash cushion and months-to-reserve, downloadable scenario.
- **Reviews → Relationship network:** synthetic sample or permissioned observed JSON import, relationship/node filters, SVG plus accessible tables, degree/components/topic-engagement metrics, linked evidence, local save/reopen/export, purple AI hypotheses.

See [setup, limitations and eligibility gates](SPONSOR_INTEGRATIONS.md). These tabs preserve the existing page routes and do not change Expansion.

- [Arlequin Track 2 implementation](ARLEQUIN_TRACK2.md): Reviews → Content & connectivity, public conversation imports, AI themes joined to actor communities, source-linked paths/timeline, export and submission guide.
