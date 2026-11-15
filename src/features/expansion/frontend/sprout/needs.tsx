"use client";

import { useEffect, useState } from "react";
import type { ProfileRevision } from "../../domain/requirements.ts";
import type { FormState } from "../profile-form.ts";
import { money } from "./model.ts";
import { Back, Disclosure, MoneyInput, QuestionShell, formatAmount, parseAmount } from "./ui.tsx";
import { loadNeighborhoodCatalog } from "../data/neighborhoods.ts";
import { normalizeNeighborhoodName, type NeighborhoodCatalog } from "../../domain/neighborhood.ts";

export const NEEDS_STEPS = 5;

const splitNeighborhoods = (raw: string) => raw.split(",").map((item) => item.trim()).filter(Boolean);

export function NeedsWizard({ form, onChange, step, onStep, fromExample, returnToReview, onReview, onExit }: {
  form: FormState;
  onChange: (form: FormState) => void;
  step: number;
  onStep: (step: number) => void;
  fromExample: boolean;
  returnToReview: boolean;
  onReview: () => void;
  onExit: () => void;
}) {
  const [error, setError] = useState("");
  const [rent, setRent] = useState(() => formatAmount(form.occupancy ? Number(form.occupancy) : null));
  const [seatsMin, setSeatsMin] = useState(form.seatsMin);
  const [seatsMax, setSeatsMax] = useState(form.seatsMax);
  const [catalog, setCatalog] = useState<NeighborhoodCatalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  useEffect(() => {
    if (step !== 0) return;
    const controller = new AbortController();
    loadNeighborhoodCatalog(controller.signal).then(setCatalog).catch(() => { if (!controller.signal.aborted) setCatalogError(true); });
    return () => controller.abort();
  }, [step]);

  const next = () => {
    setError("");
    if (returnToReview || step === NEEDS_STEPS - 1) onReview();
    else onStep(step + 1);
  };
  const back = () => {
    setError("");
    if (returnToReview) onReview();
    else if (step === 0) onExit();
    else onStep(step - 1);
  };
  const backButton = <Back onClick={back}>{returnToReview ? "Your needs" : "Back"}</Back>;
  const nextLabel = returnToReview ? "Done" : step === NEEDS_STEPS - 1 ? "Review" : "Next";

  if (step === 0) {
    const original = splitNeighborhoods(form.neighborhoods);
    const names = catalog?.neighborhoods.map(n => n.name) ?? [];
    const picked = names.filter(name => original.some(item => normalizeNeighborhoodName(item) === normalizeNeighborhoodName(name)));
    const options = [...names].sort((a, b) => Number(picked.includes(b)) - Number(picked.includes(a)) || a.localeCompare(b));
    const toggle = (name: string) => {
      const nextPicked = picked.includes(name) ? picked.filter((item) => item !== name) : [...picked, name];
      setError("");
      onChange({ ...form, neighborhoods: nextPicked.join(", ") });
    };
    return (
      <QuestionShell step={1} total={NEEDS_STEPS} title="Where would you like to expand?" onSubmit={() => {
        if (!catalog) { setError("Wait for the official neighborhood catalog, or retry if the City source is unavailable."); return; }
        if (!picked.length) { setError("Pick at least one official neighborhood. Other Houston areas stay in the search."); return; }
        onChange({ ...form, neighborhoods: picked.join(", ") });
        next();
      }} actions={<>{backButton}<span className="sx-spacer" /><button className="sx-btn sx-btn-primary sx-btn-big">{nextLabel}</button></>}>
        <div className="sx-stack">
          <div className="sx-chips"><button type="button" className="sx-chip sx-chip-lg" aria-pressed="true">Houston, TX</button></div>
          {fromExample && <p className="sx-small sx-muted">Filled in from the example profile</p>}
          <p className="sx-small sx-muted">We have property data for Houston so far. More cities will appear here.</p>
        </div>
        <fieldset className="sx-stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="sx-strong" style={{ marginBottom: 12 }}>Top 8 neighborhoods <span className="sx-muted" style={{ fontWeight: 400 }}>Choose your favorites</span></legend>
          <p className="sx-small sx-muted">Official City of Houston Super Neighborhoods. Informal neighborhood names can have different boundaries.</p>
          {catalog ? <p className="sx-small sx-muted">Most restaurant-compatible listings in our snapshot · <a href={catalog.sourceUrl} target="_blank" rel="noreferrer">City boundary source</a></p> : <p role="status">{catalogError ? "The City neighborhood source is unavailable. No example list is shown." : "Loading official City neighborhood names…"}</p>}
          {catalogError && <button type="button" className="sx-btn sx-btn-secondary" onClick={() => { setCatalogError(false); void loadNeighborhoodCatalog().then(setCatalog).catch(() => setCatalogError(true)); }}>Retry official source</button>}
          {catalog && original.some(item => !names.some(name => normalizeNeighborhoodName(item) === normalizeNeighborhoodName(name))) && <p className="sx-small sx-muted">An earlier preference isn’t in this top eight. Choose from the sourced areas below.</p>}
          <div className="sx-chips" style={{ maxHeight: 260, overflowY: "auto" }}>
            {options.map((name) => <button key={name} type="button" className="sx-chip" aria-pressed={picked.includes(name)} onClick={() => toggle(name)}>{name} · {catalog?.neighborhoods.find(n => n.name === name)?.listingCount} listings</button>)}
          </div>
        </fieldset>
        {error && <p className="sx-error" role="alert">{error}</p>}
      </QuestionShell>
    );
  }

  if (step === 1) {
    return (
      <QuestionShell step={2} total={NEEDS_STEPS} title="What’s your monthly rent budget?" hint="Include extra building charges like taxes and upkeep." onSubmit={() => {
        const value = parseAmount(rent);
        if (value === null || Number.isNaN(value) || value <= 0) { setError("Enter a monthly amount, like 5,000."); return; }
        onChange({ ...form, occupancy: String(value) });
        next();
      }} actions={<>{backButton}<span className="sx-spacer" /><button className="sx-btn sx-btn-primary sx-btn-big">{nextLabel}</button></>}>
        <MoneyInput label="Monthly rent budget" value={rent} onChange={setRent} suffix="/ month" autoFocus />
        {error && <p className="sx-error" role="alert">{error}</p>}
      </QuestionShell>
    );
  }

  if (step === 2) {
    const save = () => {
      const minimum = Number(seatsMin);
      const maximum = Number(seatsMax);
      if (!seatsMin.trim() || !seatsMax.trim() || !Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 0 || maximum < 0) {
        setError("Enter whole numbers for both, like 40 to 50."); return;
      }
      if (minimum > maximum) { setError("The fewest seats can’t be more than the most seats."); return; }
      onChange({ ...form, seatsMin: String(minimum), seatsMax: String(maximum) });
      next();
    };
    return (
      <QuestionShell step={3} total={NEEDS_STEPS} title="How many seats do you need?" hint="This is a preference. Places with a different size still show up." onSubmit={save}
        actions={<>{backButton}<span className="sx-spacer" />{!returnToReview && <button type="button" className="sx-btn sx-btn-text" onClick={next}>Skip</button>}<button className="sx-btn sx-btn-primary sx-btn-big">{nextLabel}</button></>}>
        <div className="sx-row">
          <MoneyInput label="Fewest seats" value={seatsMin} onChange={setSeatsMin} prefix="" suffix="seats" autoFocus />
          <span className="sx-muted">to</span>
          <MoneyInput label="Most seats" value={seatsMax} onChange={setSeatsMax} prefix="" suffix="seats" />
        </div>
        {error && <p className="sx-error" role="alert">{error}</p>}
      </QuestionShell>
    );
  }

  const isKitchen = step === 3;
  const value = isKitchen ? form.kitchen : form.parking;
  const options = isKitchen
    ? [{ value: true, title: "Yes, I need one", sub: "Hood and grease trap already there" }, { value: false, title: "Not required", sub: "I could build one if needed" }]
    : [{ value: true, title: "Must have", sub: "Customers need to park on site" }, { value: false, title: "Not required", sub: "Street parking or transit could work" }];
  return (
    <QuestionShell step={step + 1} total={NEEDS_STEPS} title={isKitchen ? "Do you need an existing kitchen?" : "Is customer parking a must-have?"} onSubmit={next}
      actions={<>{backButton}<span className="sx-spacer" /><button className="sx-btn sx-btn-primary sx-btn-big">{nextLabel}</button></>}>
      <div className="sx-choices" role="radiogroup" aria-label={isKitchen ? "Existing kitchen" : "Customer parking"}>
        {options.map((option) => (
          <button key={String(option.value)} type="button" role="radio" className="sx-choice" aria-checked={value === option.value}
            onClick={() => onChange(isKitchen ? { ...form, kitchen: option.value } : { ...form, parking: option.value })}>
            <span className="sx-choice-title">{option.title}</span>
            <span className="sx-choice-sub">{option.sub}</span>
          </button>
        ))}
      </div>
    </QuestionShell>
  );
}

