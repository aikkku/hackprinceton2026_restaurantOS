# Property fit score

Model: `expansion-property-fit-v1`. Scope: offered lease space, never an area or a prediction of restaurant success. Deterministic TypeScript consumes the Deep Agent run's structured listing and inspection evidence. AI prose and probability estimates never become numeric score inputs. No additional model call is needed.

| Factor | Default weight | Rule on the 1–10 scale |
| --- | ---: | --- |
| Listed base rent | 35 | `clamp(13 − 6 × upperMonthlyBaseRent / budget, 1, 10)`: half the budget = 10, budget = 7, twice budget = 1. Excludes unknown extra charges and market rent estimates. Requires supported units and bounded offered area/rent. |
| Seating fit | 25 | Within preferred range = 10. Below minimum: `10 × seats / minimum`. Above maximum: `10 × maximum / seats`. Clamp to 1–10; for capacity ranges use the worse endpoint. Dated observed capacity takes precedence; otherwise `floor(offeredArea × .60 / 15)` is a labeled planning estimate. No seat preference disables the factor. |
| Listed space use | 15 | Retail or Office/Retail = 10; explicitly incompatible Office/Medical/Industrial uses = 1. Unknown/Flex excluded. This does not establish restaurant permission. |
| Neighborhood preference | 10 | Dated observed neighborhood matching an owner preference = 10; another neighborhood = 5. Missing evidence excluded; absent preference disables factor. |
| Existing kitchen | 10 | Required and verified present = 10; verified absent = 1. AI kitchen probability and building-level notes excluded. “Not required” disables the factor. |
| Customer parking | 5 | Required and verified customer access = 10; verified absent = 1. AI interpretation of a visible lot does not verify customer use rights and is excluded. “Not required” disables the factor. |

The weights are explicit planning choices, not empirically calibrated success predictors. Unknown factors remain in applicable coverage but do not enter the weighted average; disabled factors enter neither. Coverage = included weight / applicable weight. Return a score only at coverage ≥25% and with at least one usable factor; otherwise show “Not scored.” Average included scores with their weights and round once to one decimal. Never substitute zero, a neutral score, or a model guess for unavailable data.

Every result carries its model version, factors, weights, explanations, evidence IDs, origins, coverage, and synthetic-record flag. Live inputs are the same source snapshots and dated verification notes used by property investigation. Conflicting observed facts are excluded. Wrong-property snapshots and notes are rejected. Updates recompute scores; AI-only kitchen/parking updates cannot change them. Original artifacts, suitability groups, finances and saved-plan snapshots remain intact.

The map and list show scores with coverage. Single-space markers show that score; a shared address shows the highest available score and `×N` spaces. Selecting/cycling a suite shows that suite's score. Popup rent remains available. The property page explains included/excluded factors. Scores with different coverage are explicitly identified as using different evidence. Demographic and competition context remains visible through existing source evidence, but has no owner-specific demand/competition normalization, so it is not scored.
