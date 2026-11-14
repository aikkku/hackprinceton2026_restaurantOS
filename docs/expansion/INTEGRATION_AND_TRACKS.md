# Rain ↔ Asilbek Integration and Hackathon Track Plan

**Status:** coordination document, not a finalized cross-team API or a certification of sponsor eligibility.

## 1. Working model: one repo, two domains

- **Asilbek** builds Tactical under `src/features/tactical/`.
- **Rain** builds Expansion under `src/features/expansion/`.
- **Shared pieces** (root app shell, theme, source/evidence representation, restaurant identity, recommendations, scenario conventions and reusable financial math) need a joint contract and mutually reviewed changes.
- **Other two teammates** handle business interviews, partner coordination, consent and non-sensitive research inputs.

The root `AGENTS.md` is a single source of truth. Never create distinct per-person root instructions.

## 2. The existing shared contract is the starting point

Read `docs/tactical/SHARED_CONTRACT_PROPOSAL.md` before introducing global types. It already proposes:

- `DataOrigin`: `observed | derived | assumed | simulated | unavailable`.
- `EvidenceSource`: ID, restaurant ID, kind, label, origin, demo marker, optional captured time.
- `Recommendation`: restaurant/domain/title/summary, evidence IDs, assumptions, missing data, confidence, priority, action.
- `SimulationScenario<TInputs,TResults>`: restaurant/domain, inputs/results, assumptions/evidence, model version, created timestamp.

**Do not create a second incompatible shared contract.** Rain can propose Expansion-specific local Zod schemas and a narrowly scoped amendment to the shared proposal. Asilbek and Rain should approve and freeze shared schemas before wiring full cross-domain flows.

### Suggested domain-local contracts (proposals, not required shared types)

```ts
type ExpansionSelection =
  | { kind: "area"; cityId: string; h3Index: string }
  | { kind: "property"; cityId: string; propertyId: string };

type ExpansionScenarioInputs = {
  propertyId: string;
  assumedInitialInvestmentUsd: number;
  assumedIncrementalFixedCostMonthlyUsd: number;
  assumedContributionMarginFraction: number;
  assumedIncrementalSalesMonthlyUsd?: number;
};
```

A complete implementation should validate these with Zod and include identifiers for tenant/restaurant access, sources, version, and user-provided overrides as appropriate.

### Tactical → Expansion handoff (illustrative)

1. Tactical produces a recommendation such as `Consider more seating`, citing the actual input evidence.
2. The owner chooses `Explore expansion instead`.
3. A validated, user-approved action proposes **minimum capacity/size or budget preferences**, if supported by data.
4. Expansion loads with suggested, editable filters — not a hardcoded scored market.
5. Rain's module performs its own geospatial calculations on its own available data.

Example action semantic: `explore_expansion` with a validated payload; it is **not** yet a frozen shared action discriminator.

### Expansion → Tactical handoff (illustrative)

Expansion selects a property and calculates estimated base rent and other **explicit** occupancy cost assumptions. A user may open Tactical's financial comparison with these assumptions preloaded, without asserting that the rent is verified total cost or that demand is known.

## 3. Track priorities and visible proof

The sponsor names and candidate concepts below follow the team's HackPrinceton planning notes; **official track criteria, API permissions and submission rules must be verified at the event**. A sponsor name on the README is not technical proof.

| Track | Owner / priority | Expansion contribution | Evidence of real implementation |
|---|---|---|---|
| **Business & Enterprise (main)** | Whole team / essential | Business-ready evaluate-location + explain financial tradeoffs | End-to-end map → property → simulation → sourced result |
| **CoStar Group** | **Rain / primary sponsor target** | Real permitted Houston/LA commercial property records + meaningful suitability filters/compare | Sponsor-provided SDK/API/dataset loaded, normalized, attributed and used in the map; permission/terms respected |
| **Peri Forward Deployed** | Outreach teammates / strong candidate | Turn actual owner constraints (budget, growth plan) into a bounded location/decision workflow | Consented owner problem, tailored product decision and documented outcome; not a generic cold demo |
| **Capital One Nessie** | Shared with Asilbek / strong candidate | Use verified Nessie sandbox financial data in feasibility simulations | Actual working sandbox API calls, mapped to labeled mock cash/expense inputs; validated calculations |
| **Amazon AI** | Whole team / conditional | Source-grounded natural-language interpretation of selected property tradeoffs | Working AI pipeline **plus** whatever specific service/use the challenge requires |
| **Arlequin AI Track 2** | Mostly Tactical / stretch | Potentially consume graph-derived market patterns if genuinely sourced | Real observed network relations, pipeline and decision relevance; hex scores alone do not establish graph/network compliance |
| **Photon** | Shared / stretch | Advisor may answer selected-site questions through supported channel | Working message transport to the same data/tools; an in-app chat does not count by itself |
| **LangChain Deep Agents** | Shared / stretch | Multi-step property analysis if warranted | Demonstrable multi-step tool workflow and any actual required framework usage |
| **ChatOverflow** | Team development / conditional | Coding workflow rather than Expansion user feature | Actual qualifying integration according to sponsor rules |

