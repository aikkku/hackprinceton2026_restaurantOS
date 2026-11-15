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
  ClipboardList,
  Compass,
  FlaskConical,
  Layers,
  MapPin,
  PanelRight,
  Pencil,
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
  LOCAL_SCORE_VERSION,
} from "../../domain/scoring.ts";
import {
  factorKeys,
  scenarioInputsSchema,
  scenarioSchema,
  type Dataset,
  type ExpansionProperty,
  type ExpansionArea,
  type Evidence,
  type Scenario,
  type ScenarioInputs,
  type Weights,
} from "../../domain/schemas.ts";
import { persistScenarios, storageKeyFor } from "../storage.ts";
import {
  cancelProfileRun,
  createProfileRun,
  getProfileRun,
  getRunCandidatesRequest,
  loadLocalArea,
  loadLocalProperty,
  LocalDataError as ClientDataError,
  type Viewport,
} from "../data/local-market.ts";
import type { QueryCoverage } from "../../domain/local-data.ts";
import { requirementDisplayValue, type ProfileRevision } from "../../domain/requirements.ts";
import type { AssessedCandidate, CandidateGroup } from "../../domain/matching.ts";
import type { ExcludedCandidate, RunRecord } from "../../domain/runs.ts";
import { AssessmentList, RunSearch } from "./run-search";
import { AgentRunSection } from "./agent-run";
import { DecisionWorkbench } from "./decision-workbench";
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
const planningDraft = (property: ExpansionProperty): Draft => {
  const rent = baseRentMonthly(property.askingRent, property.floorAreaSqFt);
  return rent === null ? { ...toDraft({ baseRentMonthly: 0, passThroughMonthly: 750, otherFixedMonthly: 6000, contributionMargin: 0.35, initialInvestment: 90000, workingCapital: 25000, assumedSalesMonthly: null }), baseRentMonthly: "" } : toDraft(baselineFor(property));
};

/** Map a mappable run candidate to the shared property shape for map/list/inspector. */
function candidateProperty(assessed: AssessedCandidate): ExpansionProperty {
  const c = assessed.candidate;
  const rent = c.rent;
  let askingRent: ExpansionProperty["askingRent"] = null;
  if (
    rent &&
    rent.low !== null &&
    rent.high !== null &&
    rent.low === rent.high &&
    rent.currencyCode === 1 &&
    rent.measurementCode === 1 &&
    (rent.rateBasisCode === 1 || rent.rateBasisCode === 2)
  ) {
    askingRent = {
      amount: rent.rateBasisCode === 1 ? rent.low * 12 : rent.low,
      unit: "USD_PER_SF_YEAR",
    };
  }
  const listingId = c.sourceIds.find((source) => source.startsWith("costar:listing:"))?.split(":").pop();
  const spaceId = c.id.split(":").pop();
  return {
    id: c.id,
    cityId: c.cityId,
    h3Index: c.h3Index!,
    name: c.name,
    latitude: c.latitude!,
    longitude: c.longitude!,
    floorAreaSqFt: c.floorAreaSqFt,
    askingRent,
    availability: "unknown",
    previousUse: null,
    parkingSpaces: null,
    sourceIds: c.sourceIds,
    isDemo: false,
    recordKind: "listing",
    sourcePropertyId: c.propertyId,
    sourceListingId: listingId ?? null,
    sourceSpaceId: spaceId ?? null,
    address: c.address,
    propertyType: null,
    recordDate: c.recordDate,
    datasetDate: c.datasetDate,
  };
}

