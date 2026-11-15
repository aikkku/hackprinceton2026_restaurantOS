"use client";

import { Bookmark } from "lucide-react";
import { useMemo, useState } from "react";
import type { AssessedCandidate } from "../../domain/matching.ts";
import {
  bestMatches,
  budgetCap,
  checkQuestion,
  costLabel,
  costPin,
  displayOrder,
  estimateCostLabel,
  estimatePin,
  fitForGroup,
  monthlyCost,
  primaryFinding,
} from "./model.ts";
import { PlacesMap, type MapPlace } from "./places-map.tsx";
import { MAX_SAVED_PLACES } from "./session.ts";
import { Dot, Tag, Thumb } from "./ui.tsx";
import type { Workspace } from "./workspace.ts";

export type PlaceView = { assessed: AssessedCandidate; image: string | null };

export function placeTitle(candidate: AssessedCandidate["candidate"]) {
  return candidate.name;
}
export function placeSubtitle(candidate: AssessedCandidate["candidate"]) {
  const suite = candidate.suite && !candidate.name.includes(candidate.suite) ? `Suite ${candidate.suite}` : null;
  return [suite, candidate.address].filter(Boolean).join(" · ") || "Address not listed";
}

export function Places({ workspace, views, saved, selectedId, notice, onSelect, onOpen, onToggleSave, onCompare, onNewSearch }: {
  workspace: Workspace;
  views: PlaceView[];
  saved: string[];
  selectedId: string | null;
  notice: string;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onToggleSave: (id: string) => void;
  onCompare: () => void;
  onNewSearch: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  // Display order: group order preserved; listed-rent candidates ahead of
  // no-rent ones inside a group; estimate-within-budget no-rent first. This
  // is a display concern only and never changes the assessment.
  const orderedViews = useMemo(() => {
    const byId = new Map(views.map((v) => [v.assessed.candidate.id, v]));
    return displayOrder(
      views.map((v) => v.assessed),
      workspace.rentEstimates,
      budgetCap(workspace.requirements),
    )
      .map((a) => byId.get(a.candidate.id))
      .filter((v): v is PlaceView => Boolean(v));
  }, [views, workspace.rentEstimates, workspace.requirements]);
  const best = useMemo(() => bestMatches(orderedViews.map((v) => v.assessed)).map((a) => a.candidate.id), [orderedViews]);
  const bestViews = orderedViews.filter((v) => best.includes(v.assessed.candidate.id));
  const rest = orderedViews.filter((v) => !best.includes(v.assessed.candidate.id));
  const restCouldWork = rest.filter((v) => v.assessed.group !== "does_not_meet");
  const restNoFit = rest.filter((v) => v.assessed.group === "does_not_meet");
  // Keep a place picked on the map visible in the list.
  const expanded = showAll || (selectedId !== null && !best.includes(selectedId));
  const mapPlaces = useMemo<MapPlace[]>(() => orderedViews.map(({ assessed, image }) => {
    const candidate = assessed.candidate;
    const cost = monthlyCost(candidate);
    const estimate = workspace.rentEstimates.get(candidate.id);
    const neighborhood = assessed.assessments.find((a) => a.requirementId === "market.neighborhoodPreference");
    const area = neighborhood?.status === "pass" ? neighborhood.sourceValue : null;
    const suite = candidate.suite ? `Suite ${candidate.suite}` : null;
    // The card shows the suite in the eyebrow, so strip it from the name.
    const cleanName = suite && candidate.name.endsWith(` · ${suite}`) ? candidate.name.slice(0, -` · ${suite}`.length) : candidate.name;
    const question = assessed.assessments.map((a) => checkQuestion(a)).find((q): q is string => Boolean(q)) ?? null;
    const size = candidate.floorAreaSqFt !== null
      ? `${candidate.floorAreaSqFt.toLocaleString("en-US")} sq ft`
      : candidate.sizeRangeSqFt.minimum !== null && candidate.sizeRangeSqFt.maximum !== null
        ? `${candidate.sizeRangeSqFt.minimum.toLocaleString("en-US")}–${candidate.sizeRangeSqFt.maximum.toLocaleString("en-US")} sq ft`
        : "";
    return {
      id: candidate.id,
      name: cleanName,
      location: [area, suite].filter(Boolean).join(" · ") || "Neighborhood not confirmed",
      address: candidate.address ?? "Address not listed",
      lat: candidate.latitude,
      lng: candidate.longitude,
      fit: fitForGroup(assessed.group),
      price: cost.kind === "unknown" && estimate ? estimatePin(estimate) : costPin(cost),
      priceLabel: cost.kind === "unknown" && estimate ? estimateCostLabel(estimate) : costLabel(cost),
      size,
      question,
      image,
      saved: saved.includes(candidate.id),
    };
  }), [orderedViews, workspace.rentEstimates, saved]);

  const card = ({ assessed, image }: PlaceView) => {
    const id = assessed.candidate.id;
    const finding = primaryFinding(assessed, workspace.requirements);
    const current = id === selectedId;
    const isSaved = saved.includes(id);
    const cost = monthlyCost(assessed.candidate);
    const estimate = workspace.rentEstimates.get(id);
    const costUnknown = cost.kind === "unknown";
    return (
      <li key={id} className="sx-pcard" data-current={current}>
        <button type="button" className="sx-pcard-select" aria-label={`Show ${assessed.candidate.name} on the map`} aria-pressed={current} onClick={() => onSelect(id)} />
        <Thumb src={image} alt={assessed.candidate.name} />
        <div className="sx-pcard-main">
          <span className="sx-pcard-name">{placeTitle(assessed.candidate)}</span>
          <span className="sx-small sx-muted">{placeSubtitle(assessed.candidate)}</span>
          <span className="sx-row" style={{ gap: 8 }}>
            <span className="sx-pcard-cost">{costUnknown && estimate ? estimateCostLabel(estimate) : costLabel(cost)}</span>
            {costUnknown && (estimate ? <Tag kind="estimate">Estimate</Tag> : <Tag kind="unknown">Rent not listed</Tag>)}
          </span>
          <span className="sx-finding"><Dot fit={finding.fit} /><span>{finding.text}</span></span>
          {current && <button type="button" className="sx-pcard-more" onClick={() => onOpen(id)}>See details ›</button>}
        </div>
        <button type="button" className="sx-save" aria-pressed={isSaved} aria-label={isSaved ? `Remove ${assessed.candidate.name} from saved` : `Save ${assessed.candidate.name}`}
          disabled={!isSaved && saved.length >= MAX_SAVED_PLACES} title={!isSaved && saved.length >= MAX_SAVED_PLACES ? `You can save up to ${MAX_SAVED_PLACES} places to compare` : undefined}
          onClick={() => onToggleSave(id)}>
          <Bookmark size={18} fill={isSaved ? "currentColor" : "none"} aria-hidden="true" />
        </button>
      </li>
    );
  };

  return (
    <main className="sx-mapwrap">
      <section className="sx-panel" aria-label="Places">
        <div className="sx-stack" style={{ gap: 4 }}>
          <h1 className="sx-title-sm">{views.length} {views.length === 1 ? "place" : "places"} in {workspace.cityLabel}</h1>
          <p className="sx-muted">Tap a place to see if it fits.</p>
        </div>
        {workspace.source === "deterministic" && <p className="sx-notice sx-small">Basic search: these places weren’t inspected by the specialists, and plans can’t be saved from this search.</p>}
        {workspace.source === "saved_plan" && <p className="sx-notice sx-small">You’re looking at a saved plan’s snapshot. Listings may have changed since.</p>}
        {notice && <p className="sx-notice sx-notice-good sx-small" role="status">{notice}</p>}
        {views.length === 0 ? (
          <div className="sx-card"><p>No places to show.</p><div><button type="button" className="sx-btn sx-btn-secondary" onClick={onNewSearch}>Change your needs</button></div></div>
        ) : (
          <>
            <h2 className="sx-group-label">Best matches</h2>
            <ul className="sx-stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>{bestViews.map(card)}</ul>
            {rest.length > 0 && !expanded && <button type="button" className="sx-btn sx-btn-secondary" onClick={() => setShowAll(true)}>Show all {views.length} places</button>}
            {expanded && restCouldWork.length > 0 && <><h2 className="sx-group-label">More options</h2><ul className="sx-stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>{restCouldWork.map(card)}</ul></>}
            {expanded && restNoFit.length > 0 && <><h2 className="sx-group-label">Don’t fit your must-haves</h2><ul className="sx-stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>{restNoFit.map(card)}</ul></>}
            <p className="sx-small sx-muted">
              From {workspace.examined} listings checked{workspace.datasetDate ? `, property data as of ${workspace.datasetDate}` : ""}. {workspace.isSynthetic ? "Synthetic test listings, not real properties." : "Listings are dated snapshots; availability can change."}
            </p>
          </>
        )}
        <div className="sx-panel-foot">
          <button type="button" className="sx-btn sx-btn-primary sx-btn-big sx-btn-block" disabled={saved.length < 2} onClick={onCompare}>
            {saved.length < 2 ? `Save ${2 - saved.length} more ${saved.length === 1 ? "place" : "places"} to compare` : `Compare saved places (${saved.length})`}
          </button>
        </div>
      </section>
      <section className="sx-mapbox" aria-label="Map">
        <PlacesMap places={mapPlaces} selectedId={selectedId} onSelect={onSelect} onOpen={onOpen} onToggleSave={onToggleSave} center={null} note={workspace.isSynthetic ? "Synthetic test positions" : "Positions from listing records"} />
      </section>
    </main>
  );
}
