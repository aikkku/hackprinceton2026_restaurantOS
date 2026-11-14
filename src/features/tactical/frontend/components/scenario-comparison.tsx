"use client";

import { useState } from "react";
import { scenarioAction, scenarioLabel } from "../../domain/scenario";
import type { Scenario } from "../../domain/schemas";
import "./scenario-comparison.css";

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const deltaCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, signDisplay: "exceptZero" });

function actionLabel(scenario: Scenario) {
  return scenarioAction(scenario) === "turnover" ? "Improve turnover" : "Change seating";
}

const rows: Array<{ label: string; value: (scenario: Scenario) => string }> = [
  { label: "Action", value: actionLabel },
  { label: "Baseline capacity", value: (item) => `${item.baselineSeats} seats` },
  { label: "Scenario capacity", value: (item) => `${item.result.draftSeats} seats` },
  { label: "Baseline turns / day", value: (item) => number.format(item.assumptions.turnsPerDay) },
  { label: "Scenario turns / day", value: (item) => number.format(scenarioAction(item) === "turnover" ? item.targetTurnsPerDay! : item.assumptions.turnsPerDay) },
  { label: "Occupancy", value: (item) => `${number.format(item.assumptions.occupancyFraction * 100)}%` },
  { label: "Average check", value: (item) => currency.format(item.assumptions.averageCheck) },
  { label: "Operating days / month", value: (item) => number.format(item.assumptions.operatingDaysPerMonth) },
  { label: "Contribution margin", value: (item) => `${number.format(item.assumptions.incrementalContributionMargin * 100)}%` },
  { label: "Investment", value: (item) => currency.format(item.assumptions.investmentCost) },
  { label: "Daily cover change", value: (item) => number.format(item.result.additionalCoversPerDay) },
  { label: "Monthly revenue change", value: (item) => deltaCurrency.format(item.result.incrementalRevenuePerMonth) },
  { label: "Monthly contribution change", value: (item) => deltaCurrency.format(item.result.incrementalContributionPerMonth) },
  { label: "Simple payback", value: (item) => item.result.simplePaybackMonths === null ? "Unavailable" : `${number.format(item.result.simplePaybackMonths)} months` },
  { label: "Model", value: (item) => item.modelVersion },
  { label: "Mission evidence", value: (item) => item.evidence.map((review) => review.id).join(", ") },
];

export function ScenarioComparison({ saved }: { saved: Scenario[] }) {
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  if (saved.length < 2) {
    return <p className="comparison-empty">Save two alternatives to compare their assumptions and outcomes side by side.</p>;
  }

  const left = saved.find(({ id }) => id === leftId) ?? saved[0];
  const right = saved.find(({ id }) => id === rightId && id !== left.id)
    ?? saved.find(({ id }) => id !== left.id)!;
  const contributionDifference = right.result.incrementalContributionPerMonth - left.result.incrementalContributionPerMonth;
  const differentContext = left.baselineSeats !== right.baselineSeats
    || left.assumptions.turnsPerDay !== right.assumptions.turnsPerDay
    || left.assumptions.occupancyFraction !== right.assumptions.occupancyFraction
    || left.assumptions.averageCheck !== right.assumptions.averageCheck
    || left.assumptions.operatingDaysPerMonth !== right.assumptions.operatingDaysPerMonth
    || left.assumptions.incrementalContributionMargin !== right.assumptions.incrementalContributionMargin;

  return (
    <details className="scenario-comparison">
      <summary>Compare saved scenarios</summary>
      <div className="comparison-selects">
        <label>Scenario A<select value={left.id} onChange={(event) => setLeftId(event.target.value)}>
          {saved.map((item) => <option key={item.id} value={item.id}>{scenarioLabel(item)}</option>)}
        </select></label>
        <label>Scenario B<select value={right.id} onChange={(event) => setRightId(event.target.value)}>
          {saved.filter(({ id }) => id !== left.id).map((item) => <option key={item.id} value={item.id}>{scenarioLabel(item)}</option>)}
        </select></label>
      </div>
      <p className="comparison-delta">B changes monthly contribution by {deltaCurrency.format(contributionDifference)} relative to A under these assumptions.</p>
      {differentContext && <p className="comparison-caveat">These scenarios use different baseline or demand assumptions. Review the inputs before attributing the difference to the action.</p>}
      <div className="comparison-scroll" tabIndex={0} aria-label="Scenario comparison table">
        <table>
          <caption>Saved scenario inputs and modeled outcomes</caption>
          <thead><tr><th scope="col">Measure</th><th scope="col">A · {scenarioLabel(left)}</th><th scope="col">B · {scenarioLabel(right)}</th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.label}><th scope="row">{row.label}</th><td>{row.value(left)}</td><td>{row.value(right)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </details>
  );
}