export function ExpansionWorkspace({
  dataset: initialDataset,
  initialSaved,
  initialStorageError,
  mode = "demo",
  onModeChange,
  profile = null,
  onEditProfile,
}: {
  dataset: Dataset;
  initialSaved: Scenario[];
  initialStorageError: string | null;
  mode?: "demo" | "local";
  onModeChange?: (mode: "demo" | "local") => void;
  profile?: { revision: ProfileRevision; saved: boolean } | null;
  onEditProfile?: () => void;
}) {
  const [dataset, setDataset] = useState(initialDataset);
  const [investigationRunId, setInvestigationRunId] = useState<string | null>(null);
  const [cityId, setCityId] = useState(initialDataset.cities[0].id);
  const city = initialDataset.cities.find((value) => value.id === cityId)!;
  const [bounds, setBounds] = useState<Viewport>(initialDataset.cities[0].bounds);
  const [offset, setOffset] = useState(0);
  const [coverage, setCoverage] = useState<QueryCoverage | null>(null);
  const [queryState, setQueryState] = useState<"loading" | "ready" | "error">(mode === "local" ? "loading" : "ready");
  const [queryError, setQueryError] = useState("");
  const [queryAttempt, setQueryAttempt] = useState(0);
  const [detailProperty, setDetailProperty] = useState<ExpansionProperty | null>(null);
  const [detailArea, setDetailArea] = useState<ExpansionArea | null>(null);
  const [detailEvidence, setDetailEvidence] = useState<Evidence[]>([]);
  const [detailState, setDetailState] = useState<"loading" | "ready" | "error">("ready");
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [snapshotFallback, setSnapshotFallback] = useState(false);
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
  const [activeEvidence, setActiveEvidence] = useState<Evidence[]>([]);
  const [activeSource, setActiveSource] = useState<{datasetId: string; datasetDate: string | null} | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [scenarioLabel, setScenarioLabel] = useState("Opening plan");
  const [saved, setSaved] = useState(initialSaved);
  const [comparison, setComparison] = useState<Scenario[]>([]);
  const [storageError, setStorageError] = useState(initialStorageError);
  const [notice, setNotice] = useState("");
  const [analystOpen, setAnalystOpen] = useState(false);
  const analystRef = useRef<HTMLDialogElement>(null);
  const analystTrigger = useRef<HTMLButtonElement>(null);
  const restoreRequest = useRef<AbortController | null>(null);
  // Profile-driven citywide run state (Phase 2).
  const [run, setRun] = useState<RunRecord | null>(null);
  const [runPhase, setRunPhase] = useState<"idle" | "starting" | "running" | "done" | "error">("idle");
  const [runError, setRunError] = useState("");
  const [runCandidates, setRunCandidates] = useState<AssessedCandidate[]>([]);
  const [runExcluded, setRunExcluded] = useState<ExcludedCandidate[]>([]);
  const [runExcludedTruncated, setRunExcludedTruncated] = useState(false);
  const [runGroup, setRunGroup] = useState<CandidateGroup | null>(null);
  const [runPage, setRunPage] = useState(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const runActive = run !== null && runPhase !== "idle";
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
      runActive
        ? dataset.properties.filter((p) => p.cityId === cityId)
        : dataset.properties.filter(
            (p) =>
              p.cityId === cityId &&
              filtersValid &&
              (mode === "local" || propertyMatches(p, budget, minimumArea)),
          ),
    [dataset, cityId, filtersValid, budget, minimumArea, mode, runActive],
  );
  const properties = filteredProperties.filter(
    (p) => !areaFilter || p.h3Index === areaFilter,
  );
  const selectedProperty =
    selection.kind === "property"
      ? detailProperty?.id === selection.id ? detailProperty : dataset.properties.find((p) => p.id === selection.id)
      : undefined;
  const selectedArea = areas.find(
    (a) =>
      a.h3Index ===
      (selection.kind === "area" ? selection.id : selectedProperty?.h3Index),
  ) ?? (detailArea?.h3Index === selectedProperty?.h3Index ? detailArea : undefined);
  const selectedAssessment = runActive
    ? runCandidates.find((item) => item.candidate.id === selectedProperty?.id) ?? null
    : null;
  const relevantEvidence = [...new Map([...dataset.evidence, ...detailEvidence].map((item) => [item.id, item])).values()];
  const metadata = dataset.metadata ?? initialDataset.metadata;
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
  useEffect(() => {
    // Set on setup so double-invoked effects (StrictMode-style) stay true;
    // flipped only on true unmount.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      restoreRequest.current?.abort();
    };
  }, []);

  // Profile-driven run polling: status every ~700ms until terminal, then
  // load the assessment pages. The candidates fetches intentionally carry no
  // abort signal: the phase transition must never cancel applying results;
  // only unmount does.
  useEffect(() => {
    const runId = runIdRef.current;
    if (runPhase !== "running" || !runId) return;
    let cancelled = false;
    const controller = new AbortController();
    const tick = async () => {
      if (cancelled) return;
      try {
        const next = await getProfileRun(runId, controller.signal);
        if (cancelled) return;
        setRun(next);
        if (
          next.status === "completed" ||
          next.status === "completed_with_gaps" ||
          next.status === "failed" ||
          next.status === "cancelled"
        ) {
          if (next.status === "failed") {
            setRunError(next.error?.message ?? "The profile search failed.");
          }
          setRunPhase("done");
          if (next.status !== "failed") {
            try {
              const first = await getRunCandidatesRequest(runId, { offset: 0, limit: 200 });
              let all = [...first.candidates];
              while (all.length < first.total && all.length < 1000) {
                const page = await getRunCandidatesRequest(runId, { offset: all.length, limit: 200 });
                if (!page.candidates.length) break;
                all = [...all, ...page.candidates];
              }
              if (!mountedRef.current) return;
              setRunCandidates(all);
              setRunExcluded(first.excluded);
              setRunExcludedTruncated(first.excludedTruncated);
              setRunPage(0);
              const mappable = all
                .filter((item) => item.candidate.h3Index !== null && item.candidate.latitude !== null && item.candidate.longitude !== null)
                .map(candidateProperty);
              setDataset((current) => ({ ...current, areas: [], properties: mappable }));
              const firstMeets = all.find((item) => item.group === "meets_assessed_requirements");
              if (firstMeets) setSelection({ kind: "property", id: firstMeets.candidate.id });
            } catch (failure) {
              if (!mountedRef.current) return;
              setRunError(failure instanceof Error ? failure.message : "The run results could not be read.");
              setRunPhase("error");
            }
          }
        } else {
          pollTimer.current = setTimeout(() => {
            void tick();
          }, 700);
        }
      } catch (failure) {
        if (!cancelled && !(failure instanceof DOMException && failure.name === "AbortError")) {
          setRunError(failure instanceof Error ? failure.message : "The search status could not be read.");
          setRunPhase("error");
        }
      }
    };
    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [runPhase]);

  function startRun() {
    if (!profile) return;
    setRunError("");
    setRunCandidates([]);
    setRunExcluded([]);
    setRunExcludedTruncated(false);
    setRunGroup(null);
    setRunPage(0);
    setRunPhase("starting");
    const runId = crypto.randomUUID();
    runIdRef.current = runId;
    void createProfileRun({
      runId,
      cityId,
      intake: profile.revision.intakeSnapshot,
      revisionId: profile.revision.revisionId,
      revisionNumber: profile.revision.revisionNumber,
    }).then((created) => {
      setRun(created);
      setRunPhase("running");
    }).catch((failure: unknown) => {
      setRunError(failure instanceof ClientDataError ? failure.message : "The profile search request failed.");
      setRunPhase("error");
    });
  }

  function cancelSearch() {
    const runId = runIdRef.current;
    if (!runId) return;
    void cancelProfileRun(runId).catch((failure: unknown) => {
      setRunError(failure instanceof ClientDataError ? failure.message : "The cancellation request failed.");
    });
  }

  function newSearch() {
    setRun(null);
    setRunCandidates([]);
    setRunExcluded([]);
    setRunError("");
    setRunGroup(null);
    setRunPage(0);
    startRun();
  }

  useEffect(() => {
    if (mode !== "local" || !filtersValid || runActive) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setQueryState("loading");
      loadLocalArea({ cityId, bounds, budget, minimumArea, offset, signal: controller.signal }).then((response) => {
        if (controller.signal.aborted) return;
        setDataset({ ...response.dataset, cities: initialDataset.cities });
        setCoverage(response.coverage);
        setQueryState("ready");
        setQueryError("");
        setSelection((current) => {
          if (current.kind === "property") return current;
          return response.dataset.areas.some((area) => area.h3Index === current.id) ? current : { kind: "area", id: response.dataset.areas[0]?.h3Index ?? "" };
        });
      }).catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setQueryState("error");
        setQueryError(failure instanceof Error ? failure.message : "The local data source failed.");
      });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [mode, cityId, bounds, budget, minimumArea, offset, filtersValid, initialDataset.cities, queryAttempt, runActive]);

  useEffect(() => {
    if (mode !== "local" || selection.kind !== "property") return;
    const controller = new AbortController();
    loadLocalProperty(selection.id, controller.signal).then((detail) => {
      if (controller.signal.aborted) return;
      setDetailProperty(detail.property);
      setDetailArea(detail.area);
      setDetailEvidence(detail.evidence);
      setDetailState("ready");
      setSnapshotFallback(false);
    }).catch(() => {
      if (!controller.signal.aborted) setDetailState("error");
    });
    return () => controller.abort();
  }, [mode, selection, detailAttempt]);

  function select(next: Selection) {
    restoreRequest.current?.abort();
    if (mode === "local" && next.kind === "property") setDetailState("loading");
    setSnapshotFallback(false);
    setDetailProperty(null);
    setSelection(next);
    setNotice("");
  }
  function tryProperty(property: ExpansionProperty) {
    setActiveProperty(property);
    setActiveEvidence(relevantEvidence.filter((source) => property.sourceIds.includes(source.id)));
    setActiveSource(metadata ? { datasetId: metadata.datasetId, datasetDate: metadata.datasetDate } : null);
    setDraft(planningDraft(property));
    setScenarioLabel(`${property.name} plan`.slice(0, 100));
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
    const candidate = scenarioSchema.safeParse({
      schemaVersion: mode === "local" ? 2 : 1,
      modelVersion: FINANCE_VERSION,
      scoreModelVersion: mode === "local" ? LOCAL_SCORE_VERSION : SCORE_VERSION,
      id: crypto.randomUUID(),
      restaurantId: mode === "local" ? "local-planning-workspace" : "demo-restaurant",
      propertyId: activeProperty.id,
      propertyName: activeProperty.name,
      cityId: activeProperty.cityId,
      label: scenarioLabel.trim(),
      createdAt: new Date().toISOString(),
      isDemo: activeProperty.isDemo,
      ...(mode === "local" ? { dataMode: "local", datasetId: activeSource?.datasetId ?? metadata!.datasetId, datasetDate: activeSource ? activeSource.datasetDate : metadata!.datasetDate, propertySnapshot: activeProperty, evidenceSnapshot: activeEvidence } : {}),
      inputs: parsedInputs.data,
      results,
      weights,
      monthlyBudget: budget,
      sourceIds: [
        ...new Set([...activeProperty.sourceIds, ...(mode === "demo" ? ["demo-area-indices"] : [])]),
      ],
      assumptionNotes: [
        mode === "demo" ? "All property and area data is fictional." : "Property data comes from a dated local dataset snapshot; current availability and restaurant suitability are unknown.",
        "All editable financial fields are planning assumptions, including any rent override.",
        "Pass-throughs, other fixed costs, contribution margin, investment and working capital start with illustrative assumptions.",
        "Demand is unknown. Required sales is a threshold; contribution excludes financing, taxes and unmodeled costs. Payback excludes working capital.",
      ],
    });
    if (!candidate.success) {
      setNotice("This scenario could not be saved: its source evidence is incomplete or inconsistent. Inspect the property again before saving.");
      return null;
    }
    return candidate.data;
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
        "This data mode stores up to 50 snapshots. Remove one before saving.",
      );
      return;
    }
    const next = [value, ...saved];
    try {
      persistScenarios(localStorage, next, mode);
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
      persistScenarios(localStorage, next, mode);
      setSaved(next);
      setNotice("Saved snapshot removed.");
    } catch {
      setNotice(
        "Could not update browser storage. Saved snapshots are unchanged.",
      );
    }
  }
  async function restore(value: Scenario) {
    restoreRequest.current?.abort();
    const restoredCity = initialDataset.cities.find((item) => item.id === value.cityId);
    if (!restoredCity) { setNotice("This snapshot's market is no longer supported. Its saved comparison is still readable."); return; }
    const controller = new AbortController();
    restoreRequest.current = controller;
    let property = dataset.properties.find((p) => p.id === value.propertyId);
    let fromSnapshot = false;
    if (mode === "local" && value.schemaVersion === 2) {
      try {
        const detail = await loadLocalProperty(value.propertyId, controller.signal);
        if (controller.signal.aborted) return;
        property = detail.property;
        setDetailArea(detail.area);
        setDetailEvidence(detail.evidence);
      } catch {
        if (controller.signal.aborted) return;
        property = value.propertySnapshot;
        setDetailEvidence(value.evidenceSnapshot);
        fromSnapshot = true;
      }
    }
    if (!property) {
      setNotice("The original property is unavailable.");
      return;
    }
    setCityId(value.cityId);
    setBounds(restoredCity.bounds);
    setOffset(0);
    setDetailProperty(property);
    setSnapshotFallback(fromSnapshot);
    setSelection({ kind: "property", id: property.id });
    if (mode === "local") setDetailState("loading");
    setAreaFilter(null);
    setBudgetInput(String(value.monthlyBudget));
    setWeights(value.weights);
    setActiveProperty(value.schemaVersion === 2 ? value.propertySnapshot : property);
    if (value.schemaVersion === 2) {
      setActiveEvidence(value.evidenceSnapshot);
      setActiveSource({ datasetId: value.datasetId, datasetDate: value.datasetDate });
    }
    setDraft(toDraft(value.inputs));
    setScenarioLabel(value.label);
    setNotice(
      fromSnapshot ? "Saved inputs restored from a dated embedded property snapshot. The source could not be reached; this is saved evidence, not refreshed data." : "Saved inputs restored. Snapshot results are reproducible under the recorded model.",
    );
  }
  function clearStorage() {
    try {
      localStorage.removeItem(storageKeyFor(mode));
      setSaved([]);
      setStorageError(null);
      setNotice(`Saved ${mode === "demo" ? "demo" : "local"} data cleared.`);
    } catch {
      setNotice(
        "Browser storage is still unavailable. You can continue comparing without saving.",
      );
    }
  }

  return (
    <div className="expansion-app">
      <ExpansionHeader mode={mode} onModeChange={onModeChange} />
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
        {profile && (
          <div className="profile-strip">
            <span className="mini-icon">
              <ClipboardList size={16} />
            </span>
            <div>
              <strong>
                {profile.revision.intakeSnapshot.restaurant.name} · profile
                revision {profile.revision.revisionNumber}
                {profile.saved ? "" : " · unsaved"}
              </strong>
              <span>
                {(() => {
                  const find = (id: string) =>
                    profile.revision.requirements.requirements.find(
                      (item) => item.id === id,
                    );
                  const occupancy = find("occupancy.monthlyLimit");
                  const kitchen = find("space.existingKitchen");
                  const parking = find("space.customerParking");
                  return [
                    occupancy
                      ? `$${requirementDisplayValue(occupancy)}/month total occupancy cap`
                      : null,
                    kitchen && kitchen.value.kind === "boolean" && kitchen.value.value
                      ? "existing kitchen"
                      : null,
                    parking && parking.value.kind === "boolean" && parking.value.value
                      ? "customer parking"
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                })()}
              </span>
            </div>
            {onEditProfile && (
              <button className="text-button" onClick={onEditProfile}>
                <Pencil size={13} /> Edit profile
              </button>
            )}
          </div>
        )}
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
            {mode === "demo" ? <><strong>Fictional {city.name} demo.</strong> All listings and area indicators are simulated. No live availability.</> : <><strong>{metadata?.provider} · Local dataset snapshot.</strong> Dataset date: {metadata?.datasetDate ?? "not supplied"}. Imported {metadata?.importedAt ? new Date(metadata.importedAt).toLocaleDateString() : "date unavailable"}. Current availability and restaurant suitability are unverified.</>}
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
                  restoreRequest.current?.abort();
                  setCityId(id);
                  setBounds(initialDataset.cities.find((item) => item.id === id)!.bounds);
                  setOffset(0);
                  setDetailProperty(null);
                  setDetailArea(null);
                  setSnapshotFallback(false);
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
                    {city.name} · {city.isDemo ? "Demo" : "Local snapshot"}
                  </option>
                ))}
              </select>
            </label>
            <NumericField
              label="Monthly base-rent budget"
              value={budgetInput}
              onChange={(value) => { setBudgetInput(value); setOffset(0); }}
              suffix="USD / month"
              min={1}
              disabled={runActive}
            />
            <NumericField
              label="Minimum space"
              value={minimumInput}
              onChange={(value) => { setMinimumInput(value); setOffset(0); }}
              suffix="sq ft"
              disabled={runActive}
            />
            {!filtersValid && (
              <p role="alert" className="field-error">
                Enter a positive budget and a nonnegative minimum area. Scores
                retain the $8,000 planning budget until corrected.
              </p>
            )}
            <p className="small-note">
              {runActive
                ? "The profile search drives the current map and list. Browse filters are disabled; panning changes the view, never the run results."
                : `Budget filters base rent only. ${mode === "local" ? "Unknown rent or size is included and must be verified." : "Unknown rent or size is excluded; availability may be unknown."}`}
            </p>
            {mode === "local" && city.coverage && <p className="small-note">Market coverage: {number(city.coverage.propertyCount)} properties · {number(city.coverage.listingCount)} space/listing records · {number(city.coverage.mappableCount)} mappable records. Coverage describes this dataset, not all commercial space.</p>}
            <div className="rail-divider" />
            <div className="section-caption">
              <Layers size={15} />
              <h2>Area priorities</h2>
            </div>
            <p className="small-note">
              {mode === "demo" ? "Editable weights · fictional indicators" : "Composite area suitability is unsupported. All real areas remain unscored."}
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
                  disabled={mode === "local"}
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
                <h2>{runActive ? `${city.name} profile matches` : `${city.name} scouting grounds`}</h2>
                <span>
                  {runActive
                    ? `${filteredProperties.length} assessed candidate spaces on the map`
                    : `${areas.length} analysis cells · ${filteredProperties.length} ${mode === "demo" ? "matching demo spaces" : "returned property/space records"}`}
                </span>
              </div>
              <span className="live-label">2D EXPLORER</span>
            </div>
            {mode === "local" && !runActive && <div className="query-status" role={queryState === "error" ? "alert" : "status"}>
              {queryState === "loading" ? "Loading this map area… Previous results remain visible until the query finishes." : queryState === "error" ? <>{queryError} Previous results may be stale. <button className="text-button" onClick={() => setQueryAttempt((value) => value + 1)}>Retry area query</button></> : coverage ? <>Showing {coverage.returned ? coverage.offset + 1 : 0}–{coverage.offset + coverage.returned} of {number(coverage.totalMatching)} matching records in the queried bounds; maximum {coverage.limit} per page. {coverage.areasReturned} H3 cells for returned records{coverage.areasLimited ? " (additional matching cells are outside this page)" : ""}.</> : "Choose a supported market."}
              <div className="query-actions">
                <button className="text-button" onClick={() => { setBounds(city.bounds); setOffset(0); setQueryAttempt((value) => value + 1); }}>Search whole supported market</button>
                {coverage && <><button className="text-button" disabled={queryState === "loading" || offset === 0} onClick={() => setOffset(Math.max(0, offset - coverage.limit))}>Previous results</button><button className="text-button" disabled={queryState === "loading" || offset + coverage.returned >= coverage.totalMatching || offset + coverage.limit > 10000} onClick={() => setOffset(offset + coverage.limit)}>Next results</button></>}
              </div>
            </div>}
            {areas.length || mode === "local" ? (
              <ScoutMap
                dataset={dataset}
                cityId={cityId}
                properties={selectedProperty && !filteredProperties.some((property) => property.id === selectedProperty.id) ? [...filteredProperties, selectedProperty] : filteredProperties}
                weights={weights}
                budget={scoringBudget}
                selection={selection}
                onSelect={select}
                onViewportChange={mode === "local" && !runActive ? (next) => { setBounds(next); setOffset(0); } : undefined}
              />
            ) : (
              <div className="empty-state">
                No supported area data for this market.
              </div>
            )}
            <div className="map-legend">
              <span>{runActive ? "Profile search pins" : "Area suitability"}</span>
              {runActive ? (
                <>
                  <span>
                    <i className="legend-dot high" /> Meets assessed requirements
                  </span>
                  <span>
                    <i className="legend-dot mid" /> Needs verification
                  </span>
                  <span>
                    <i className="legend-dot low" /> Does not meet
                  </span>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
            <p className="map-footnote">
              {runActive
                ? "Pins are assessed candidate spaces from the full-city run. Panning or page size never changes the run results; excluded records stay in the excluded view."
                : `${mode === "local" ? "Real areas have no supported composite score. Counts and rents are individual snapshot metrics; they do not measure demand or competition." : "Coverage below 70% stays unscored. Partial coverage uses a lighter fill."} H3 cells are analysis regions, not neighborhood boundaries.`}
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
              <span className="tiny-badge">{mode === "demo" ? "Demo" : "Local snapshot"}</span>
            </div>
            {selectedProperty ? (
              <>
                <h2>{selectedProperty.name}</h2>
                <p className="inspector-subtitle">
                  {selectedProperty.isDemo ? "Fictional test space" : selectedProperty.recordKind === "listing" ? "Space / listing record" : "Property record · no rentable space verified"} · {city.name}
                </p>
                <div className="property-art" aria-hidden="true">
                  <Building2 size={58} strokeWidth={1} />
                  <span>{selectedProperty.isDemo ? "DEMO SPACE" : "SOURCE RECORD"}</span>
                </div>
                <div className="metric-grid">
                  <Metric
                    label={`Space area · ${selectedProperty.isDemo ? "simulated" : "observed / unknown"}`}
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
                    <dt>Asking basis · {selectedProperty.isDemo ? "simulated" : "sourced"}</dt>
                    <dd>
                      {selectedProperty.askingRent
                        ? `${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(selectedProperty.askingRent.amount)}${selectedProperty.askingRent.unit === "USD_PER_SF_YEAR" ? " / SF / year" : " / month"}`
                        : "Unavailable"}
                    </dd>
                  </div>
                  {!selectedProperty.isDemo && <>
                    <div><dt>Address · sourced</dt><dd>{selectedProperty.address ?? "Unavailable"}</dd></div>
                    <div><dt>Property type · sourced</dt><dd>{selectedProperty.propertyType ?? "Unavailable"}</dd></div>
                    <div><dt>Original rent units / service basis</dt><dd>{selectedProperty.originalRentUnit ?? "Unknown"} · {selectedProperty.rentBasis ?? "Unknown"}</dd></div>
                    {selectedProperty.sourceRent && <div><dt>Source asking range</dt><dd>{selectedProperty.sourceRent.low === null ? "Unavailable" : number(selectedProperty.sourceRent.low)}–{selectedProperty.sourceRent.high === null ? "Unavailable" : number(selectedProperty.sourceRent.high)} · {selectedProperty.originalRentUnit ?? "units unknown"} · currency {selectedProperty.sourceRent.currencyCode === 1 ? "USD" : selectedProperty.sourceRent.currencyCode === null ? "unknown" : `source code ${selectedProperty.sourceRent.currencyCode} (not normalized)`}. A range is not treated as an exact rent.</dd></div>}
                    <div><dt>Property / listing / space identifiers</dt><dd>{selectedProperty.sourcePropertyId ?? "Unknown"} / {selectedProperty.sourceListingId ?? "Unknown"} / {selectedProperty.sourceSpaceId ?? "Unknown"}</dd></div>
                    <div><dt>Record date / dataset date</dt><dd>{selectedProperty.recordDate ?? "Not supplied"} / {selectedProperty.datasetDate ?? "Not supplied"}</dd></div>
                  </>}
                  <div>
                    <dt>Previous use · {selectedProperty.isDemo ? "simulated" : "sourced / unknown"}</dt>
                    <dd>{selectedProperty.previousUse ?? "Unavailable"}</dd>
                  </div>
                  <div>
                    <dt>Parking · {selectedProperty.isDemo ? "simulated" : "sourced / unknown"}</dt>
                    <dd>{selectedProperty.parkingSpaces ?? "Unavailable"}</dd>
                  </div>
                  <div>
                    <dt>Availability · {selectedProperty.isDemo ? "simulated" : "snapshot / unknown"}</dt>
                    <dd>
                      {selectedProperty.availability === "unknown"
                        ? "Unknown — verify first"
                        : selectedProperty.availability}
                    </dd>
                  </div>
                </dl>
                {mode === "local" && detailState === "loading" && <p role="status" className="small-note">Loading selected-record evidence…</p>}
                {mode === "local" && detailState === "error" && <p role="alert" className="warning">Selected-record refresh failed. Displayed query or saved snapshot evidence has not been refreshed. <button className="text-button" onClick={() => { setDetailState("loading"); setDetailAttempt((value) => value + 1); }}>Retry property</button></p>}
                {snapshotFallback && <p className="warning">Dated saved property snapshot. The local source is unavailable.</p>}
                {!filteredProperties.some(
                  (p) => p.id === selectedProperty.id,
                ) &&
                  !runActive && (
                  <p className="warning">
                    This selection is outside the returned page, map bounds or filters. Its selected pin is retained; it may be outside the visible map.
                  </p>
                )}
                {runActive && selectedAssessment && (
                  <AssessmentList assessed={selectedAssessment} />
                )}
                {runActive && !selectedAssessment && (
                  <p className="small-note">
                    This space is on the map but has no stored assessment in
                    this run.
                  </p>
                )}
                <p className="small-note">
                  {runActive
                    ? "The profile assessment above is deterministic and came from the full-city run. Active snapshot marketing does not verify current vacancy or permitted restaurant use."
                    : "Base rent excludes pass-throughs. This property has no verified fit score, lease status, or permitted use."}
                </p>
                <button
                  className="primary full"
                  onClick={() => tryProperty(selectedProperty)}
                >
                  Try opening here <ArrowRight size={15} />
                </button>
                <button
                  className="text-button full"
                  onClick={() =>
                    select({ kind: "area", id: selectedProperty.h3Index })
                  }
                >
                  <ArrowLeft size={13} /> Inspect this area
                </button>
                <p className="source-line">
                  Source: {selectedProperty.isDemo ? "RestaurantOS fixtures" : metadata?.provider ?? "Local dataset"} · record date {selectedProperty.recordDate ?? "unavailable"}
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
                    <small>{mode === "demo" ? "Derived from fictional inputs" : "Demand, similarity and competition unavailable"}</small>
                  </div>
                </div>
                {mode === "local" && selectedArea.metrics && <div className="outcome-lines">
                  <Metric label="Unique properties · snapshot" value={selectedArea.metrics.propertyCount} />
                  <Metric label="Space/listing records · snapshot" value={selectedArea.metrics.listingCount} />
                  <Metric label="Average exact asking rent · USD / SF / year" value={money(selectedArea.metrics.averageAskingRentPerSfYear)} />
                  <p className="small-note">Rent sample: {selectedArea.metrics.rentSampleCount} eligible records. Ranges and unknown units are excluded; unknown or mixed service types remain unavailable. Counts describe the full snapshot cell, independently of the returned page and filters. This is a source sample, not a complete market average.</p>
                </div>}
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
                  {mode === "demo" ? "Demo indices are illustrative. Missing factors are omitted, never assigned a neutral value." : "The snapshot does not support a composite area score. Listing density is not demand, competition or restaurant suitability."}
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
                  returned records in this area
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
                  Source: {mode === "demo" ? "RestaurantOS fixtures" : metadata?.provider ?? "Local dataset"} · dataset date {metadata?.datasetDate ?? "unavailable"}
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
          {mode === "local" && (profile || runActive) ? (
            <>
              {profile && (
                <AgentRunSection
                  profile={{
                    revisionId: profile.revision.revisionId,
                    revisionNumber: profile.revision.revisionNumber,
                    intake: profile.revision.intakeSnapshot,
                  }}
                  cityId={cityId}
                  onInvestigateRun={setInvestigationRunId}
                  onUseDeterministic={() => {
                    document
                      .getElementById("deterministic-search")
                      ?.scrollIntoView({ block: "nearest" });
                  }}
                />
              )}
              <DecisionWorkbench requestedRunId={investigationRunId} currentProfileRevisionId={profile?.revision.revisionId ?? null} />
              <div id="deterministic-search">
                <RunSearch
                  run={run}
                  phase={runPhase}
                  errorMessage={runError}
                  candidates={
                    runGroup
                      ? runCandidates.filter((item) => item.group === runGroup)
                      : runCandidates
                  }
                  excluded={runExcluded}
                  excludedTruncated={runExcludedTruncated}
                  group={runGroup}
                  onGroupChange={(next) => {
                    setRunGroup(next);
                    setRunPage(0);
                  }}
                  page={runPage}
                  onPageChange={setRunPage}
                  onStart={startRun}
                  onCancel={cancelSearch}
                  onRetry={newSearch}
                  onSelect={(candidateId) => select({ kind: "property", id: candidateId })}
                  selectedId={selection.kind === "property" ? selection.id : null}
                />
              </div>
            </>
          ) : (
          <>
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
                    <span className="tiny-badge">{property.isDemo ? "Fictional" : property.recordKind === "listing" ? "Space / listing" : "Property"}</span>
                    <ArrowRight size={16} />
                  </div>
                  <Building2 size={28} strokeWidth={1.3} />
                  <h3>{property.name}</h3>
                  <p>
                    {property.floorAreaSqFt === null ? "Space area unknown" : `${number(property.floorAreaSqFt)} sq ft`} <span>·</span>{" "}
                    {property.availability === "unknown"
                      ? "Status unknown"
                      : property.isDemo ? "Demo availability" : `${property.availability} in snapshot`}
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
                <h3>{mode === "local" && queryState === "loading" ? "Loading property records…" : mode === "local" && queryState === "error" ? "Property records could not be refreshed." : "No spaces match these filters."}</h3>
                <p>{mode === "local" && queryState === "error" ? "The source query failed. Retry to determine whether this area has matching records." : "Try another area, a higher base-rent budget, or a smaller minimum size."}</p>
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
          </>
          )}
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
                  {mode === "local" && <p className="small-note">Scenario source: {activeSource?.datasetId} · dataset date {activeSource?.datasetDate ?? "not supplied"} · record date {activeProperty.recordDate ?? "not supplied"}. These captured inputs remain unchanged when you scout other properties.</p>}
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    setDraft(planningDraft(activeProperty));
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
                      <span className="tiny-badge">{s.isDemo ? "Demo snapshot" : "Local dataset snapshot"}</span>
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
              {mode === "demo" ? "Demo" : "Local dataset"} snapshots stored only in this browser · up to 50 ·{" "}
              {saved.length} saved
            </p>
            {storageError && (
              <div role="alert" className="warning">
                {storageError}
                <button className="text-button" onClick={clearStorage}>
                  Clear saved {mode === "demo" ? "demo" : "local"} data
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
                      {s.isDemo ? "Demo" : "Local snapshot"} ·{" "}
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
          <span>RestaurantOS · Expansion · {mode === "demo" ? "Demo data" : "Dated local dataset"}</span>
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
          <span className="demo-pill">{mode === "demo" ? "Demo · fictional data" : "Local dataset · dated snapshot"}</span>
          <h3>Area scoring</h3>
          <p>
            Model: <code>{mode === "demo" ? SCORE_VERSION : LOCAL_SCORE_VERSION}</code>. H3 resolution 8. {mode === "local" ? "Composite scoring is unavailable for this dataset. Supported counts and exact-rent samples are descriptive metrics only." : "Weighted mean"}
            {mode === "demo" && <>
            of available factors; minimum weighted coverage 70%. Zero total
            weight is unscored. Missing factors are excluded from the mean and
            included in the coverage denominator.
            </>}
          </p>
          {mode === "demo" ? <p>
            Demand, similarity and competition are synthetic 0–100 favorable
            indices with identity normalization; they are not measurements or
            empirical predictions. Base-rent fit = clamp(100 × (1 − fictional
            area monthly rent ÷ (2 × budget)), 0, 100). Higher is favorable for
            every normalized factor. Budget: {money(scoringBudget)} / month.
          </p> : <p>Demand, demographic similarity and competition observations are unavailable. No fictional indices are used. Coverage requirements have not been lowered. Area counts deduplicate verified source IDs and do not imply rentable or restaurant-suitable space.</p>}
          {selectedArea && areaResult && (
            <>
              <h3>{selectedArea.label}</h3>
              <p className="mono">{selectedArea.h3Index}</p>
              <p>
                {mode === "demo" ? "Fictional" : "Eligible snapshot sample"} area base rent:{" "}
                {money(selectedArea.averageBaseRentMonthly)} / month. Coverage:{" "}
                {Math.round(areaResult.coverage * 100)}%. Missing:{" "}
                {areaResult.missing.map((k) => FACTOR_LABELS[k]).join(", ") ||
                  "none"}
                .
              </p>
              <table>
                <caption>
                  Current factor decomposition · {mode === "demo" ? "derived from simulated inputs" : "unsupported factors remain unavailable"}
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
          {mode === "demo" ? <p>Fictional area rent aggregates do not represent the average of the demo property records. Source observation dates are unavailable.</p> : <><p>{metadata?.provider} · dataset {metadata?.datasetId} · release date {metadata?.datasetDate ?? "not supplied"}. Imported {metadata?.importedAt}. A local file snapshot is not a live API or verified current availability.</p><p>{metadata?.rights}</p>{metadata?.notes.map((note) => <p key={note}>{note}</p>)}</>}
          {relevantEvidence
            .filter(
              (source) =>
                source.id === "demo-area-indices" ||
                selectedArea?.sourceIds.includes(source.id) ||
                selectedProperty?.sourceIds.includes(source.id) ||
                activeProperty?.sourceIds.includes(source.id),
            )
            .map((source) => (
              <article className="evidence-item" key={source.id}>
                <strong>{source.label}</strong>
                <p>
                  {source.provider} · {source.origin} · {source.isDemo ? "Demo" : "Local dataset"}
                </p>
                <code>
                  {source.id} / {source.recordId}
                </code>
                <p>{source.notes}</p>
                <p>{source.rights} Observation date: {source.observedAt ?? "unavailable"}.</p>
              </article>
            ))}
          {mode === "local" && activeEvidence.length > 0 && <>
            <h3>Active scenario evidence</h3>
            <p>Captured with the scenario property. Refreshing the map or inspecting another property does not replace this planning evidence.</p>
            {activeEvidence.map((source) => <article className="evidence-item" key={`scenario-${source.id}`}>
              <strong>{source.label}</strong><p>{source.provider} · {source.origin} · local snapshot</p><code>{source.id} / {source.recordId}</code><p>{source.notes}</p><p>{source.rights} Observation date: {source.observedAt ?? "unavailable"}.</p>
            </article>)}
          </>}
          <p>
            Snapshot schema {mode === "demo" ? "version 1 (legacy compatible)" : "version 2"}. Snapshots store inputs, exact results,
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
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix: string;
  min?: number;
  max?: number;
  step?: string;
  optional?: boolean;
  disabled?: boolean;
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
        disabled={disabled}
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