export function needsRows(form: FormState) {
  const occupancy = Number(form.occupancy);
  return [
    { step: 0, label: "Where", value: `${splitNeighborhoods(form.neighborhoods).join(", ")}, Houston, TX` },
    { step: 1, label: "Monthly rent budget", value: form.occupancy && Number.isFinite(occupancy) ? `Up to ${money(occupancy)}` : "Not set" },
    { step: 2, label: "Seats", value: form.seatsMin && form.seatsMax ? `${form.seatsMin}–${form.seatsMax}` : "Not set" },
    { step: 3, label: "Existing kitchen", value: form.kitchen ? "Yes, I need one" : "Not required" },
    { step: 4, label: "Customer parking", value: form.parking ? "Must have" : "Not required" },
  ];
}

export function NeedsReview({ form, revisions, busy, error, onChange, onFind, onSaveExit, onBack }: {
  form: FormState;
  revisions: ProfileRevision[];
  busy: boolean;
  error: string;
  onChange: (step: number) => void;
  onFind: () => void;
  onSaveExit: () => void;
  onBack: () => void;
}) {
  const sorted = [...revisions].sort((a, b) => b.revisionNumber - a.revisionNumber);
  return (
    <main className="sx-page">
      <Back onClick={onBack}>Back</Back>
      <div className="sx-stack">
        <h1 className="sx-title">Here’s what we’ll look for</h1>
        <p className="sx-lead">Change anything before we start.</p>
      </div>
      <div className="sx-card">
        <ul className="sx-list">
          {needsRows(form).map((row) => (
            <li key={row.label}>
              <span className="sx-list-main"><span className="sx-list-label">{row.label}</span><span className="sx-list-value">{row.value}</span></span>
              <button type="button" className="sx-btn sx-btn-text" onClick={() => onChange(row.step)} aria-label={`Change ${row.label.toLowerCase()}`}>Change</button>
            </li>
          ))}
        </ul>
      </div>
      {error && <p className="sx-notice sx-notice-bad" role="alert">{error}</p>}
      <div className="sx-row">
        <button type="button" className="sx-btn sx-btn-primary sx-btn-big" disabled={busy} onClick={onFind}>Find Locations</button>
        <button type="button" className="sx-btn sx-btn-text" disabled={busy} onClick={onSaveExit}>Save and exit</button>
      </div>
      {sorted.length > 0 && (
        <Disclosure title="Profile history" hint={`Revision ${sorted[0].revisionNumber}`} last>
          <ul className="sx-list">
            {sorted.map((revision) => (
              <li key={revision.revisionId}>
                <span className="sx-list-main">
                  <span className="sx-strong">Revision {revision.revisionNumber}</span>
                  <span className="sx-list-label">{new Date(revision.createdAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} · {revision.editSummary}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="sx-small sx-muted">Each change is kept as a new revision. Your original interview answers are never rewritten.</p>
        </Disclosure>
      )}
    </main>
  );
}
