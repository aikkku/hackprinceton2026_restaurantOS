"use client";

import { useId, useRef, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Calculator, X } from "lucide-react";
import { assumptionsSchema, seatCountSchema, type Assumptions, type Fixture, type Scenario } from "../../domain/schemas";

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
          <div className="review-meta"><span className="pill">Demo review</span> <time dateTime={review.date}>{review.date}</time> <span>{review.rating}/5</span></div>
          <blockquote>{review.text}</blockquote>
          <p>{review.themes.join(" · ")}</p>
          <small>Source ID {review.id}</small>
        </li>
      ))}
    </ul>
  );
}

export function ScenarioPanel({ defaults, baselineSeats, draftSeats, scenario, saved, isSaved, overlaps, layoutChanged, notice, onSimulate, onSave, onOpen, onLoadLayout, onReset, formVersion }: {
  defaults: Assumptions;
  baselineSeats: number;
  draftSeats: number;
  scenario: Scenario | null;
  saved: Scenario[];
  isSaved: boolean;
  overlaps: boolean;
  layoutChanged: boolean;
  notice: string | null;
  onSimulate: (baseline: number, assumptions: Assumptions) => void;
  onSave: () => void;
  onOpen: (scenario: Scenario) => void;
  onLoadLayout: (scenario: Scenario) => void;
  onReset: () => void;
  formVersion: number;
}) {
  const analysis = useRef<HTMLDialogElement>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const baseline = seatCountSchema.safeParse(Number(form.get("baseline")));
    const inputs = assumptionsSchema.safeParse(Object.fromEntries(fields.map((field) => [
      field.key,
      Number(form.get(field.key)) / (field.factor ?? 1),
    ])));
    if (baseline.success && inputs.success) onSimulate(baseline.data, inputs.data);
  }

  return (
    <section className="panel scenario-panel" id="seating-scenario" aria-labelledby="scenario-title">
      <div className="panel-heading">
        <div className="section-icon"><Calculator size={18} /></div>
        <div><h2 id="scenario-title">Seating scenario</h2><p>Compare a layout change with your baseline.</p></div>
      </div>
      <div className="scenario-body">
        <form key={formVersion} onSubmit={submit}>
          <h3>Assumptions</h3>
          <div className="assumption-grid">
            <label>Baseline seats<input name="baseline" type="number" min={0} max={15000} step="1" defaultValue={baselineSeats} required /></label>
            <label>Draft seats <output className="draft-output">{draftSeats}</output></label>
            {fields.map((field) => (
              <label key={field.key}>{field.label}<input
                name={field.key} type="number" min={field.min} max={field.max} step={field.step}
                defaultValue={Number((defaults[field.key] * (field.factor ?? 1)).toPrecision(15))}
                required
              /></label>
            ))}
          </div>
          {overlaps && <p className="warning-message">Resolve furniture overlaps before previewing.</p>}
          <div className="button-row">
            <button className="button primary" type="submit" disabled={overlaps}>Preview outcome <ArrowRight size={16} /></button>
            <button className="button quiet" type="button" onClick={onReset}>Reset scenario</button>
          </div>
        </form>
        <div className="outcome" aria-live="polite">
          <div className="outcome-heading"><h3>Projected outcome</h3><span className="pill">Simulated</span></div>
          {scenario ? (
            <>
              {layoutChanged && <p className="outcome-note">This snapshot uses an earlier layout. Preview again to use the current draft.</p>}
              <p className="muted">{scenario.baselineSeats} baseline seats → {scenario.result.draftSeats} scenario seats ({signed.format(scenario.result.seatChange)})</p>
              <dl className="results">
                <div><dt>Daily covers</dt><dd>{signed.format(scenario.result.additionalCoversPerDay)}</dd></div>
                <div><dt>Monthly revenue</dt><dd>{signedCurrency.format(scenario.result.incrementalRevenuePerMonth)}</dd></div>
                <div><dt>Monthly contribution</dt><dd>{signedCurrency.format(scenario.result.incrementalContributionPerMonth)}</dd></div>
                <div><dt>Simple payback</dt><dd>{scenario.result.simplePaybackMonths === null ? "Unavailable" : `${number.format(scenario.result.simplePaybackMonths)} mo`}</dd></div>
              </dl>
              <p className="muted">Added seats need enough demand to reach the assumed occupancy.</p>
              <div className="button-row">
                <button className="button primary" type="button" onClick={onSave} disabled={isSaved}>{isSaved ? "Scenario saved" : "Save scenario"}</button>
                <button className="button secondary" type="button" onClick={() => analysis.current?.showModal()}>View analysis</button>
                {layoutChanged && <button className="button quiet" type="button" onClick={() => onLoadLayout(scenario)}>Load scenario layout</button>}
              </div>
            </>
          ) : <p className="outcome-empty">Preview to see the capacity change, monthly contribution, and estimated payback.</p>}
          {notice && <p className="warning-message outcome-note">{notice}</p>}
        </div>
      </div>
      {saved.length > 0 && (
        <div className="saved-scenarios">
          <h3>Saved scenarios</h3>
          <ul>{saved.map((item) => (
            <li key={item.id}>
              <span>
                {item.baselineSeats} → {item.result.draftSeats} seats · {signedCurrency.format(item.result.incrementalContributionPerMonth)}/mo
                <small><time dateTime={item.createdAt}>{item.createdAt.replace("T", " ").slice(0, 16)} UTC</time></small>
              </span>
              <button className="button compact secondary" type="button" onClick={() => onOpen(item)} aria-label={`Open scenario from ${item.createdAt}`}>Open</button>
            </li>
          ))}</ul>
        </div>
      )}
      <AnalysisDialog dialogRef={analysis} title="Scenario analysis">
        {scenario && <>
          <h3>Inputs and origin</h3>
          <dl className="analysis-inputs">
            <div><dt>Baseline seats · Assumption</dt><dd>{scenario.baselineSeats}</dd></div>
            <div><dt>Scenario seats · Derived from draft</dt><dd>{scenario.result.draftSeats}</dd></div>
            {fields.map(({ key, label, factor }) => (
              <div key={key}><dt>{label} · Assumption</dt><dd>{key === "averageCheck" || key === "investmentCost"
                ? currency.format(scenario.assumptions[key])
                : inputNumber.format(scenario.assumptions[key] * (factor ?? 1))}</dd></div>
            ))}
          </dl>
          <h3>Formulas · {scenario.modelVersion}</h3>
          <ol className="formula-list">
            <li>Seat change = draft seats − baseline seats.</li>
            <li>Daily cover change = seat change × turns per seat × occupancy.</li>
            <li>Monthly revenue change = daily cover change × average check × operating days.</li>
            <li>Monthly contribution change = monthly revenue change × contribution margin.</li>
            <li>Simple payback = investment ÷ positive monthly contribution from added seats.</li>
          </ol>
          <h3>Limits and missing data</h3>
          <p>Extra demand, table-size mix, and actual room constraints are unknown in this demo. The model assumes extra demand and does not account for fixed costs, financing, taxes, displacement, or permit requirements.</p>
          <h3>Evidence · {scenario.missionTitle}</h3>
          <ReviewEvidence reviews={scenario.evidence} />
        </>}
      </AnalysisDialog>
    </section>
  );
}
