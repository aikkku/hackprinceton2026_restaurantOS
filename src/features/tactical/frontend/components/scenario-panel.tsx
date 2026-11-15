"use client";

import { StateButton } from "./state-button";

import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Calculator, X } from "lucide-react";
import { assumptionsSchema, seatCountSchema, type Assumptions, type Fixture, type Scenario, type ScenarioAction, type ScenarioSettings, scenarioSettingsSchema } from "../../domain/schemas";

import { recomputeScenario, scenarioAction, scenarioLabel } from "../../domain/scenario";
import { ScenarioComparison } from "./scenario-comparison";

const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 });
const inputNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });
const signed = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, signDisplay: "exceptZero" });
const signedCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, signDisplay: "exceptZero" });
const fields: Array<{ key: keyof Assumptions; label: string; min: number; max: number; step: string; factor?: number }> = [
  { key: "turnsPerDay", label: "Turns per seat per day", min: 0, max: 24, step: "any" },
  { key: "occupancyFraction", label: "Occupancy (%)", min: 0, max: 100, step: "any", factor: 100 },
  { key: "averageCheck", label: "Average check (USD)", min: 0, max: 100_000, step: "any" },
  { key: "operatingDaysPerMonth", label: "Operating days per month", min: 0, max: 31, step: "1" },
  { key: "incrementalContributionMargin", label: "Contribution margin (%)", min: -100, max: 100, step: "any", factor: 100 },
  { key: "investmentCost", label: "Investment (USD)", min: 0, max: 100_000_000, step: "any" },
];

export function AnalysisDialog({ dialogRef, title, children }: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  title: string;
  children: ReactNode;
}) {
  const titleId = useId();

  return (
    <dialog ref={dialogRef} className="analysis-dialog" aria-labelledby={titleId}>
      <div className="analysis-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={() => dialogRef.current?.close()} aria-label="Close analysis"><X size={19} /></button>
      </div>
      <div className="analysis-content">{children}</div>
    </dialog>
  );
}

export function ReviewEvidence({ reviews }: { reviews: Fixture["reviews"] }) {
  return (
    <ul className="review-list">
      {reviews.map((review) => (
        <li key={review.id}>
          <div className="review-meta"><time dateTime={review.date}>{review.date}</time> <span>{review.rating}/5</span></div>
          <blockquote>{review.text}</blockquote>
          <p>{review.themes.join(" · ")}</p>
          <small>Source ID {review.id}</small>
        </li>
      ))}
    </ul>
  );
}

