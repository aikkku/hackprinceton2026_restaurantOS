# Tactical backend

`analyze.ts` implements the existing server-side Anthropic photo-analysis handler. `src/app/api/tactical/analyze/route.ts` re-exports it. Runtime request and draft validation live in `../domain/analyze.ts`. Without `ANTHROPIC_API_KEY`, responses explicitly identify a synthetic demo plan and the UI says the photos were not analyzed.

Live model calls are not part of the automated tests. Account persistence, review-analysis services and sponsor adapters remain future work. Keep credentials and provider SDKs in this directory, outside frontend/domain modules.
