# Expansion Map, Scoring and Scenario Engineering Spec

**Status:** proposed method, **not** a claim that the data or APIs are available. Owner: Rain. Must follow shared root `AGENTS.md` and Expansion nested instructions.

## 1. Visual reference and interpretation

The `HackPrinceton F26.pdf`, page 3, contains an illustration of a city street map covered by semitransparent hexagons colored green/yellow/orange/red with point markers. Use this as the **interaction inspiration** for Expansion's geographic decision layer, not as a reliable geographic dataset, verified rating scheme, usable basemap asset, or source of real scores.

Suggested conceptual visual layers (back to front):

1. Basemap from a properly licensed provider.
2. Hex cells: color by **one selected factor or composite suitability score**; gray/pattern when data insufficient.
3. Individual commercial property markers (visually distinct from cells).
4. Hover/selected cell outline and selection panel.
5. Filters, legend, attribution, and source/status indicators.

**Color meanings:** favorable / mixed / less favorable / unavailable; show numbers/text as well. Avoid green = "guaranteed profit." Color ramps and threshold legends should be centralized in the shared design system.

## 2. Proposed technology

- **Map rendering:** Mapbox GL JS with a GeoJSON fill layer and interactive hit testing, *if* approved and a usable key/terms exist. Alternate providers can fit the same adapter; don't hardcode product logic to Mapbox's data shape.
- **Hex grid:** `h3-js` to compute cell IDs and cell boundary polygons. Store H3 IDs with an explicit resolution.
- **Geospatial data format:** typed normalized records on the server; GeoJSON FeatureCollection for rendered fill/pin layers.
- **Data:** authorized CoStar dataset/API where available, plus other properly sourced and licensed inputs if needed; separately labeled demo fixtures for offline work.
- **Calculations:** deterministic TypeScript, pure functions, schema validation and unit tests.
- **Persistence:** shared app's database/storage conventions after schemas are agreed.

A geographic grid is an index/visualization, **not** a validated local-market prediction by itself. A polygon has no business meaning until its properties come from real, documented evidence.

## 3. Area vs property models

The two entities must not be conflated.

```ts
// Domain-local proposal, not yet a finalized shared TypeScript schema.
type ExpansionArea = {
  h3Index: string;
  h3Resolution: number;
  cityId: string;
  score: number | null;
  coverage: number;          // 0..1 by documented policy
  factors: Record<string, number | null>;
  sourceIds: string[];
  scoreModelVersion: string;
  isDemo: boolean;
};

type ExpansionProperty = {
  id: string;
  cityId: string;
  latitude: number;
  longitude: number;
  address?: string;          // only if authorized and supplied
  floorAreaSqFt?: number;
  askingRent?: {
    amount: number;
    unit: "USD_PER_SF_YEAR" | "USD_PER_MONTH";
  };
  availability?: "available" | "unavailable" | "unknown";
  attributes: Record<string, string | number | boolean | null>;
  sourceIds: string[];
  observedAt?: string;
  isDemo: boolean;
};
```

Create dedicated Zod schemas at ingestion/API boundaries. In production, use discriminated unions or normalized columns where the data semantics are known; generic records above illustrate boundaries only.

Area scores and property fit scores must be named separately and use different model IDs if computed differently.

## 4. Provenance requirements

For every visible metric or source-based assertion, preserve:

- source ID/provider, record or query identifier, observation date if known;
- whether the value is **observed, derived, assumed, simulated, or unavailable**;
- unit and granularity (property, H3 cell, city);
- calculation/model version and included/excluded factors;
- explicit `isDemo`/fixture marker;
- attribution and rights/usage constraints where applicable.

If an API fails or a field is missing, surface an error, stale warning, partial-data marker, or `Not scored`. Never silently synthesize credible-looking real property records.

## 5. Deterministic suitability scoring

### What a score can and cannot mean

A high score means **more favorable under this specific factor set, normalization and weights**. It is not a measured probability that a restaurant will succeed and not a forecast of sales or profit.

### Candidate factors (only when data supports them)

| Factor | Direction | Possible raw inputs / caveats |
|---|---|---|
| Occupancy-cost fit | Lower eligible cost better | Asking rent plus documented additional cost assumptions; not total unless inputs support it |
| Space/restaurant fit | Appropriate size/use better | Usable floor area, permitted use, configuration where verified |
| Access/parking | Better measured access preferred | Grounded accessibility/parking attributes; cannot infer from a decorative map |
| Competition intensity | Direction depends on business objective | Actual sourced nearby-competitor records; avoid calling density "demand" |
| Market suitability | Higher supported demand indicator better | Documented independent indicators, coverage and their limitations |

Example **starting weights to discuss**, not required defaults and not evidence of accuracy: occupancy-cost fit 30%, space fit 25%, access 20%, market suitability 15%, competition 10%. If some inputs are unavailable, don't secretly invent the factor or automatically pretend five factors were scored.

### Example algorithm

1. Validate factor raw values and units.
2. Convert each **available factor** to `0..100` with an explicit, versioned, defensible normalization rule; cost should use a budget context, not arbitrary citywide percentile presented as absolute suitability.
3. Compute data coverage from the *intended factors and intended weights*.
4. If coverage is beneath a documented threshold, output `score: null` and `insufficient_data`.
5. Otherwise compute the weighted mean over **available** eligible factors, report the reduced coverage beside the score, and explain omitted factors. Do not quietly compare scores computed from materially different factor sets without a warning.
6. Return factor contributions, missing factors, source IDs and scoring version.

