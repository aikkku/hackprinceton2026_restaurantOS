"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Bookmark, ClipboardList, RefreshCw, Scale } from "lucide-react";
import { createDecisionBrief, type BriefChoice, type DecisionBrief, type InvestigationRun } from "../../domain/decision-brief.ts";
import { calculateDecisionFinance, decisionFinanceInputsSchema, emptyFinanceInputs, upfrontCategories, type DecisionFinanceInputs } from "../../domain/decision-finance.ts";
import { EVIDENCE_VERSION, investigationNoteSchema, providerNames, reassessCandidate, type InvestigationNote, type SourceSnapshot } from "../../domain/evidence.ts";
import type { AssessedCandidate, CandidateFact } from "../../domain/matching.ts";
import { requirementDisplayValue } from "../../domain/requirements.ts";
import { BRIEF_STORAGE_KEY, decodeBriefs, persistBriefs, resetBriefs } from "../brief-storage.ts";
import { loadInvestigationRun, refreshCandidateSources } from "../data/investigation-client.ts";
import { GROUP_LABELS, REQUIREMENT_LABELS } from "./run-search.tsx";
import "./decision-workbench.css";

const money = (value: number | null) => value === null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const moneyRange = (range: { low: number; high: number | null } | null) => !range ? "Unavailable" : range.high === null ? `${money(range.low)}+ (upper unknown)` : range.low === range.high ? money(range.low) : `${money(range.low)}–${money(range.high)}`;
const emptySources = (candidateId: string): SourceSnapshot => ({ version: EVIDENCE_VERSION, candidateId, refreshedAt: new Date().toISOString(), statuses: providerNames.map(provider => ({ provider, status: "unavailable", mode: "unavailable", checkedAt: new Date().toISOString(), capabilities: [], reason: "Not refreshed. No external facts loaded." })), observations: [], gaps: ["Source evidence has not been refreshed."] });

function initialChoice(bundle: InvestigationRun, base: AssessedCandidate): BriefChoice {
  const financeInputs = emptyFinanceInputs();
  const numeric = (id: string) => { const requirement = bundle.profile.requirements.requirements.find(x => x.id === id); return requirement?.value.kind === "number" ? requirement.value.value : null; };
  financeInputs.totalFunds = numeric("funds.totalAvailable");
  financeInputs.reserve = numeric("funds.emergencyReserve");
  return {
    candidateId: base.candidate.id, assessmentHistory: [],
    assessment: reassessCandidate(base, bundle.profile.requirements, [], emptySources(base.candidate.id), { id: crypto.randomUUID(), parentId: null, revisionNumber: 0, evaluatedAt: new Date().toISOString() }),
    financeInputs, financeResults: calculateDecisionFinance(base.candidate, financeInputs),
  };
}

