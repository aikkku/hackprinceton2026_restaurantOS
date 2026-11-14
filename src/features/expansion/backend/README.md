# Expansion backend

Reserved for authorized property data access, server actions, integrations, and persistence. No server adapter is implemented yet.

Normalize and validate future provider records with `../domain/schemas.ts` and implement the boundary in `../domain/provider.ts`. Keep credentials and restricted data server-side. Frontend code must not import backend implementations; use a route or server boundary when one is added.

The current browser-only demo loads `../frontend/data/demo-market.json`. Private incoming datasets remain in `../data/` under its existing manifest and ignore rules.