Illustration (not an approved final method):

```ts
function weightedScore(
  items: Array<{ weight: number; score: number | null }>,
  minCoverage = 0.7,
) {
  const possibleWeight = items.reduce((sum, f) => sum + f.weight, 0);
  if (possibleWeight <= 0) return { score: null, coverage: 0 };
  const known = items.filter((f) => f.score !== null);
  const includedWeight = known.reduce((sum, f) => sum + f.weight, 0);
  const coverage = includedWeight / possibleWeight;
  if (coverage < minCoverage || includedWeight === 0) {
    return { score: null, coverage };
  }
  const score = known.reduce((sum, f) => sum + f.weight * f.score!, 0) / includedWeight;
  return { score, coverage };
}
```

Implement validation (`0 <= score <= 100`, nonnegative weights, finite numbers), edge cases, and comparisons with consistent model versions. The code above is **illustrative**, not production-approved until data and policy are known.

### Missing data visual convention

- Valid score with good coverage: color-coded cell + numeric score.
- Partial but permitted coverage: subdued cell + coverage warning.
- Insufficient coverage: gray/unscored (or hatched), label `Insufficient data`.
- Error or unavailable source: distinct status, retry option; never imply no business opportunity.

## 6. Hex aggregation method

For each permitted observation with a valid location:

1. Validate coordinate system, geographic bounds, and data rights.
2. Map coordinate to an H3 cell at the explicitly chosen resolution.
3. Aggregate **only quantities that can legitimately be aggregated**. E.g., listing count may be aggregated if records are unique; area-level demand should not be inferred from random listing density.
4. Derive cell values, coverage and source sets; persist/cache where appropriate.
5. Convert H3 cell boundary to GeoJSON polygons for map rendering and selection.

Do not treat H3 boundaries as census tracts, zip codes, neighborhoods, parcel boundaries, school districts or legally defined areas. If data is coarser than a hex cell, don't pretend to have hyperlocal resolution.

Performance notes: bound the displayed area, cap visible cell count, precompute features, avoid rendering thousands of individual React polygons, use map fill layers, debounce expensive recalculations, and update selected detail on click.

## 7. Property and occupancy calculations

Normalize rental units before using them in finance simulations. For example, if the source lists annual rent per square foot:

```text
baseRentMonthly = floorAreaSqFt × askingRentUsdPerSqFtPerYear / 12
occupancyCostMonthly = baseRentMonthly + explicitly modeled monthly pass-throughs
```

Potential pass-throughs include NNN/CAM/tax/insurance/maintenance, **only if sourced or user-supplied as assumptions**. If missing, present `Base rent only` rather than `Total rent`.

A straightforward **break-even revenue threshold** (not a projected forecast):

```text
requiredMonthlySalesToCoverIncrementalFixedCosts
  = incrementalMonthlyFixedCosts / incrementalContributionMargin

// margin must be > 0; if 0/negative, threshold is not attainable under this model
```

For an expected-profit or payback statement, **additional actual/model-assumed demand and contribution** are needed:

```text
incrementalContributionMonthly
  = assumedIncrementalSalesMonthly × contributionMargin
    - incrementalFixedCostsMonthly

simplePaybackMonths
  = initialInvestment / incrementalContributionMonthly
  // only if positive incremental contribution; else not reachable
```

Do not interpret available cash from Nessie sandbox as actual restaurant cash, and do not infer demand from map color or a high suitability score.

## 8. Game mechanics that respect data

- **Scout:** click a hex → reveal *known* factors and unknowns.
- **Investigate:** select property → show attributes, source, possible use constraints and estimated cost threshold.
- **Experiment:** edit weights, budget, rent assumptions → map/analysis update deterministically.
- **Compare:** two properties or financial scenarios → side-by-side source-backed differences.
- **Save strategy:** store reproducible inputs, results, score model version, evidence references; no physical or financial commitment.
- **Analyst Mode:** inspect all input units, assumptions, sensitivity and limitations.

Animations can visualize state transitions, but should not fabricate success, sales, pedestrian traffic, or complete property interiors.

## 9. Test plan

### Units and calculations
- Zero/missing factor weights, invalid or negative weights, out-of-range normalized scores.
- 100% coverage, partial coverage, below-threshold coverage, and zero eligible factors.
- Identical inputs produce identical scores; weight changes propagate correctly.
- Rent conversion `USD_PER_SF_YEAR` vs `USD_PER_MONTH` and invalid area/rent.
- Zero/negative contribution margin, zero investment, absent incremental sales.
- Baseline/scenario comparison and reversible changes.

### Data and integration
- Fixture and authorized CoStar provider normalize to one schema.
- Missing lat/long or inconsistent unit produce validation failures, not approximate-looking map pins.
- Unsupported API fields are `null`/unknown, not auto-filled guesses.
- Failure/offline/empty states, attribution and demo indicators remain visible.

### UI and accessibility
- Keyboard navigation to a non-map alternative (area/property list).
- Color legend plus numeric/text labels; reduced-motion behavior.
- Selecting a hex shows an Area Scout; selecting a marker shows a Property Scout.
- Result and evidence panel update in sync with selection.
- Mobile-friendly fallback view and map-load failure fallback.

## 10. Expansion demo definition of done

A judge can choose a supported/demo city, inspect one hex and one property, change a weight and a financial assumption, compare two options, and view analyst-grade evidence/limitations **without developer intervention**. If sponsor data is present, its real source and license-compliant use are visible. Otherwise the app is plainly marked as a simulation using fixtures.
