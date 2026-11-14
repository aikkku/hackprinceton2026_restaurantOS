"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Building2,
  Check,
  ChevronRight,
  Compass,
  FlaskConical,
  Layers,
  MapPin,
  PanelRight,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sprout,
  X,
} from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";
import "./expansion.css";
import { ExpansionHeader } from "./expansion-header";
import {
  baseRentMonthly,
  baselineFor,
  calculateScenario,
  FINANCE_VERSION,
  propertyMatches,
} from "../../domain/scenario.ts";
import {
  DEFAULT_WEIGHTS,
  FACTOR_LABELS,
  scoreArea,
  SCORE_VERSION,
} from "../../domain/scoring.ts";
import {
  factorKeys,
  scenarioInputsSchema,
  scenarioSchema,
  type Dataset,
  type ExpansionProperty,
  type Scenario,
  type ScenarioInputs,
  type Weights,
} from "../../domain/schemas.ts";
import { persistScenarios, STORAGE_KEY } from "../storage.ts";
import { ScoutMap, type Selection } from "./map/scout-map";

const money = (value: number | null) =>
  value === null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
const number = (value: number) => new Intl.NumberFormat("en-US").format(value);
type Draft = Record<keyof ScenarioInputs, string>;
const toDraft = (inputs: ScenarioInputs) =>
  Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => [
      key,
      value === null ? "" : String(value),
    ]),
  ) as Draft;