export function DecisionWorkbench({ requestedRunId, currentProfileRevisionId }: { requestedRunId: string | null; currentProfileRevisionId: string | null }) {
  const [bundle, setBundle] = useState<InvestigationRun | null>(null);
  const [choices, setChoices] = useState<Record<string, BriefChoice>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [activeId, setActiveId] = useState("");
  const [runInput, setRunInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<DecisionBrief[]>([]);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [restored, setRestored] = useState<DecisionBrief | null>(null);
  const [title, setTitle] = useState("Expansion decision brief");
  const [currentAddress, setCurrentAddress] = useState("");
  const [priceLevel, setPriceLevel] = useState("");
  const [pendingFinance, setPendingFinance] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const generationRef = useRef(0);

  const applyBundle = (next: InvestigationRun) => {
    setBundle(next); setChoices(Object.fromEntries(next.search.candidates.map(x => [x.candidate.id, initialChoice(next, x)])));
    setActiveId(next.search.candidates[0]?.candidate.id ?? ""); setSelected([]); setRestored(null); setRunInput(next.run.runId); setPendingFinance(false);
  };
  useEffect(() => {
    // Read storage asynchronously after hydration, without silently rewriting it.
    void Promise.resolve().then(() => {
      try {
        const decoded = decodeBriefs(localStorage.getItem(BRIEF_STORAGE_KEY));
        if (decoded.status === "ok") setSaved(decoded.briefs);
        else { setStorageBlocked(true); setNotice(decoded.reason); }
      } catch { setStorageBlocked(true); setNotice("Browser storage is blocked. Work stays in memory; saving is unavailable."); }
    });
  }, []);
  useEffect(() => {
    if (!requestedRunId) return;
    const controller = new AbortController();
    const generation = ++generationRef.current;
    void loadInvestigationRun(requestedRunId, controller.signal).then(next => {
      if (generation !== generationRef.current) return;
      applyBundle(next); setBusy(false); setError("");
      sectionRef.current?.scrollIntoView({ block: "start" });
      sectionRef.current?.focus({ preventScroll: true });
    }).catch(failure => { if (!controller.signal.aborted) { setBusy(false); setError(failure instanceof Error ? failure.message : "Run could not load."); } });
    return () => controller.abort();
  }, [requestedRunId]);

  const load = async () => {
    setBusy(true); setError("");
    const generation = ++generationRef.current;
    try { const next = await loadInvestigationRun(runInput); if (generation === generationRef.current) applyBundle(next); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Run could not load."); }
    finally { setBusy(false); }
  };
  const active = bundle?.search.candidates.find(x => x.candidate.id === activeId);
  const choice = choices[activeId];
  const revise = (candidateId: string, notes: InvestigationNote[], sources: SourceSnapshot) => {
    if (!bundle) return;
    const base = bundle.search.candidates.find(x => x.candidate.id === candidateId)!;
    setChoices(previous => {
      const old = previous[candidateId];
      if (!old) return previous;
      const assessment = reassessCandidate(base, bundle.profile.requirements, notes, sources, { id: crypto.randomUUID(), parentId: old.assessment.id, revisionNumber: old.assessment.revisionNumber + 1, evaluatedAt: new Date().toISOString() });
      return { ...previous, [candidateId]: { ...old, assessment, assessmentHistory: [...old.assessmentHistory, old.assessment] } };
    });
  };
  const refresh = async () => {
    if (!bundle || !choice) return;
    const candidateId = activeId;
    const runId = bundle.run.runId;
    const generation = generationRef.current;
    setBusy(true); setError("");
    try {
      const sources = await refreshCandidateSources(runId, candidateId, { currentAddress: currentAddress.trim() || null, priceLevel: priceLevel.trim() ? Number(priceLevel) : null });
      if (generation !== generationRef.current) return;
      revise(candidateId, choices[candidateId].assessment.notes, sources);
      setNotice("Sources refreshed into a new assessment revision. Historical run and saved brief remain unchanged.");
    } catch { setError("Source refresh failed. The previous evidence snapshot is preserved; retry when the source is available."); }
    finally { setBusy(false); }
  };
  const save = () => {
    if (!bundle) return;
    try {
      const brief = createDecisionBrief({ id: crypto.randomUUID(), title, createdAt: new Date().toISOString(), parentBriefId: restored?.id ?? null, runSnapshot: bundle,
        choices: selected.map(id => choices[id]), nextQuestions: [...new Set([...bundle.summary.followUps, ...selected.flatMap(id => choices[id].assessment.assessments.filter(x => x.status === "unknown").map(x => x.reason)), ...selected.flatMap(id => choices[id].financeResults.gaps)])] });
      const next = [brief, ...saved].slice(0, 10);
      persistBriefs(localStorage, next); setSaved(next); setRestored(brief); setNotice("Decision brief saved with frozen evidence and calculation snapshots.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Saving failed. Your work remains in memory."); }
  };
  const restore = (brief: DecisionBrief) => {
    generationRef.current += 1;
    setBundle(brief.runSnapshot); setChoices(Object.fromEntries(brief.choices.map(x => [x.candidateId, x])));
    setSelected(brief.choices.map(x => x.candidateId)); setActiveId(brief.choices[0].candidateId); setRestored(brief); setTitle(brief.title); setRunInput(brief.runSnapshot.run.runId); setBusy(false); setError(""); setPendingFinance(false);
    setNotice("Restored saved evidence without contacting providers. Use Refresh sources explicitly to re-evaluate.");
  };
  const chooseSpace = (id: string) => {
    if (!bundle) return;
    if (pendingFinance) setNotice("Unapplied finance edits were discarded when changing spaces. Applied plans remain unchanged.");
    setPendingFinance(false);
    if (!choices[id]) setChoices(old => ({ ...old, [id]: initialChoice(bundle, bundle.search.candidates.find(x => x.candidate.id === id)!) }));
    setActiveId(id);
  };

  return <section id="decision-workbench" ref={sectionRef} tabIndex={-1} className="decision-workbench" aria-label="Investigation and decision briefs">
    <div className="section-heading"><div><p className="eyebrow">INVESTIGATE → COMPARE → DECIDE</p><h2><Scale size={20} /> Build an expansion brief</h2></div><span className="tiny-badge">Evidence before commitment</span></div>
    <p>Investigate a finished scouting run, compare two or three spaces, then keep a reproducible plan. Sources and assumptions stay separate.</p>
    <form className="decision-inline" onSubmit={event => { event.preventDefault(); void load(); }}><label>Completed agent run ID<input value={runInput} onChange={event => setRunInput(event.target.value)} required maxLength={64} pattern="[A-Za-z0-9-]+" /></label><button className="secondary" disabled={busy}>Load run for investigation</button></form>
    {busy && <p role="status">Loading investigation evidence…</p>}
    {error && <p className="warning" role="alert">{error}</p>}
    {notice && <p role="status" className="decision-notice">{notice}</p>}
    <details className="saved-briefs"><summary><Bookmark size={15} /> Saved decision briefs ({saved.length})</summary>
      {storageBlocked && <><p className="warning">Saving is disabled. Existing storage is preserved.</p><button className="secondary" onClick={() => { try { resetBriefs(localStorage); setStorageBlocked(false); setSaved([]); setNotice("Brief storage reset explicitly. Legacy scenarios are unchanged."); } catch { setError("Browser storage is still blocked."); } }}>Reset brief storage</button></>}
      {!saved.length && <p>No decision briefs saved yet. Legacy scenarios remain in the existing saved plans.</p>}
      {saved.map(brief => <article key={brief.id}><strong>{brief.title}</strong><p>{brief.runSnapshot.profile.intake.restaurant.name} · profile revision {brief.runSnapshot.profile.revisionNumber} · {brief.createdAt} · {brief.runSnapshot.run.executionMode === "scripted" ? "Scripted test model" : "Live model"}</p><button className="secondary" onClick={() => restore(brief)}>Restore brief: {brief.title}</button></article>)}
    </details>
    {bundle && <>
      <div className="decision-run-meta"><p><strong>{bundle.profile.intake.restaurant.name}</strong> · profile revision {bundle.profile.revisionNumber} · run {bundle.run.runId}</p><p>{bundle.run.executionMode === "scripted" ? "Deep Agents · scripted test model (synthetic acceptance, not live-model proof)" : "Deep Agents · live model"} · {bundle.run.datasetId ?? "Dataset unavailable"} · dataset date {bundle.run.datasetDate ?? "unknown"}</p><p>Profile origin: {bundle.profile.intake.origin}. Property source: {bundle.search.candidates.some(x => x.candidate.isDemo) || bundle.run.datasetId?.includes("synthetic") ? "synthetic test inputs" : "dated local records"}.</p></div>
      {currentProfileRevisionId !== bundle.profile.revisionId && <p className="warning">This brief uses a different profile revision. Comparisons stay bound to the saved profile; start a new agent run to use current requirements.</p>}
      {restored && <p className="warning">Viewing saved snapshot from {restored.createdAt}. Source availability and freshness may have changed.</p>}
      {!bundle.search.candidates.length ? <div className="empty-state"><h3>No candidates to investigate</h3><p>No matches were invented. Revise the profile and run scouting again.</p></div> : <>
        <p className="small-note">No fully verified match is required to compare. Unresolved hard requirements remain visible.</p>
        <div className="decision-picker"><label>Space to investigate<select value={activeId} onChange={event => chooseSpace(event.target.value)}>
          {bundle.search.candidates.map(base => <option key={base.candidate.id} value={base.candidate.id}>{base.candidate.name} · {base.candidate.suite ?? base.candidate.id}</option>)}
        </select></label>
        {active && <label className="decision-check"><input type="checkbox" checked={selected.includes(activeId)} disabled={busy || (!selected.includes(activeId) && selected.length >= 3)} onChange={event => setSelected(old => event.target.checked ? [...old, activeId] : old.filter(id => id !== activeId))} />Compare this space ({selected.length}/3)</label>}</div>
        {active && choice && <div className="decision-investigation" key={`${bundle.run.runId}:${activeId}`}>
          <div className="section-heading"><h3>{active.candidate.name} · {active.candidate.suite ?? "Suite identifier unavailable"}</h3><span className="tiny-badge">Assessment revision {choice.assessment.revisionNumber}</span></div>
          <p>{active.candidate.address ?? "Address unavailable"} · <strong>{GROUP_LABELS[choice.assessment.group]}</strong></p>
          <details><summary>All profile requirements ({bundle.profile.requirements.requirements.length})</summary><ul>{bundle.profile.requirements.requirements.map(requirement => <li key={requirement.id}><strong>{requirement.label}</strong> · {requirement.kind} · {requirementDisplayValue(requirement)} · {requirement.origin}<p>{choice.assessment.assessments.find(item => item.requirementId === requirement.id)?.reason ?? "Profile context retained; no candidate-level verified assessment is claimed for this field."}</p></li>)}</ul></details>
          <details><summary><ClipboardList size={15} /> Historical run assessment (unchanged)</summary><ul>{active.assessments.map(item => <li key={item.requirementId}>{REQUIREMENT_LABELS[item.requirementId] ?? item.requirementId}: {item.status} · {item.reason}</li>)}</ul></details>
          <div className="decision-requirements">{choice.assessment.assessments.map(item => <article key={item.requirementId}><strong>{REQUIREMENT_LABELS[item.requirementId] ?? item.requirementId}</strong><span className={`status-chip ${item.status}`}>{item.status.replaceAll("_", " ")}</span><p>{item.reason}</p><small>{item.sourceValue} · evidence: {item.evidenceIds.join(", ") || "unavailable"}</small></article>)}</div>
          {choice.assessment.conflicts.length > 0 && <p className="warning">Conflicting observations retained: {choice.assessment.conflicts.join(", ")}.</p>}
          <NoteForm candidateId={activeId} onAdd={note => { revise(activeId, [...choice.assessment.notes, note], choice.assessment.sources); setNotice(`${note.category === "assumption" ? "Assumption" : "User verification"} recorded in a new assessment revision.`); }} />
          {choice.assessment.notes.length > 0 && <ul className="decision-notes">{choice.assessment.notes.map(note => <li key={note.id}><strong>{note.category === "verification" ? "Observed · user-provided verification" : "Assumed · planning only"}</strong>: {note.text} · {note.fact.field}: {JSON.stringify(note.fact.value)}<p>Source: {note.fact.source.label} · date {note.fact.source.capturedAt ?? "not supplied"} · reference {note.fact.source.recordId ?? "none"}</p></li>)}</ul>}
          <details className="decision-source-drawer"><summary>Sources and formula drawer</summary>
            <p>Matching: {bundle.search.matchingModelVersion}. Finance: {choice.financeResults.modelVersion}. Canonical calculations run in TypeScript.</p>
            <p>Mandatory kitchen and customer parking requirements need suite evidence. Property metadata and aerial stalls cannot verify customer parking use rights.</p>
            <p>Required sales = complete fixed costs ÷ contribution margin. Guests/day = required monthly sales ÷ average spend ÷ operating days. Usable funds = total funds − supplied reserve. Opening balance = usable funds − complete upfront plan. Recurring occupancy is added only when fixed costs exclude it.</p>
            <p>Rent: {JSON.stringify(active.candidate.rent)} · suite SF: {active.candidate.floorAreaSqFt ?? "unknown"}; size range {JSON.stringify(active.candidate.sizeRangeSqFt)}. Source IDs: {active.candidate.sourceIds.join(", ")} · record date {active.candidate.recordDate ?? "unknown"}.</p>
            <p>Mechanical sensitivity changes complete fixed costs by −20%, 0%, +20%; it does not forecast sales.</p>
            <ul>{choice.financeResults.sensitivity.map(point => <li key={point.fixedCostMultiplier}>{Math.round(point.fixedCostMultiplier * 100)}% fixed costs → {moneyRange(point.requiredSales)} required monthly sales</li>)}</ul>
            <div className="decision-form-grid"><label>Current street address (optional)<input value={currentAddress} maxLength={300} onChange={event => setCurrentAddress(event.target.value)} /></label><label>Average price level / spend (optional)<input type="number" min="0.01" max="10000" step="any" value={priceLevel} onChange={event => setPriceLevel(event.target.value)} /></label></div>
            <p className="small-note">Optional context does not edit the historical profile. No similarity or price-fit score is calculated until a supported comparison model exists.</p>
            <button className="secondary" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} /> Refresh sources and reassess</button>
            <p>Source snapshot: {choice.assessment.sources.refreshedAt}. Restoring never refreshes automatically.</p>
            <ul>{choice.assessment.sources.statuses.map(source => <li key={source.provider}><strong>{source.provider}: {source.status}</strong> · {source.mode} · {source.reason}</li>)}</ul>
            {choice.assessment.sources.observations.map(source => <article key={source.id} className="decision-source"><h4>{source.label} · {source.origin} · {source.scope}</h4><p>Evidence {source.id} · source date {source.sourceDate ?? "unknown"} · retrieved {source.retrievedAt}</p><ul>{[...source.details, ...source.limitations].map((detail, i) => <li key={i}>{detail}</li>)}</ul>{source.referenceUrl && <a href={source.referenceUrl} target="_blank" rel="noreferrer">Source reference</a>}{source.viewerUrl && <iframe title={`Matterport viewer for ${active.candidate.name}`} src={source.viewerUrl} loading="lazy" allowFullScreen sandbox="allow-scripts allow-same-origin allow-presentation" />}{source.imageUrl && <details><summary>View permitted dated site imagery</summary>{/* Native image keeps provider bytes local; never sends them to a third-party optimizer. */}<Image unoptimized width={1400} height={1400} src={source.imageUrl} alt="Vexcel site context; parking access and capture freshness are unverified" /></details>}</article>)}
            <ul>{choice.assessment.sources.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>
            <details><summary>Assessment revision history ({choice.assessmentHistory.length})</summary>{choice.assessmentHistory.map(revision => <article key={revision.id}>Revision {revision.revisionNumber} · {revision.evaluatedAt} · {GROUP_LABELS[revision.group]} · {revision.notes.length} notes · {revision.sources.observations.length} observations</article>)}</details>
          </details>
          <FinanceForm key={`${activeId}:${restored?.id ?? "draft"}`} inputs={choice.financeInputs} onDirty={() => setPendingFinance(true)} onApply={inputs => { setChoices(old => ({ ...old, [activeId]: { ...old[activeId], financeInputs: inputs, financeResults: calculateDecisionFinance(active.candidate, inputs) } })); setPendingFinance(false); setNotice("Finance assumptions applied. Requirement verification is unchanged."); }} />
          <FinanceSummary choice={choice} />
        </div>}
        <section aria-label="Space comparison" className="decision-comparison"><h3>Compare opening plans ({selected.length})</h3><p>Every option uses profile revision {bundle.profile.revisionNumber}. Finance assumptions never verify hard requirements.</p>
          {selected.length < 2 && <p>Select at least two spaces above.</p>}
          <div className="decision-comparison-grid">{selected.map(id => <article key={id}><h4>{choices[id].assessment.candidate.name} · {choices[id].assessment.candidate.suite ?? id}</h4><p>{GROUP_LABELS[choices[id].assessment.group]}</p><FinanceSummary choice={choices[id]} /><button className="secondary" onClick={() => chooseSpace(id)}>Investigate compared space</button><button className="secondary" onClick={() => setSelected(old => old.filter(x => x !== id))}>Remove from comparison</button></article>)}</div>
        </section>
        <div className="decision-inline"><label>Brief title<input value={title} maxLength={160} onChange={event => setTitle(event.target.value)} /></label><button className="primary" disabled={selected.length < 2 || storageBlocked || busy || pendingFinance || !title.trim()} onClick={save}><Bookmark size={15} />Save decision brief</button></div>
        {restored && <details open className="decision-next"><summary>Saved brief · next questions</summary><ul>{restored.nextQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul><p>Source snapshots are for local review. Restricted provider content is not exported.</p></details>}
      </>}
    </>}
  </section>;
}

function FinanceSummary({ choice }: { choice: BriefChoice }) {
  const result = choice.financeResults;
  return <div className="decision-finance-summary"><dl><dt>Total monthly occupancy</dt><dd>{moneyRange(result.occupancy)}</dd><dt>Required monthly sales (threshold)</dt><dd>{moneyRange(result.requiredSales)}</dd><dt>Required guests/day</dt><dd>{result.guestsPerDay ? `${result.guestsPerDay.low.toFixed(1)}–${result.guestsPerDay.high?.toFixed(1) ?? "unknown upper"}` : "Unavailable"}</dd><dt>Usable funds after reserve</dt><dd>{money(result.usableFunds)}</dd><dt>Complete upfront plan</dt><dd>{money(result.completeUpfront)} · known subtotal {money(result.knownUpfront)}</dd><dt>Opening funds remaining</dt><dd>{money(result.openingFundsRemaining)}</dd><dt>Contribution after fixed costs at assumed sales</dt><dd>{result.assumedContributionAfterFixed ? `${money(result.assumedContributionAfterFixed.low)}–${money(result.assumedContributionAfterFixed.high)}` : "Unavailable — no sales/profit/payback prediction"}</dd></dl><details><summary>Finance gaps and assumptions ({result.gaps.length})</summary><ul>{[...result.gaps, ...result.notes].map((item, index) => <li key={index}>{item}</li>)}</ul></details></div>;
}

const financeLabels = { additionalOccupancyMonthly: "Nonincluded occupancy charges / month", fixedCostsMonthly: "Fixed costs / month", contributionMargin: "Contribution margin (0–1)", totalFunds: "Total funds", reserve: "Emergency reserve", averageSpend: "Average guest spend", operatingDays: "Operating days / month", assumedSalesMonthly: "Assumed monthly sales (optional)" } as const;
function FinanceForm({ inputs, onApply, onDirty }: { inputs: DecisionFinanceInputs; onDirty: () => void; onApply: (inputs: DecisionFinanceInputs) => void }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(Object.entries(financeLabels).map(([key]) => [key, inputs[key as keyof typeof financeLabels]?.toString() ?? ""])) as Record<keyof typeof financeLabels, string>);
  const [upfront, setUpfront] = useState(() => Object.fromEntries(upfrontCategories.map(category => [category, inputs.upfront.find(x => x.category === category)?.amount?.toString() ?? ""])) as Record<typeof upfrontCategories[number], string>);
  const [basis, setBasis] = useState(inputs.fixedCostBasis);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const numeric = (raw: string) => raw.trim() ? Number(raw) : null;
  return <details className="decision-finance-editor"><summary>Opening finance assumptions</summary><p>Blank means unknown. Profile funds/reserve, when supplied, are copied as starting inputs; all edits are planning assumptions. Deposits and working capital are cash needs, not recurring costs.</p>
    <form onSubmit={event => { event.preventDefault(); const parsed = decisionFinanceInputsSchema.safeParse({ ...Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, numeric(value)])), fixedCostBasis: basis, upfront: upfrontCategories.map(category => ({ category, amount: numeric(upfront[category]) })) }); if (parsed.success) { onApply(parsed.data); setError(""); setDirty(false); } else setError(parsed.error.issues.map(x => x.message).join(" ")); }}>
      <div className="decision-form-grid">{Object.entries(financeLabels).map(([key, label]) => <label key={key}>{label}<input type="number" min="0" step="any" value={draft[key as keyof typeof draft]} onChange={event => { setDraft(old => ({ ...old, [key]: event.target.value })); setDirty(true); onDirty(); }} /></label>)}
        <label>Fixed cost scope<select value={basis} onChange={event => { setBasis(event.target.value as typeof basis); setDirty(true); onDirty(); }}><option value="excludes_occupancy">Excludes occupancy — add supported rent range</option><option value="includes_occupancy">Complete fixed costs — occupancy already included</option></select></label>
        {upfrontCategories.map(category => <label key={category}>Upfront: {category.replaceAll("_", " ")}<input type="number" min="0" step="any" value={upfront[category]} onChange={event => { setUpfront(old => ({ ...old, [category]: event.target.value })); setDirty(true); onDirty(); }} /></label>)}
      </div>{error && <p role="alert" className="warning">{error}</p>}{dirty && <p role="status">Finance edits are not applied yet. Apply them before saving the brief.</p>}<button className="secondary">Apply finance assumptions</button>
    </form></details>;
}

