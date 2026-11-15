"use client";

import { StateButton } from "./state-button";
import { useState } from "react";
import { layoutMetrics, type LayoutLibrary } from "../../domain/layout-library";
import { simulateSeating } from "../../domain/scenario";
import type { Assumptions } from "../../domain/schemas";

type Props = { library: LayoutLibrary; assumptions: Assumptions; disabled: boolean; onAction: (action: "open" | "rename" | "duplicate" | "delete" | "baseline", id: string, name?: string) => void };
export function LayoutLibraryPanel({ library, assumptions, disabled, onAction }: Props) {
  const [name, setName] = useState("");
  const baseline = library.entries.find(e => e.id === library.baselineId)!;
  return <details className="panel layout-library" open>
    <summary>Saved floor plans · {library.entries.length}</summary>
    <p>Save draft updates the active configuration. Duplicate copies its saved version, so save your draft first. Baseline is the saved restaurant used for new comparisons; saved scenarios retain their original inputs. Maximum 50 configurations.</p>
    <label>Name for rename or duplicate<input value={name} maxLength={120} onChange={e => setName(e.target.value)} placeholder="Comfortable Dining" /></label>
    <div className="comparison-scroll"><table><caption>Geometry and capacity comparison · saved versions</caption>
      <thead><tr><th>Configuration</th><th>Seats</th><th>Room m² / seat</th><th>Projected revenue change / month</th><th>Actions</th></tr></thead>
      <tbody>{library.entries.map(entry => {
        const metrics = layoutMetrics(entry.layout);
        const result = simulateSeating(layoutMetrics(baseline.layout).seats, metrics.seats, assumptions);
        return <tr key={entry.id}><th>{entry.layout.name} {entry.id === library.activeId && "· Active"} {entry.id === library.baselineId && "· Baseline"}</th><td>{metrics.seats}</td><td>{metrics.areaPerSeat?.toFixed(2) ?? "Unavailable"}</td><td>${result.incrementalRevenuePerMonth.toFixed(0)}</td><td><div className="button-row">
          {(["open", "rename", "duplicate", "baseline", "delete"] as const).map(action => <StateButton type="button" className="button compact quiet" key={action} disabled={disabled || (action === "delete" && library.entries.length === 1) || (action === "duplicate" && library.entries.length >= 50)} onClick={() => onAction(action, entry.id, name.trim())}>{action === "baseline" ? "Use as baseline" : action[0].toUpperCase() + action.slice(1)}</StateButton>)}
        </div></td></tr>;
      })}</tbody></table></div>
    <details><summary>Comparison assumptions and limits</summary><p>Revenue change = seat difference × {assumptions.turnsPerDay} turns/day × {assumptions.occupancyFraction * 100}% occupancy × ${assumptions.averageCheck} average spend × {assumptions.operatingDaysPerMonth} days/month. Requires additional demand. Room area per seat includes kitchen and all other space; it is a density heuristic, not aisle clearance, aesthetics or measured satisfaction. Investment remains an editable scenario assumption below.</p></details>
  </details>;
}