### Important sponsor boundaries

- **CoStar:** the user's reference heatmap, an H3 overlay, or fictional property cards **do not satisfy** CoStar integration. Use actual authorized records or report that the integration is not complete. Respect dataset license and avoid committing restricted records to the public hackathon repo.
- **Nessie:** locally created mock bank balances without a Nessie API call are a simulation, not Nessie integration.
- **Amazon:** generic AI usage may not satisfy a technology-specific challenge; verify.
- **Arlequin:** geospatial hex grids are not social networks or observed edges. Don't reinterpret one as the other.
- **Peri:** Rain does not own interviews; engineering should accept the findings once the other teammates deliver them.

## 4. Integration responsibilities

| Artifact / boundary | Responsible party | Agreement needed |
|---|---|---|
| Root `AGENTS.md`, package manager, app shell, tokens | Shared | Both review changes |
| `src/features/tactical/` | Asilbek | Rain should not change |
| `src/features/expansion/` | Rain | Asilbek should not change |
| `src/schemas/shared.ts` | Shared (after agreement) | Freeze Zod schemas and migration plan |
| `src/lib/decision/` | Shared | Clear ownership of each formula, no duplicates |
| `src/lib/integrations/costar*` | Rain (adapter) | API keys, terms, normalized shape |
| `src/lib/integrations/nessie*` | Agreed co-owner | No duplicated service client |
| Restaurant fixture/profile | Shared | Stable restaurant ID / demo labeling |
| Recommendation → Expansion filters | Shared integration PR | Validated action payload, user-controlled navigation |

## 5. Shared UI and interaction grammar

Use the same global navigation, typography, colors, button sizes, cards, source badges, loading indicators, error states and analyst drawer as Tactical.

Shared product concepts are: **Mission → Action → Scenario → Outcome → Evidence**.

- Tactical may render an isometric restaurant scene; Expansion may render a full-width city map.
- Both provide a simple **Game Mode** and optional **Analyst Mode** with exact provenance/calculations.
- One vocabulary: `Observed`, `Calculated`, `Assumption`, `Simulated`, `Unavailable`.
- The user may compare or undo simulations, but a preview never mutates the restaurant's actual business records or a listing's status.

## 6. Delivery and verification checklist

Before calling the Expansion milestone ready:

- [ ] A reviewer can load the Expansion route from the shared app shell.
- [ ] Demo vs real records are unmistakably identified.
- [ ] Area and property selection use different, correctly typed entities.
- [ ] The hex legend and score explanation match the scoring model version.
- [ ] Every scored claim has traceable inputs and missing-factor coverage.
- [ ] Rent units, area, and fixed-cost assumptions are clear.
- [ ] Scenario math is deterministic and tested for missing/invalid values.
- [ ] Working data-provider integration is verified separately from fixture mode.
- [ ] The interface has loading/empty/error states and accessible fallback.
- [ ] Rain's work doesn't break Tactical; shared changes were reviewed.
- [ ] Sponsor-track claims are supported by actual working technology and confirmed rules.
- [ ] A two-minute demonstration reaches a concrete decision without editing code.

## 7. First coordination meeting: decisions to freeze

1. Restaurant ID and profile shape, source IDs and demo markers.
2. Shared mission, recommendation, scenario, and evidence Zod schemas.
3. Unit conventions: dollars, `USD_PER_SF_YEAR`, square feet, fractional vs percentage margins, dates/time zones.
4. Who owns shared decision math and financial integrations.
5. Shared visual tokens/analyst drawer, while allowing layout differences.
6. Runtime source precedence: fixture, live API, cached snapshot and failure behavior.
7. Which sponsor API credentials are actually available and what can be stored or published.
8. One cross-domain demo flow that is achievable before the deadline.

After those are settled, Codex can implement independent Rain/Asilbek feature tasks without re-litigating the foundation.
