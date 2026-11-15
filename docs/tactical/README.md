# Tactical documentation index

Start with **[Current implementation and remaining work](IMPLEMENTATION_STATUS.md)**. It is the canonical code-backed inventory, feature backlog and implementation sequence for Asilbek's Tactical work.

## Which document to use

| Document | Purpose | Update when |
| --- | --- | --- |
| [CONNECTED_DATA_AND_AI_PLAN.md](CONNECTED_DATA_AND_AI_PLAN.md) | Proposed shared context, durable AI artifacts, decisions and database migration | Centralization scope is agreed or a phase ships |
| [MONGODB_SETUP.md](MONGODB_SETUP.md) | Shared database, environment setup, seed/export, protected APIs and live verification | Database/API behavior changes |
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | Detailed current-versus-target status, source map, task IDs, priorities, dependencies, limitations and acceptance criteria | A feature ships, scope changes or verification finds a gap |
| [PRODUCT_REFINEMENT_BRIEF.md](PRODUCT_REFINEMENT_BRIEF.md) | Preserved user-supplied target product brief | Keep as the supplied reference; record later scope changes explicitly |
| [PAGES.md](PAGES.md) | Short route and page responsibility guide | Navigation, page ownership or save behavior changes |
| [FRONTEND_WALKTHROUGH.md](FRONTEND_WALKTHROUGH.md) | Steps to review the implemented demo manually | Controls or user journeys change |
| [TACTICAL_SPEC.md](TACTICAL_SPEC.md) | Earlier scope/MVP rationale | Keep useful foundations; later explicit product requirements take precedence |
| [SHARED_CONTRACT_PROPOSAL.md](SHARED_CONTRACT_PROPOSAL.md) | Proposed interface with Rain | Both owners coordinate; do not treat proposed types as implemented |
| [Root STRUCTURE.md](../../STRUCTURE.md) | Repository locations and cross-developer architecture | Files move or responsibility changes |
| [Shared game design](../GAME_DESIGN.md) | Visual/interaction principles for both modules | Shared design decisions change |
| [Tactical AGENTS.md](../../src/features/tactical/AGENTS.md) | Development boundaries and conventions | Working agreement changes |
| [Backend README](../../src/features/tactical/backend/README.md) | Current server-side Tactical entry and limitations | Server integrations or persistence are added |

## Reading order

1. Root and Tactical `AGENTS.md` for boundaries.
2. Product refinement brief and shared game design for intended behavior.
3. Implementation status for what actually exists and what to build next.
4. Structure/page guide and source files for implementation locations.
5. Walkthrough and tests for demonstration/verification.

The later user refinement brief extends the earlier MVP (including demo HR and Supply). Where they differ, the user's later explicit requirements govern. None of the specifications are proof that a feature is implemented: use the implementation inventory and linked code.

## Keeping documentation consistent

- Put detailed backlog items in `IMPLEMENTATION_STATUS.md`; reference their IDs rather than duplicating competing roadmaps.
- Keep `PAGES.md` concise and the walkthrough limited to controls that actually exist.
- State whether a check was run now or inherited from a previous verified increment.
- Separate demo, observed, assumed, simulated, unavailable and live-unverified states.
- Mark proposed files/contracts as proposed until they exist.
- Do not claim sponsor integration or eligibility from a fixture or placeholder.

- [Floor-plan editing and recovery guide](FLOOR_PLAN_GUIDE.md) — seat ownership, object creation, geometry previews, baseline behavior and library backups.

- [Tactical AI features and setup](AI_FEATURES.md) — Gemini workflows, purple provenance, access, evidence validation and generic failure behavior.

- [Sponsor integrations](SPONSOR_INTEGRATIONS.md): Nessie sandbox cash planning, relationship graph imports/analysis, source contracts, setup, demo and remaining eligibility gates.

- [Arlequin Track 2 implementation](ARLEQUIN_TRACK2.md): Reviews → Content & connectivity, public conversation imports, AI themes joined to actor communities, source-linked paths/timeline, export and submission guide.

- [Financial Intelligence workflow](FINANCE_WORKFLOW.md): report, price playground, mock sales schema, AI evidence, formulas and remaining work.

- [Cash calendar](CASH_CALENDAR.md): Nessie-connected cash planning, HR/Supply inputs, immutable forecasts, API and data limits.