export function ExpansionWorkspace({
  dataset,
  initialSaved,
  initialStorageError,
}: {
  dataset: Dataset;
  initialSaved: Scenario[];
  initialStorageError: string | null;
}) {
  const [cityId, setCityId] = useState(dataset.cities[0].id);
  const [selection, setSelection] = useState<Selection>({
    kind: "area",
    id: dataset.properties[0]?.h3Index ?? dataset.areas[0]?.h3Index ?? "",
  });
  const [budgetInput, setBudgetInput] = useState("8000");
  const [minimumInput, setMinimumInput] = useState("0");
  const [weights, setWeights] = useState<Weights>({ ...DEFAULT_WEIGHTS });
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const [activeProperty, setActiveProperty] =
    useState<ExpansionProperty | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [scenarioLabel, setScenarioLabel] = useState("Opening plan");
  const [saved, setSaved] = useState(initialSaved);
  const [comparison, setComparison] = useState<Scenario[]>([]);
  const [storageError, setStorageError] = useState(initialStorageError);
  const [notice, setNotice] = useState("");
  const [analystOpen, setAnalystOpen] = useState(false);
  const analystRef = useRef<HTMLDialogElement>(null);
  const analystTrigger = useRef<HTMLButtonElement>(null);
  const budget = Number(budgetInput);
  const minimumArea = Number(minimumInput);
  const filtersValid =
    budgetInput.trim() !== "" &&
    minimumInput.trim() !== "" &&
    Number.isFinite(budget) &&
    budget > 0 &&
    Number.isFinite(minimumArea) &&
    minimumArea >= 0;
  const scoringBudget = filtersValid ? budget : 8000;
  const areas = dataset.areas.filter((a) => a.cityId === cityId);
  const filteredProperties = useMemo(
    () =>
      dataset.properties.filter(
        (p) =>
          p.cityId === cityId &&
          filtersValid &&
          propertyMatches(p, budget, minimumArea),
      ),
    [dataset, cityId, filtersValid, budget, minimumArea],
  );
  const properties = filteredProperties.filter(
    (p) => !areaFilter || p.h3Index === areaFilter,
  );
  const selectedProperty =
    selection.kind === "property"
      ? dataset.properties.find((p) => p.id === selection.id)
      : undefined;
  const selectedArea = areas.find(
    (a) =>
      a.h3Index ===
      (selection.kind === "area" ? selection.id : selectedProperty?.h3Index),
  );
  const areaResult = selectedArea
    ? scoreArea(selectedArea, weights, scoringBudget)
    : null;
  const parsedInputs = draft
    ? scenarioInputsSchema.safeParse(
        Object.fromEntries(
          Object.entries(draft).map(([key, value]) => [
            key,
            key === "assumedSalesMonthly" && !value.trim()
              ? null
              : value.trim()
                ? Number(value)
                : NaN,
          ]),
        ),
      )
    : null;
  let inputError: string | null = null;
  let results: ReturnType<typeof calculateScenario> | null = null;
  if (parsedInputs?.success) {
    try {
      results = calculateScenario(parsedInputs.data);
    } catch {
      inputError = "These assumptions exceed the supported numeric range.";
    }
  } else if (parsedInputs)
    inputError =
      "Enter finite, nonnegative amounts and a contribution margin from 0 to 1. Only assumed sales may be blank.";

  useEffect(() => {
    if (analystOpen) analystRef.current?.showModal();
    else if (analystRef.current?.open) analystRef.current.close();
  }, [analystOpen]);

  function select(next: Selection) {
    setSelection(next);
    setNotice("");
  }
  function tryProperty(property: ExpansionProperty) {
    setActiveProperty(property);
    setDraft(toDraft(baselineFor(property)));
    setScenarioLabel(`${property.name} plan`);
    setNotice("");
    requestAnimationFrame(() =>
      document.getElementById("scenario-workbench")?.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      }),
    );
  }
  function snapshot(): Scenario | null {
    if (
      !activeProperty ||
      !parsedInputs?.success ||
      !results ||
      !filtersValid ||
      !scenarioLabel.trim()
    )
      return null;
    return scenarioSchema.parse({
      schemaVersion: 1,
      modelVersion: FINANCE_VERSION,
      scoreModelVersion: SCORE_VERSION,
      id: crypto.randomUUID(),
      restaurantId: "demo-restaurant",
      propertyId: activeProperty.id,
      propertyName: activeProperty.name,
      cityId,
      label: scenarioLabel.trim(),
      createdAt: new Date().toISOString(),
      isDemo: true,
      inputs: parsedInputs.data,
      results,
      weights,
      monthlyBudget: budget,
      sourceIds: [
        ...new Set([...activeProperty.sourceIds, "demo-area-indices"]),
      ],
      assumptionNotes: [
        "All property and area data is fictional.",
        "All editable financial fields are planning assumptions, including any rent override.",
        "Pass-throughs, other fixed costs, contribution margin, investment and working capital start with illustrative assumptions.",
        "Demand is unknown. Required sales is a threshold; contribution excludes financing, taxes and unmodeled costs. Payback excludes working capital.",
      ],
    });
  }
  function addComparison(value: Scenario) {
    if (comparison.length >= 2) {
      setNotice(
        "Two scenarios are already in comparison. Remove one before adding another.",
      );
      return;
    }
    setComparison((current) => [...current, value]);
    setNotice("Scenario added to comparison.");
  }
  function save() {
    const value = snapshot();
    if (!value) return;
    if (saved.length >= 50) {
      setNotice(
        "The demo stores up to 50 snapshots. Remove one before saving.",
      );
      return;
    }
    const next = [value, ...saved];
    try {
      persistScenarios(localStorage, next);
      setSaved(next);
      setNotice(
        "Scenario saved on this browser. No property commitment was made.",
      );
    } catch {
      setNotice(
        "Saving failed. Browser storage may be unavailable or full; your draft is intact.",
      );
    }
  }
  function removeSaved(id: string) {
    const next = saved.filter((s) => s.id !== id);
    try {
      persistScenarios(localStorage, next);
      setSaved(next);
      setNotice("Saved snapshot removed.");
    } catch {
      setNotice(
        "Could not update browser storage. Saved snapshots are unchanged.",
      );
    }
  }
  function restore(value: Scenario) {
    const property = dataset.properties.find((p) => p.id === value.propertyId);
    if (!property) {
      setNotice("The original property is unavailable.");
      return;
    }
    setCityId(value.cityId);
    setSelection({ kind: "property", id: property.id });
    setAreaFilter(null);
    setBudgetInput(String(value.monthlyBudget));
    setWeights(value.weights);
    setActiveProperty(property);
    setDraft(toDraft(value.inputs));
    setScenarioLabel(value.label);
    setNotice(
      "Saved inputs restored. Snapshot results are reproducible under the recorded model.",
    );
  }
  function clearStorage() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setSaved([]);
      setStorageError(null);
      setNotice("Saved demo data cleared.");
    } catch {
      setNotice(
        "Browser storage is still unavailable. You can continue comparing without saving.",
      );
    }
  }

  return (
    <div className="expansion-app">
      <ExpansionHeader />
      <main className="workspace-main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">YOUR NEXT CHAPTER</p>
            <h1>A little scouting. A clearer decision.</h1>
            <p>
              Explore a place, test the numbers, find your next possibility.
            </p>
          </div>
          <button
            className="secondary analyst-trigger"
            ref={analystTrigger}
            onClick={() => setAnalystOpen(true)}
          >
            <PanelRight size={16} /> View analysis
          </button>
        </div>
        <div className="mission-strip">
          <span className="mission-icon">
            <Compass size={23} />
          </span>
          <div>
            <strong>Scout a new restaurant site</strong>
            <span>
              Find a space that fits your budget. Compare two opening plans.
            </span>
          </div>
          <ol className="journey">
            <li className="current">01 Scout</li>
            <ChevronRight size={13} />
            <li>02 Experiment</li>
            <ChevronRight size={13} />
            <li>03 Compare</li>
          </ol>
        </div>
        <div className="source-banner">
          <FlaskConical size={15} />
          <span>
            <strong>Fictional Houston demo.</strong> All listings and area
            indicators are simulated. No CoStar integration or live
            availability.
          </span>
        </div>
        <section className="explorer" aria-label="Expansion explorer">
          <aside className="filter-rail">
            <div className="section-caption">
              <SlidersHorizontal size={15} />
              <h2>Scout settings</h2>
            </div>
            <label className="field">
              Your market
              <select
                aria-label="City"
                value={cityId}
                onChange={(e) => {
                  const id = e.target.value;
                  setCityId(id);
                  setAreaFilter(null);
                  setActiveProperty(null);
                  setDraft(null);
                  setSelection({
                    kind: "area",
                    id:
                      dataset.areas.find((a) => a.cityId === id)?.h3Index ?? "",
                  });
                }}
              >
                {dataset.cities.map((city) => (
                  <option key={city.id} value={city.id}>
                    {city.name} · Demo
                  </option>
                ))}
              </select>
            </label>
            <NumericField
              label="Monthly base-rent budget"
              value={budgetInput}
              onChange={setBudgetInput}
              suffix="USD / month"
              min={1}
            />
            <NumericField
              label="Minimum space"
              value={minimumInput}
              onChange={setMinimumInput}
              suffix="sq ft"
            />
            {!filtersValid && (
              <p role="alert" className="field-error">
                Enter a positive budget and a nonnegative minimum area. Scores
                retain the $8,000 demo budget until corrected.
              </p>
            )}
            <p className="small-note">
              Budget filters base rent only. Unknown rent or size is excluded;
              availability may be unknown.
            </p>
            <div className="rail-divider" />
            <div className="section-caption">
              <Layers size={15} />
              <h2>Area priorities</h2>
            </div>
            <p className="small-note">
              Editable weights · fictional indicators
            </p>
            {factorKeys.map((key) => (
              <label key={key} className="weight-field">
                <span>
                  {FACTOR_LABELS[key]}
                  <output>{weights[key]}</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={weights[key]}
                  aria-label={`${FACTOR_LABELS[key]} weight`}
                  onChange={(e) =>
                    setWeights({ ...weights, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
            <button
              className="text-button reset-weights"
              onClick={() => setWeights({ ...DEFAULT_WEIGHTS })}
            >
              <RotateCcw size={13} /> Reset priorities
            </button>
            <div className="rail-tip">
              <Sprout size={20} />
              <strong>Scout with curiosity.</strong>
              <p>
                A favorable area score is a comparison under these weights,
                never a promise of success.
              </p>
            </div>
          </aside>
          <div className="map-column">
            <div className="map-heading">
              <div>
                <h2>Houston scouting grounds</h2>
                <span>
                  {areas.length} analysis cells · {filteredProperties.length}{" "}
                  matching demo spaces
                </span>
              </div>
              <span className="live-label">2D EXPLORER</span>
            </div>
            {areas.length ? (
              <ScoutMap
                dataset={dataset}
                cityId={cityId}
                properties={filteredProperties}
                weights={weights}
                budget={scoringBudget}
                selection={selection}
                onSelect={select}
              />
            ) : (
              <div className="empty-state">
                No supported area data for this market.
              </div>
            )}
            <div className="map-legend">
              <span>Area suitability</span>
              <span>
                <i className="legend-dot high" /> 70–100 Favorable
              </span>
              <span>
                <i className="legend-dot mid" /> 40–69 Mixed
              </span>
              <span>
                <i className="legend-dot low" /> 0–39 Less favorable
              </span>
              <span>
                <i className="legend-dot unavailable" /> Unscored
              </span>
            </div>
            <p className="map-footnote">
              Coverage below 70% stays unscored. Partial coverage uses a lighter
              fill. H3 cells are analysis regions, not neighborhood boundaries.
            </p>
          </div>
          <aside
            className="inspector"
            aria-label={selectedProperty ? "Property Scout" : "Area Scout"}
          >
            <div className="inspector-kicker">
              <span className="mini-icon">
                {selectedProperty ? (
                  <Building2 size={16} />
                ) : (
                  <Layers size={16} />
                )}
              </span>
              {selectedProperty ? "PROPERTY SCOUT" : "AREA SCOUT"}
              <span className="tiny-badge">Demo</span>
            </div>
            {selectedProperty ? (
              <>
                <h2>{selectedProperty.name}</h2>
                <p className="inspector-subtitle">
                  Fictional test space · Houston
                </p>
                <div className="property-art" aria-hidden="true">
                  <Building2 size={58} strokeWidth={1} />
                  <span>DEMO SPACE</span>
                </div>
                <div className="metric-grid">
                  <Metric
                    label="Floor area · simulated"
                    value={
                      selectedProperty.floorAreaSqFt === null
                        ? "Unavailable"
                        : `${number(selectedProperty.floorAreaSqFt)} sq ft`
                    }
                  />
                  <Metric
                    label="Base rent · derived"
                    value={`${money(baseRentMonthly(selectedProperty.askingRent, selectedProperty.floorAreaSqFt))} / mo`}
                  />
                </div>
                <dl className="property-details">
                  <div>
                    <dt>Asking basis · simulated</dt>
                    <dd>
                      {selectedProperty.askingRent
                        ? `${money(selectedProperty.askingRent.amount)}${selectedProperty.askingRent.unit === "USD_PER_SF_YEAR" ? " / SF / year" : " / month"}`
                        : "Unavailable"}
                    </dd>
                  </div>
                  <div>
                    <dt>Previous use · simulated</dt>
                    <dd>{selectedProperty.previousUse ?? "Unavailable"}</dd>
                  </div>
                  <div>
                    <dt>Parking · simulated</dt>
                    <dd>{selectedProperty.parkingSpaces ?? "Unavailable"}</dd>
                  </div>
                  <div>
                    <dt>Availability · simulated</dt>
                    <dd>
                      {selectedProperty.availability === "unknown"
                        ? "Unknown — verify first"
                        : selectedProperty.availability}
                    </dd>
                  </div>
                </dl>
                {!filteredProperties.some(
                  (p) => p.id === selectedProperty.id,
                ) && (
                  <p className="warning">
                    This selection is outside your current filters.
                  </p>
                )}
                <p className="small-note">
                  Base rent excludes pass-throughs. This property has no
                  verified fit score, lease status, or permitted use.
                </p>
                <button
                  className="primary full"
                  onClick={() => tryProperty(selectedProperty)}
                  disabled={
                    baseRentMonthly(
                      selectedProperty.askingRent,
                      selectedProperty.floorAreaSqFt,
                    ) === null
                  }
                >
                  Try opening here <ArrowRight size={15} />
                </button>
                <button
                  className="text-button full"
                  onClick={() =>
                    setSelection({ kind: "area", id: selectedProperty.h3Index })
                  }
                >
                  <ArrowLeft size={13} /> Inspect this area
                </button>
                <p className="source-line">
                  Source: RestaurantOS fixtures · date unavailable
                </p>
              </>
            ) : selectedArea && areaResult ? (
              <>
                <h2>{selectedArea.label}</h2>
                <p className="inspector-subtitle">
                  Approximate H3 analysis area · resolution 8
                </p>
                <div className="score-orb">
                  <span>
                    {areaResult.score === null
                      ? "—"
                      : Math.round(areaResult.score)}
                  </span>
                  <div>
                    {areaResult.score === null
                      ? "Insufficient data"
                      : "Area suitability / 100"}
                    <small>Derived from fictional inputs</small>
                  </div>
                </div>
                <div className="coverage-row">
                  <span>Weighted data coverage</span>
                  <strong>{Math.round(areaResult.coverage * 100)}%</strong>
                </div>
                <div className="coverage-track">
                  <span style={{ width: `${areaResult.coverage * 100}%` }} />
                </div>
                <div className="factor-list">
                  {factorKeys.map((key) => (
                    <div key={key}>
                      <span>{FACTOR_LABELS[key]}</span>
                      <strong>
                        {areaResult.factors[key] === null
                          ? "Unavailable"
                          : `${Math.round(areaResult.factors[key]!)} / 100`}
                      </strong>
                    </div>
                  ))}
                </div>
                <p className="warning">
                  Demo indices are illustrative. Missing factors are omitted,
                  never assigned a neutral value.
                </p>
                <div className="area-count">
                  <Building2 size={17} />
                  <strong>
                    {
                      filteredProperties.filter(
                        (p) => p.h3Index === selectedArea.h3Index,
                      ).length
                    }
                  </strong>{" "}
                  matching spaces in this area
                </div>
                <button
                  className="primary full"
                  onClick={() => {
                    setAreaFilter(selectedArea.h3Index);
                    document
                      .getElementById("property-list")
                      ?.scrollIntoView({ block: "nearest" });
                  }}
                >
                  View properties in this area <ArrowDown size={15} />
                </button>
                <p className="source-line">
                  Source: RestaurantOS fixtures · date unavailable
                </p>
              </>
            ) : (
              <div className="empty-state">
                Select an area or property to inspect.
              </div>
            )}
          </aside>
        </section>

        <section className="discovery-lists">
          <div className="property-list-section" id="property-list">
            <div className="section-heading">
              <div>
                <p className="eyebrow">THE SHORTLIST STARTS HERE</p>
                <h2>Spaces worth a closer look</h2>
              </div>
              <span>{properties.length} matches</span>
            </div>
            {areaFilter && (
              <button
                className="filter-chip"
                onClick={() => setAreaFilter(null)}
              >
                Selected area only <X size={13} /> Show all areas
              </button>
            )}
            <div className="property-cards">
              {properties.map((property) => (
                <button
                  key={property.id}
                  className={`property-card ${selection.id === property.id ? "selected" : ""}`}
                  onClick={() => select({ kind: "property", id: property.id })}
                >
                  <div className="property-card-top">
                    <span className="property-number">
                      {filteredProperties.findIndex(
                        (p) => p.id === property.id,
                      ) + 1}
                    </span>
                    <span className="tiny-badge">Fictional</span>
                    <ArrowRight size={16} />
                  </div>
                  <Building2 size={28} strokeWidth={1.3} />
                  <h3>{property.name}</h3>
                  <p>
                    {number(property.floorAreaSqFt!)} sq ft <span>·</span>{" "}
                    {property.availability === "unknown"
                      ? "Status unknown"
                      : "Demo availability"}
                  </p>
                  <strong>
                    {money(
                      baseRentMonthly(
                        property.askingRent,
                        property.floorAreaSqFt,
                      ),
                    )}
                    <small> base rent / mo</small>
                  </strong>
                  <span className="card-cta">
                    Inspect property <ChevronRight size={13} />
                  </span>
                </button>
              ))}
            </div>
            {!properties.length && (
              <div className="empty-state">
                <Building2 size={25} />
                <h3>No spaces match these filters.</h3>
                <p>
                  Try another area, a higher base-rent budget, or a smaller
                  minimum size.
                </p>
                <button
                  className="secondary"
                  onClick={() => {
                    setAreaFilter(null);
                    setBudgetInput("8000");
                    setMinimumInput("0");
                  }}
                >
                  Reset property filters
                </button>
              </div>
            )}
          </div>
          <details className="area-list">
            <summary>
              <Layers size={16} /> Browse areas without the map{" "}
              <span>{areas.length}</span>
            </summary>
            <p className="small-note">
              Keyboard-accessible area selection. Different missing-factor sets
              make scores less comparable.
            </p>
            <div className="area-buttons">
              {areas.map((area) => {
                const result = scoreArea(area, weights, scoringBudget);
                return (
                  <button
                    key={area.h3Index}
                    aria-pressed={
                      selection.kind === "area" && selection.id === area.h3Index
                    }
                    onClick={() => select({ kind: "area", id: area.h3Index })}
                  >
                    <span>
                      {area.label}
                      <small>
                        {Math.round(result.coverage * 100)}% coverage
                      </small>
                    </span>
                    <strong>
                      {result.score === null
                        ? "Unscored"
                        : Math.round(result.score)}
                    </strong>
                  </button>
                );
              })}
            </div>
          </details>
        </section>

        <section id="scenario-workbench" className="scenario-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">TRY THE POSSIBILITY</p>
              <h2>Your opening experiment</h2>
            </div>
            <span className="assumption-pill">
              <FlaskConical size={13} /> What-if scenario
            </span>
          </div>
          {!activeProperty || !draft ? (
            <div className="scenario-placeholder">
              <span className="round-icon">
                <FlaskConical size={26} />
              </span>
              <div>
                <h3>A new location starts with a what-if.</h3>
                <p>
                  Select a space, then choose “Try opening here” to explore its
                  costs.
                </p>
              </div>
              <MapPin size={28} />
            </div>
          ) : (
            <>
              <div className="scenario-top">
                <div>
                  <h3>{activeProperty.name}</h3>
                  <p>
                    All editable values are assumptions. Source base rent:{" "}
                    {money(
                      baseRentMonthly(
                        activeProperty.askingRent,
                        activeProperty.floorAreaSqFt,
                      ),
                    )}{" "}
                    / mo.
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    setDraft(toDraft(baselineFor(activeProperty)));
                    setNotice(
                      "Scenario reset to illustrative baseline assumptions.",
                    );
                  }}
                >
                  <RotateCcw size={14} /> Reset to baseline
                </button>
              </div>
              <div className="scenario-layout">
                <div className="scenario-inputs">
                  <label className="field">
                    Scenario name
                    <input
                      value={scenarioLabel}
                      maxLength={100}
                      onChange={(e) => setScenarioLabel(e.target.value)}
                    />
                  </label>
                  <div className="input-grid">
                    <NumericField
                      label="Base rent"
                      value={draft.baseRentMonthly}
                      onChange={(value) =>
                        setDraft({ ...draft, baseRentMonthly: value })
                      }
                      suffix="USD / month"
                    />
                    <NumericField
                      label="Pass-throughs"
                      value={draft.passThroughMonthly}
                      onChange={(value) =>
                        setDraft({ ...draft, passThroughMonthly: value })
                      }
                      suffix="USD / month"
                    />
                    <NumericField
                      label="Other fixed costs"
                      value={draft.otherFixedMonthly}
                      onChange={(value) =>
                        setDraft({ ...draft, otherFixedMonthly: value })
                      }
                      suffix="USD / month"
                    />
                    <NumericField
                      label="Contribution margin"
                      value={draft.contributionMargin}
                      onChange={(value) =>
                        setDraft({ ...draft, contributionMargin: value })
                      }
                      suffix="fraction · 0–1"
                      max={1}
                      step="0.01"
                    />
                    <NumericField
                      label="Initial investment"
                      value={draft.initialInvestment}
                      onChange={(value) =>
                        setDraft({ ...draft, initialInvestment: value })
                      }
                      suffix="USD · upfit / deposit"
                    />
                    <NumericField
                      label="Working capital"
                      value={draft.workingCapital}
                      onChange={(value) =>
                        setDraft({ ...draft, workingCapital: value })
                      }
                      suffix="USD · reserve"
                    />
                    <NumericField
                      label="Assumed monthly sales (optional)"
                      value={draft.assumedSalesMonthly}
                      onChange={(value) =>
                        setDraft({ ...draft, assumedSalesMonthly: value })
                      }
                      suffix="USD · blank = unknown demand"
                      optional
                    />
                  </div>
                  <p className="small-note">
                    Contribution margin is the share of sales remaining after
                    variable costs. Other fixed costs must exclude rent and
                    pass-throughs to avoid double counting.
                  </p>
                  {inputError && (
                    <p role="alert" className="field-error">
                      {inputError}
                    </p>
                  )}
                  {!scenarioLabel.trim() && (
                    <p className="field-error">
                      Enter a scenario name before comparing or saving.
                    </p>
                  )}
                </div>
                <div className="outcome-panel" aria-live="polite">
                  <p className="eyebrow">DERIVED · HYPOTHETICAL</p>
                  <h3>Sales you would need</h3>
                  <div className="required-sales">
                    {results?.requiredSalesMonthly !== null && results
                      ? money(results.requiredSalesMonthly)
                      : "Unavailable"}
                  </div>
                  <p>per month to cover modeled fixed costs</p>
                  {results && parsedInputs?.success && (
                    <>
                      <div className="outcome-lines">
                        <Metric
                          label="Occupancy · modeled"
                          value={`${money(results.occupancyMonthly)} / mo`}
                        />
                        <Metric
                          label="Total fixed costs · modeled"
                          value={`${money(results.fixedMonthly)} / mo`}
                        />
                        <Metric
                          label="Initial cash · investment + reserve"
                          value={money(results.initialCashRequired)}
                        />
                      </div>
                      {parsedInputs.data.contributionMargin === 0 && (
                        <p className="warning">
                          No sales threshold is attainable at a zero
                          contribution margin.
                        </p>
                      )}
                      {parsedInputs.data.assumedSalesMonthly === null ? (
                        <p className="outcome-caveat">
                          Demand is unknown. Enter an explicit sales assumption
                          to explore contribution and payback.
                        </p>
                      ) : (
                        <div className="outcome-lines">
                          <Metric
                            label="Contribution after fixed costs"
                            value={`${money(results.contributionAfterFixedMonthly)} / mo`}
                          />
                          <Metric
                            label="Simple investment payback"
                            value={
                              results.paybackMonths === null
                                ? "Not reachable"
                                : `${number(Math.round(results.paybackMonths * 10) / 10)} months`
                            }
                          />
                          <p className="small-note">
                            Assumed sales, not a forecast. Excludes financing,
                            taxes, and unmodeled costs. Payback excludes working
                            capital.
                          </p>
                        </div>
                      )}
                    </>
                  )}
                  {inputError && (
                    <p className="field-error">
                      Correct the inputs to calculate a result.
                    </p>
                  )}
                </div>
              </div>
              <div className="scenario-actions">
                <p>
                  <Check size={15} /> Preview only. No actual business records
                  change.
                </p>
                <button
                  className="secondary"
                  disabled={!results || !filtersValid || !scenarioLabel.trim()}
                  onClick={() => {
                    const s = snapshot();
                    if (s) addComparison(s);
                  }}
                >
                  <Plus size={15} /> Compare scenario
                </button>
                <button
                  className="primary"
                  disabled={
                    !results ||
                    !!storageError ||
                    !filtersValid ||
                    !scenarioLabel.trim()
                  }
                  onClick={save}
                >
                  <Bookmark size={15} /> Save scenario
                </button>
              </div>
            </>
          )}
        </section>

        <div className="bottom-grid">
          <section className="comparison-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">SIDE BY SIDE</p>
                <h2>Compare your options</h2>
              </div>
              <span>{comparison.length} / 2</span>
            </div>
            {!comparison.length ? (
              <p className="empty-copy">
                Add a scenario from your experiment or saved plans. Compare the
                same assumptions across different spaces.
              </p>
            ) : (
              <>
                <p className="small-note">
                  Compare cost thresholds, not success probabilities. Area
                  scores can use different factor coverage.
                </p>
                <div className="comparison-grid">
                  {comparison.map((s, index) => (
                    <article key={`${s.id}-${index}`} className="compare-card">
                      <button
                        aria-label={`Remove ${s.label} from comparison`}
                        className="icon-button"
                        onClick={() =>
                          setComparison(
                            comparison.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <X size={15} />
                      </button>
                      <span className="tiny-badge">Demo snapshot</span>
                      <h3>{s.label}</h3>
                      <p>{s.propertyName}</p>
                      <Metric
                        label="Required monthly sales"
                        value={money(s.results.requiredSalesMonthly)}
                      />
                      <Metric
                        label="Fixed costs / month"
                        value={money(s.results.fixedMonthly)}
                      />
                      <Metric
                        label="Initial cash"
                        value={money(s.results.initialCashRequired)}
                      />
                      <Metric
                        label="Contribution margin"
                        value={`${Math.round(s.inputs.contributionMargin * 100)}%`}
                      />
                      <Metric
                        label="Assumed monthly sales"
                        value={money(s.inputs.assumedSalesMonthly)}
                      />
                      <Metric
                        label="Contribution after fixed costs"
                        value={money(s.results.contributionAfterFixedMonthly)}
                      />
                      <Metric
                        label="Investment payback"
                        value={
                          s.results.paybackMonths === null
                            ? "Unavailable / not reachable"
                            : `${Math.round(s.results.paybackMonths * 10) / 10} mo`
                        }
                      />
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
          <section className="saved-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">COME BACK TO A POSSIBILITY</p>
                <h2>Saved strategies</h2>
              </div>
              <Bookmark size={19} />
            </div>
            <p className="small-note">
              Demo snapshots stored only in this browser · up to 50 ·{" "}
              {saved.length} saved
            </p>
            {storageError && (
              <div role="alert" className="warning">
                {storageError}
                <button className="text-button" onClick={clearStorage}>
                  Clear saved demo data
                </button>
              </div>
            )}
            {!saved.length && !storageError && (
              <p className="empty-copy">
                Your saved opening plans will appear here. Each preserves its
                assumptions, results, evidence and model version.
              </p>
            )}
            <div className="saved-list">
              {saved.map((s) => (
                <article key={s.id}>
                  <div>
                    <strong>{s.label}</strong>
                    <p>
                      {s.propertyName} · {money(s.results.requiredSalesMonthly)}{" "}
                      required sales / mo
                    </p>
                  </div>
                  <div className="saved-actions">
                    <button className="text-button" onClick={() => restore(s)}>
                      Restore
                    </button>
                    <button
                      className="text-button"
                      disabled={comparison.length >= 2}
                      onClick={() => addComparison(s)}
                    >
                      Compare
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Delete saved ${s.label}`}
                      onClick={() => removeSaved(s.id)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
        <div
          role="status"
          aria-live="polite"
          className={notice ? "notice-toast" : "sr-only"}
        >
          {notice}
        </div>
        <footer className="workspace-footer">
          <span>
            <Sprout size={14} /> Make room for an informed next step.
          </span>
          <span>RestaurantOS · Expansion MVP · Demo data only</span>
        </footer>
      </main>
      <dialog
        className="analyst-drawer"
        ref={analystRef}
        onCancel={() => setAnalystOpen(false)}
        onClose={() => {
          setAnalystOpen(false);
          analystTrigger.current?.focus();
        }}
        aria-labelledby="analyst-title"
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">BEHIND THE POSSIBILITY</p>
            <h2 id="analyst-title">Analyst Details</h2>
          </div>
          <button
            className="icon-button"
            autoFocus
            aria-label="Close analysis"
            onClick={() => setAnalystOpen(false)}
          >
            <X />
          </button>
        </div>
        <div className="drawer-body">
          <span className="demo-pill">Demo · fictional data</span>
          <h3>Area scoring</h3>
          <p>
            Model: <code>{SCORE_VERSION}</code>. H3 resolution 8. Weighted mean
            of available factors; minimum weighted coverage 70%. Zero total
            weight is unscored. Missing factors are excluded from the mean and
            included in the coverage denominator.
          </p>
          <p>
            Demand, similarity and competition are synthetic 0–100 favorable
            indices with identity normalization; they are not measurements or
            empirical predictions. Base-rent fit = clamp(100 × (1 − fictional
            area monthly rent ÷ (2 × budget)), 0, 100). Higher is favorable for
            every normalized factor. Budget: {money(scoringBudget)} / month.
          </p>
          {selectedArea && areaResult && (
            <>
              <h3>{selectedArea.label}</h3>
              <p className="mono">{selectedArea.h3Index}</p>
              <p>
                Fictional area base rent:{" "}
                {money(selectedArea.averageBaseRentMonthly)} / month. Coverage:{" "}
                {Math.round(areaResult.coverage * 100)}%. Missing:{" "}
                {areaResult.missing.map((k) => FACTOR_LABELS[k]).join(", ") ||
                  "none"}
                .
              </p>
              <table>
                <caption>
                  Current factor decomposition · derived from simulated inputs
                </caption>
                <thead>
                  <tr>
                    <th>Factor</th>
                    <th>Index / 100</th>
                    <th>Weight</th>
                    <th>Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {factorKeys.map((key) => (
                    <tr key={key}>
                      <td>{FACTOR_LABELS[key]}</td>
                      <td>
                        {areaResult.factors[key] === null
                          ? "Unavailable"
                          : areaResult.factors[key]!.toFixed(1)}
                      </td>
                      <td>{weights[key]}</td>
                      <td>
                        {areaResult.contributions[key] === null
                          ? "Omitted"
                          : Number(areaResult.contributions[key]).toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <h3>Financial method</h3>
          <p>
            Model: <code>{FINANCE_VERSION}</code>. All currency is USD, area is
            sq ft, margin is a fraction, and time is months.
          </p>
          <ul>
            <li>
              Base monthly rent = annual rent per sq ft × floor area ÷ 12, or
              supplied monthly rent.
            </li>
            <li>Occupancy = base rent + assumed pass-throughs.</li>
            <li>Fixed costs = occupancy + other assumed fixed costs.</li>
            <li>
              Required sales = fixed costs ÷ contribution margin. Zero margin
              has no attainable threshold.
            </li>
            <li>
              Contribution after fixed costs = assumed sales × margin − fixed
              costs.
            </li>
            <li>
              Simple payback = initial investment ÷ positive monthly
              contribution after fixed costs.
            </li>
            <li>
              Initial cash = initial investment + working capital. Reserves are
              not a monthly expense.
            </li>
          </ul>
          <p>
            Sales are never inferred from a score. Payback is not time to
            operating break-even. Financing, taxes, lease timing, licensing,
            zoning and unmodeled costs are excluded. All edited financial inputs
            are assumptions; results are derived.
          </p>
          {parsedInputs?.success && (
            <>
              <h3>Current assumptions</h3>
              <dl className="property-details">
                {Object.entries(parsedInputs.data).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key} · assumed</dt>
                    <dd>
                      {value === null
                        ? "Unavailable"
                        : key === "contributionMargin"
                          ? value
                          : money(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <h3>Evidence and provenance</h3>
          <p>
            No incoming property dataset has been integrated. No sponsor API or
            AI model is called. Source observation dates are unavailable.
            Fictional area rent aggregates do not represent the average of these
            four demo property records.
          </p>
          {dataset.evidence
            .filter(
              (source) =>
                source.id === "demo-area-indices" ||
                selectedProperty?.sourceIds.includes(source.id) ||
                activeProperty?.sourceIds.includes(source.id),
            )
            .map((source) => (
              <article className="evidence-item" key={source.id}>
                <strong>{source.label}</strong>
                <p>
                  {source.provider} · {source.origin} · Demo
                </p>
                <code>
                  {source.id} / {source.recordId}
                </code>
                <p>{source.notes}</p>
                <p>{source.rights} Observation date: unavailable.</p>
              </article>
            ))}
          <p>
            Snapshot schema version 1. Snapshots store inputs, exact results,
            score weights/budget, evidence IDs and model versions. Browser
            storage is not a backed-up account or a lease commitment.
          </p>
        </div>
      </dialog>
    </div>
  );
}

function NumericField({
  label,
  value,
  onChange,
  suffix,
  min = 0,
  max,
  step = "any",
  optional = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix: string;
  min?: number;
  max?: number;
  step?: string;
  optional?: boolean;
}) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      {label}
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        required={!optional}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={`${id}-unit`}
      />
      <small id={`${id}-unit`}>{suffix}</small>
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