function NoteForm({ candidateId, onAdd }: { candidateId: string; onAdd: (note: InvestigationNote) => void }) {
  const [category, setCategory] = useState<"assumption" | "verification">("assumption");
  const [field, setField] = useState<"existingKitchen" | "customerParking" | "monthlyAdditionalCharges">("existingKitchen");
  const [value, setValue] = useState("verified_present");
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const options = field === "existingKitchen" ? [["verified_present", "Kitchen present"], ["verified_absent", "Kitchen absent"], ["building_note", "Building note only"]] : [["verified_customer_parking", "Documented customer parking use rights"], ["verified_absent", "No customer parking"]];
  return <details className="decision-note-editor"><summary>Add assumption or dated verification</summary><p>An assumption cannot pass a hard requirement. Verification records your dated source attestation; conflicting observations remain unresolved.</p>
    <form onSubmit={event => {
      event.preventDefault();
      const id = crypto.randomUUID();
      const fact = { id: `user:${id}`, entityScope: "space", entityId: candidateId, field, value: field === "monthlyAdditionalCharges" ? { kind: "exact", value: Number(value) } : { kind: "exact", value }, unit: field === "monthlyAdditionalCharges" ? "USD/month" : null, origin: category === "verification" ? "observed" : "assumed", source: { label: category === "verification" ? `User-provided verification: ${source}` : "Owner planning assumption", recordId: category === "verification" ? source : null, capturedAt: category === "verification" && date ? `${date}T00:00:00.000Z` : null }, method: category === "verification" ? "Owner attests source applies to this offered suite; customer parking means documented use rights." : "User planning assumption; not verified", limitations: ["User-provided; not independently certified by a source adapter."], isDemo: false } as CandidateFact;
      const parsed = investigationNoteSchema.safeParse({ id, category, createdAt: new Date().toISOString(), text, fact });
      if (parsed.success) { onAdd(parsed.data); setText(""); setError(""); } else setError(parsed.error.issues.map(x => x.message).join(" "));
    }}><div className="decision-form-grid">
      <label>Evidence category<select value={category} onChange={event => setCategory(event.target.value as typeof category)}><option value="assumption">Assumption — planning only</option><option value="verification">Dated user verification</option></select></label>
      <label>Requirement to investigate<select value={field} onChange={event => { const next = event.target.value as typeof field; setField(next); setValue(next === "existingKitchen" ? "verified_present" : next === "customerParking" ? "verified_customer_parking" : ""); }}><option value="existingKitchen">Existing kitchen</option><option value="customerParking">Customer parking rights</option><option value="monthlyAdditionalCharges">Nonincluded monthly occupancy charges</option></select></label>
      <label>Observation value{field === "monthlyAdditionalCharges" ? <input type="number" min="0" step="any" required value={value} onChange={event => setValue(event.target.value)} /> : <select value={value} onChange={event => setValue(event.target.value)}>{options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}</label>
      <label>Investigation note<input value={text} required maxLength={2000} onChange={event => setText(event.target.value)} /></label>
      {category === "verification" && <><label>Source reference (document / visit)<input value={source} required onChange={event => setSource(event.target.value)} /></label><label>Source observation date<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label></>}
    </div>{error && <p role="alert" className="warning">{error}</p>}<button className="secondary">Record investigation note</button></form>
  </details>;
}
