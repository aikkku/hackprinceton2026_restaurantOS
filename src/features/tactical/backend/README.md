# Tactical backend

- `mongodb.ts`: official MongoDB driver, cached connection, IPv4, bounded pool; reads and revision-checked atomic writes to `restaurantos.tactical_datasets`.
- `load-dataset.ts`: explicit demo/Mongo source selection for server rendering. Failures remain visible.
- `data-api.ts`: authenticated, bounded JSON validation and list/read/write handlers. Thin route files live under `src/app/api/tactical/`.
- `dataset-cli.ts`: fixture validation/export and create-only seed.
- `api-cli.ts`: authenticated API list/get/validate/upload without token arguments.
- `analyze.ts`: Gemini photo handler with the shared access guard, streamed request bounds and strict validation; provider failures have no fallback.

See [MongoDB setup and API guide](../../../../docs/tactical/MONGODB_SETUP.md). All current business data is synthetic. The database is shared across the application; only Tactical's collection is touched. Rain's code remains independent. Credentials stay server-side in ignored environment files/deployment secrets.

AI now uses Gemini through `gemini.ts`; `ai-context.ts` computes the evidence catalog, `ai-service.ts` validates/caches responses, and `ai-access.ts` protects requests with a signed workspace session. Photo `analyze.ts` has no provider-failure fallback. See [AI features and setup](../../../../docs/tactical/AI_FEATURES.md).