export function ScenarioPanel({
  defaults, baselineSeats, draftSeats, scenario, saved, isSaved, overlaps, layoutChanged, notice,
  onSimulate, onSave, onOpen, onDelete, onLoadLayout, onReset, formVersion, defaultAction, defaultTargetTurnsPerDay,
}: {
  defaults: Assumptions;
  baselineSeats: number;
  draftSeats: number;
  scenario: Scenario | null;
  saved: Scenario[];
  isSaved: boolean;
  overlaps: boolean;
  layoutChanged: boolean;
  notice: string | null;
  onSimulate: (baseline: number, assumptions: Assumptions, settings: ScenarioSettings) => void;
  onSave: () => void;
  onOpen: (scenario: Scenario) => void;
  onDelete: (id: string) => void;
  onLoadLayout: (scenario: Scenario) => void;
  onReset: () => void;
  formVersion: number;
  defaultAction?: ScenarioAction;
  defaultTargetTurnsPerDay?: number;
}) {
  const analysis = useRef<HTMLDialogElement>(null);
  const [action, setAction] = useState<ScenarioAction>(defaultAction ?? scenario?.action ?? "seating");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = action === "seating" && overlaps;
  const snapshotTurnover = scenario?.action === "turnover";
  const snapshotStale = dirty || Boolean(layoutChanged && !snapshotTurnover);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const baseline = seatCountSchema.safeParse(Number(form.get("baseline")));
    const inputs = assumptionsSchema.safeParse(Object.fromEntries(fields.map((field) => [
      field.key,
      Number(form.get(field.key)) / (field.factor ?? 1),
    ])));
    const settings = scenarioSettingsSchema.safeParse({
      label: form.get("label"),
      action,
      targetTurnsPerDay: action === "turnover" ? Number(form.get("targetTurnsPerDay")) : undefined,
    });
    if (!baseline.success || !inputs.success || !settings.success) {
      setError("Check the scenario name and enter valid numeric assumptions.");
      return;
    }
    if (blocked) return;
    onSimulate(baseline.data, inputs.data, settings.data);
    setDirty(false);
    setError(null);
  }

  return (
    <section className="panel scenario-panel" id="seating-scenario" aria-labelledby="scenario-title">
      <div className="panel-heading">
        <div className="section-icon"><Calculator size={18} /></div>
        <div><h2 id="scenario-title">Seating scenario</h2><p>Explore capacity and turnover with editable assumptions.</p></div>
      </div>
      <div className="scenario-action-picker" aria-label="Scenario action">
        <button type="button" className="button secondary" aria-pressed={action === "seating"} onClick={() => { setAction("seating"); setDirty(true); }}>Change seating</button>
        <button type="button" className="button secondary" aria-pressed={action === "turnover"} onClick={() => { setAction("turnover"); setDirty(true); }}>Improve turnover</button>
      </div>
      <p className="scenario-action-note">{action === "turnover"
        ? "Turnover uses baseline seats and the change in turns per seat. Choose a target you can support operationally."
        : "Seating uses the capacity difference between your draft layout and baseline."}</p>
      <div className="scenario-body">
        <form key={formVersion} onSubmit={submit} onChange={() => setDirty(true)}>
          <label className="scenario-name">Scenario name<input name="label" defaultValue={scenario ? scenarioLabel(scenario) : action === "turnover" ? "My turnover experiment" : "My seating experiment"} maxLength={80} required /></label>
          <h3>Assumptions</h3>
          <div className="assumption-grid">
            <label>Baseline seats<input name="baseline" type="number" min={0} max={15000} step="1" defaultValue={baselineSeats} required /></label>
            {action === "seating"
              ? <label>Draft seats <output className="draft-output">{draftSeats}</output></label>
              : <label>Target turns per seat per day<input name="targetTurnsPerDay" type="number" min={0} max={24} step="any" defaultValue={defaultTargetTurnsPerDay ?? scenario?.targetTurnsPerDay ?? defaults.turnsPerDay} required /></label>}
            {fields.map((field) => (
              <label key={field.key}>{field.key === "turnsPerDay" && action === "turnover" ? "Baseline turns per seat per day" : field.label}<input
                name={field.key} type="number" min={field.min} max={field.max} step={field.step}
                defaultValue={Number((defaults[field.key] * (field.factor ?? 1)).toPrecision(15))}
                required
              /></label>
            ))}
          </div>
          {blocked && <p className="warning-message">Resolve furniture overlaps before previewing.</p>}
          {error && <p className="warning-message" role="alert">{error}</p>}
          <div className="button-row">
            <StateButton className="button primary" type="submit" disabled={blocked}>Preview outcome <ArrowRight size={16} /></StateButton>
            <button className="button quiet" type="button" onClick={onReset}>Reset scenario</button>
          </div>
        </form>
        <div className="outcome" aria-live="polite">
          <div className="outcome-heading"><h3>Projected outcome</h3><span className="pill">Simulated</span></div>
          {scenario ? (
            <>
              <h3>{scenarioLabel(scenario)}</h3>
              {snapshotStale && <p className="outcome-note">Inputs changed since this preview. Preview again to update the outcome and save it.</p>}
              <p className="muted">{snapshotTurnover
                ? `${scenario.baselineSeats} seats · ${inputNumber.format(scenario.assumptions.turnsPerDay)} → ${inputNumber.format(scenario.targetTurnsPerDay!)} turns per day`
                : `${scenario.baselineSeats} baseline seats → ${scenario.result.draftSeats} scenario seats (${signed.format(scenario.result.seatChange)})`}</p>
              <dl className="results">
                <div><dt>Daily covers</dt><dd>{signed.format(scenario.result.additionalCoversPerDay)}</dd></div>
                <div><dt>Monthly revenue</dt><dd>{signedCurrency.format(scenario.result.incrementalRevenuePerMonth)}</dd></div>
                <div><dt>Monthly contribution</dt><dd>{signedCurrency.format(scenario.result.incrementalContributionPerMonth)}</dd></div>
                <div><dt>Simple payback</dt><dd>{scenario.result.simplePaybackMonths === null ? "Unavailable" : `${number.format(scenario.result.simplePaybackMonths)} mo`}</dd></div>
              </dl>
              <p className="muted">Additional covers need enough demand to reach the assumed occupancy.</p>
              <div className="button-row">
                <StateButton className="button primary" type="button" onClick={onSave} disabled={isSaved || snapshotStale}>{isSaved ? "Scenario saved" : "Save scenario"}</StateButton>
                <button className="button secondary" type="button" onClick={() => analysis.current?.showModal()}>View analysis</button>
                {layoutChanged && !snapshotTurnover && <button className="button quiet" type="button" onClick={() => onLoadLayout(scenario)}>Load scenario layout</button>}
              </div>
            </>
          ) : <p className="outcome-empty">Preview to see the capacity change, monthly contribution, and estimated payback.</p>}
          {notice && <p className="warning-message outcome-note">{notice}</p>}
        </div>
      </div>
      <div className="saved-scenarios">
        <h3>Saved scenarios</h3>
        {saved.length > 0 && <ul>{saved.map((item) => (
          <li key={item.id}>
            <span>
              <span className="scenario-saved-label">{scenarioLabel(item)}</span>
              {scenarioAction(item) === "turnover" ? "Turnover" : "Seating"} · {signedCurrency.format(item.result.incrementalContributionPerMonth)}/mo
              <small><time dateTime={item.createdAt}>{item.createdAt.replace("T", " ").slice(0, 16)} UTC</time></small>
            </span>
            <div className="scenario-list-actions">
              <button className="button compact secondary" type="button" onClick={() => onOpen(item)} aria-label={`Open scenario from ${item.createdAt}`}>Open</button>
              <button className="button compact quiet danger" type="button" onClick={() => onDelete(item.id)} aria-label={`Delete scenario ${scenarioLabel(item)}`}>Delete</button>
            </div>
          </li>
        ))}</ul>}
        <ScenarioComparison saved={saved} />
      </div>
      <AnalysisDialog dialogRef={analysis} title="Scenario analysis">
        {scenario && <>
          <h3>{scenarioLabel(scenario)}</h3>
          <h3>Inputs and origin</h3>
          <dl className="analysis-inputs">
            <div><dt>Baseline seats · Assumption</dt><dd>{scenario.baselineSeats}</dd></div>
            <div><dt>{snapshotTurnover ? "Scenario seats · Baseline assumption" : "Scenario seats · Derived from draft"}</dt><dd>{scenario.result.draftSeats}</dd></div>
            {snapshotTurnover && <div><dt>Target turns per day · Assumption</dt><dd>{inputNumber.format(scenario.targetTurnsPerDay!)}</dd></div>}
            {fields.map(({ key, label, factor }) => (
              <div key={key}><dt>{label} · Assumption</dt><dd>{key === "averageCheck" || key === "investmentCost"
                ? currency.format(scenario.assumptions[key])
                : inputNumber.format(scenario.assumptions[key] * (factor ?? 1))}</dd></div>
            ))}
          </dl>
          <h3>Formulas · {scenario.modelVersion}</h3>
          <ol className="formula-list">
            {snapshotTurnover ? <li>Daily cover change = baseline seats × (target turns − baseline turns) × occupancy.</li> : <>
              <li>Seat change = draft seats − baseline seats.</li>
              <li>Daily cover change = seat change × turns per seat × occupancy.</li>
            </>}
            <li>Monthly revenue change = daily cover change × average check × operating days.</li>
            <li>Monthly contribution change = monthly revenue change × contribution margin.</li>
            <li>Simple payback = investment ÷ positive monthly contribution when covers increase.</li>
          </ol>
          <h3>Occupancy sensitivity</h3>
          <p className="sensitivity-note">These examples vary occupancy by ten percentage points, capped at 0–100%. Adjust occupancy in the scenario form to explore another assumption.</p>
          <table className="sensitivity-table">
            <caption>Monthly contribution with different occupancy</caption>
            <thead><tr><th scope="col">Occupancy</th><th scope="col">Contribution change</th></tr></thead>
            <tbody>{[...new Set([
              Math.max(0, scenario.assumptions.occupancyFraction - 0.1),
              scenario.assumptions.occupancyFraction,
              Math.min(1, scenario.assumptions.occupancyFraction + 0.1),
            ])].map((occupancyFraction) => <tr key={occupancyFraction}>
              <th scope="row">{number.format(occupancyFraction * 100)}%</th>
              <td>{signedCurrency.format(recomputeScenario(scenario, { ...scenario.assumptions, occupancyFraction }).incrementalContributionPerMonth)}</td>
            </tr>)}</tbody>
          </table>
          <h3>Limits and missing data</h3>
          <p>Extra demand, table-size mix, and actual room constraints are unknown. The model assumes extra demand and excludes fixed costs, financing, taxes, displacement, and permit requirements. Turnover targets also depend on service capacity and customer dining time.</p>
          <h3>Evidence · {scenario.missionTitle}</h3>
          <ReviewEvidence reviews={scenario.evidence} />
        </>}
      </AnalysisDialog>
    </section>
  );
}
