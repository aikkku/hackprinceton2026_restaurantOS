# Finance specialist mock-data path

The specialist was being delegated successfully, but both owner-entered and
Cedar Kitchen profiles supplied an unavailable financial baseline. Listing
occupancy could be calculated; required sales could not. Its final status also
trusted the model's `missing_inputs` list instead of the validated finance result.

For the current demo, a new search adds a labeled synthetic monthly report when
the baseline is absent. Saved restaurant profiles and the original missing-data
fixture are unchanged. Existing or partially supplied financial amounts are
never overwritten. The intake sent to the worker is explicitly marked demo,
with a `simulated_finance` origin and a synthetic source record.

| Mock October 2026 amount | USD |
| --- | ---: |
| Net sales | 60,000 |
| Variable costs | 36,000 |
| Fixed labor | 12,000 |
| Other fixed costs, excluding occupancy | 4,000 |

The existing TypeScript tools derive a 40% contribution margin, $16,000 monthly
fixed costs, and $40,000 required monthly sales **before rent and extra building
charges**. This is an illustrative threshold, not a forecast or the selected
location's complete break-even calculation. Listing rent and unknown charges
retain their original evidence and gaps.

Run a **new** Find Locations search, then expand **View details → Finance
specialist**. It should show **Finished**, the mock baseline calculation, and the
number of locations whose rent was checked. Historical terminal runs remain
unchanged. A configured model and Python worker are still required for the live
agent path; supplying mock business data does not bypass provider failures.

The worker now requires `finance.json` before finalization, determines completion
from the validated calculation, and preserves mock-data and occupancy limitations
in both finance and summary assumptions. A model cannot manufacture success by
omitting missing inputs. No schema version or shared Tactical contract changed.

Implementation:

- `frontend/data/mock-finance.ts`: temporary, schema-validated demo adapter.
- `frontend/sprout/search.tsx`: results labeled with their mock baseline in specialist details.
- `agent/worker/restaurantos_worker/planner.py`: artifact-based finalization and provenance.
- `agent/worker/fixtures/cedar-kitchen-run.script.json`: baseline-independent test narration.
- `backend/worker.ts`: keep host Python paths out of Turbopack tracing; otherwise the
  local virtual environment's interpreter symlink prevented a production build.

Validation covers unchanged/missing/partial baselines, deterministic amounts,
rejection of model-proposed amounts, real Python framework delegation against the
real TypeScript HTTP bridge, and finalization without tool execution. The browser
spec is `frontend/e2e/finance-specialist.spec.ts`; it uses a scripted model inside
the real framework and a synthetic property cache. This does not verify a live
model provider or real financial integration.

Checks on 2026-11-15: all 346 Node tests, all 50 Python tests, the Finance Chrome
journey, TypeScript checking, lint (one existing unused-variable warning), and
the production build passed. The build retains existing dynamic filesystem
tracing warnings. Focused tests were added or extended in `mock-finance.test.ts`,
`agent.test.ts`, `agent-integration.test.ts`, `agent/worker/test_safety.py`, and
`frontend/e2e/finance-specialist.spec.ts`. No Tactical code or shared contracts
were changed; no cross-domain coordination is required for this demo adapter.
