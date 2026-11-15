"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Bookmark, ClipboardList, RefreshCw, Scale } from "lucide-react";
import { createDecisionBrief, type BriefChoice, type DecisionBrief, type InvestigationRun } from "../../domain/decision-brief.ts";
import { applyIllustrative, calculateDecisionFinance, decisionFinanceInputsSchema, emptyFinanceInputs, illustrativeKeys, occupancyBreakdown, upfrontCategories, type DecisionFinanceInputs, type IllustrativeKey } from "../../domain/decision-finance.ts";
import { EVIDENCE_VERSION, investigationNoteSchema, providerNames, reassessCandidate, type InvestigationNote, type SourceObservation, type SourceSnapshot } from "../../domain/evidence.ts";
import type { AssessedCandidate, CandidateFact } from "../../domain/matching.ts";
import { requirementDisplayValue } from "../../domain/requirements.ts";
import { BRIEF_STORAGE_KEY, decodeBriefs, persistBriefs, resetBriefs } from "../brief-storage.ts";
import { loadInvestigationRun, refreshCandidateSources } from "../data/investigation-client.ts";
import { importBrowserCopies, listAccountBriefs, loadAgentEvidence, saveAccountBrief, type AccountBrief } from "../data/account-client.ts";
import { PROFILE_DRAFT_STORAGE_KEY } from "../storage.ts";
import { GROUP_LABELS, REQUIREMENT_LABELS } from "./run-search.tsx";
import "./decision-workbench.css";

const money = (value: number | null) => value === null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const moneyRange = (range: { low: number; high: number | null } | null) => !range ? "Unavailable" : range.high === null ? `${money(range.low)}+ (upper unknown)` : range.low === range.high ? money(range.low) : `${money(range.low)}–${money(range.high)}`;
const emptySources = (candidateId: string): SourceSnapshot => ({ version: EVIDENCE_VERSION, candidateId, refreshedAt: new Date().toISOString(), statuses: providerNames.map(provider => ({ provider, status: "unavailable", mode: "unavailable", checkedAt: new Date().toISOString(), capabilities: [], reason: "Not refreshed. No external facts loaded." })), observations: [], gaps: ["Source evidence has not been refreshed."] });

const SCOPE_GROUPS: { scope: SourceObservation["scope"]; title: string; note: string }[] = [
  { scope: "suite", title: "Offered-suite facts", note: "Only suite-scoped evidence can verify kitchen, customer parking, charges or seats." },
  { scope: "property", title: "Building / property context", note: "Building-level evidence never verifies the offered suite." },
  { scope: "site", title: "Site context (aerial, neighborhood, nearby restaurants)", note: "Visible parking is not customer-use rights; Heights is a preference." },
  { scope: "tract", title: "Census tract context", note: "Context only; not demand, revenue or a composite score." },
];
type EvidenceRef = { label: string; date: string | null; origin: string };
/** Resolve assessment evidence IDs to their source label/date for display. */
function evidenceIndex(choice: BriefChoice, candidate: AssessedCandidate["candidate"]): Map<string, EvidenceRef> {
  const index = new Map<string, EvidenceRef>();
  for (const id of candidate.sourceIds) index.set(id, { label: candidate.isDemo ? "Synthetic candidate record" : "Local CoStar snapshot record", date: candidate.recordDate ?? candidate.datasetDate, origin: "observed" });
  for (const observation of choice.assessment.sources.observations) {
    index.set(observation.id, { label: observation.label, date: observation.sourceDate, origin: observation.origin });
    for (const fact of observation.facts) index.set(fact.id, { label: fact.source.label, date: fact.source.capturedAt, origin: fact.origin });
  }
  for (const note of choice.assessment.notes) index.set(note.fact.id, { label: note.fact.source.label, date: note.fact.source.capturedAt, origin: note.fact.origin });
  return index;
}
const VERIFICATION_GAP: Record<string, string> = {
  "space.existingKitchen": "Needs a dated, suite-specific document or visit confirming an existing kitchen.",
  "space.customerParking": "Needs documented customer parking use rights for this suite (lease exhibit, landlord letter). Visible stalls are not enough.",
  "occupancy.monthlyLimit": "Needs every nonincluded occupancy charge (CAM, taxes, insurance) to bound the total under the cap.",
  "space.seats": "Needs measured usable dining area plus an explicit density assumption; not legal occupancy.",
  "market.neighborhoodPreference": "Needs a sourced neighborhood boundary lookup; address text is not membership.",
};

/** Revision 0 starts from the live Phase 4 sources the agent run attached (if any), never fixtures. */
function initialChoice(bundle: InvestigationRun, base: AssessedCandidate, agentSources?: SourceSnapshot): BriefChoice {
  const financeInputs = emptyFinanceInputs();
  const numeric = (id: string) => { const requirement = bundle.profile.requirements.requirements.find(x => x.id === id); return requirement?.value.kind === "number" ? requirement.value.value : null; };
  financeInputs.totalFunds = numeric("funds.totalAvailable");
  financeInputs.reserve = numeric("funds.emergencyReserve");
  return {
    candidateId: base.candidate.id, assessmentHistory: [],
    assessment: reassessCandidate(base, bundle.profile.requirements, [], agentSources ?? emptySources(base.candidate.id), { id: crypto.randomUUID(), parentId: null, revisionNumber: 0, evaluatedAt: new Date().toISOString() }),
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
  const [accountBriefs, setAccountBriefs] = useState<AccountBrief[]>([]);
  const [accountState, setAccountState] = useState<{ status: "loading" | "ok" | "unavailable"; message: string }>({ status: "loading", message: "Checking your private workspace…" });
  const [agentSources, setAgentSources] = useState<Map<string, SourceSnapshot>>(new Map());
  const sectionRef = useRef<HTMLElement>(null);
  const generationRef = useRef(0);

  const applyBundle = (next: InvestigationRun, evidence: Map<string, SourceSnapshot> = new Map()) => {
    setAgentSources(evidence);
    setBundle(next); setChoices(Object.fromEntries(next.search.candidates.map(x => [x.candidate.id, initialChoice(next, x, evidence.get(x.candidate.id))])));
    setActiveId(next.search.candidates[0]?.candidate.id ?? ""); setSelected([]); setRestored(null); setRunInput(next.run.runId); setPendingFinance(false);
  };
  useEffect(() => {
    // Read storage asynchronously after hydration, without silently rewriting it.
    void Promise.resolve().then(() => {
      try {
        const decoded = decodeBriefs(localStorage.getItem(BRIEF_STORAGE_KEY));
        if (decoded.status === "ok") setSaved(decoded.briefs);
        else { setStorageBlocked(true); setNotice(decoded.reason); }
      } catch { setStorageBlocked(true); setNotice("Browser storage is blocked. Work stays in memory; saving to this browser is unavailable."); }
    });
    void listAccountBriefs().then(result => { setAccountBriefs(result.briefs); setAccountState({ status: "ok", message: `Private workspace storage: ${result.storage}.` }); })
      .catch(failure => setAccountState({ status: "unavailable", message: failure instanceof Error ? failure.message : "Account storage is unavailable; briefs save to this browser only." }));
  }, []);
  useEffect(() => {
    if (!requestedRunId) return;
    const controller = new AbortController();
    const generation = ++generationRef.current;
    void Promise.all([loadInvestigationRun(requestedRunId, controller.signal), loadAgentEvidence(requestedRunId, controller.signal)]).then(([next, evidence]) => {
      if (generation !== generationRef.current) return;
      applyBundle(next, evidence); setBusy(false); setError("");
      sectionRef.current?.scrollIntoView({ block: "start" });
      sectionRef.current?.focus({ preventScroll: true });
    }).catch(failure => { if (!controller.signal.aborted) { setBusy(false); setError(failure instanceof Error ? failure.message : "Run could not load."); } });
    return () => controller.abort();
  }, [requestedRunId]);

  const load = async () => {
    setBusy(true); setError("");
    const generation = ++generationRef.current;
    try { const [next, evidence] = await Promise.all([loadInvestigationRun(runInput), loadAgentEvidence(runInput)]); if (generation === generationRef.current) applyBundle(next, evidence); }
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
  const syntheticRun = !!bundle && (bundle.search.candidates.some(x => x.candidate.isDemo) || /^synthetic[-_]/.test(bundle.run.datasetId ?? ""));
  const refresh = async (sourceMode: "live" | "synthetic" = "live") => {
    if (!bundle || !choice) return;
    const candidateId = activeId;
    const runId = bundle.run.runId;
    const generation = generationRef.current;
    setBusy(true); setError("");
    try {
      const sources = await refreshCandidateSources(runId, candidateId, { currentAddress: currentAddress.trim() || null, priceLevel: priceLevel.trim() ? Number(priceLevel) : null, sourceMode });
      if (generation !== generationRef.current) return;
      revise(candidateId, choices[candidateId].assessment.notes, sources);
      setNotice(sourceMode === "synthetic" ? "Labeled synthetic source fixtures loaded into a new assessment revision. They carry no facts and cannot verify requirements." : "Sources refreshed into a new assessment revision. Historical run and saved brief remain unchanged.");
    } catch { setError("Source refresh failed. The previous evidence snapshot is preserved; retry when the source is available."); }
    finally { setBusy(false); }
  };
  const save = () => {
    if (!bundle) return;
    try {
      const brief = createDecisionBrief({ id: crypto.randomUUID(), title, createdAt: new Date().toISOString(), parentBriefId: restored?.id ?? null, runSnapshot: bundle,
        choices: selected.map(id => choices[id]), nextQuestions: [...new Set([...bundle.summary.followUps, ...selected.flatMap(id => choices[id].assessment.assessments.filter(x => x.status === "unknown").map(x => x.reason)), ...selected.flatMap(id => choices[id].financeResults.gaps)])] });
      let browserSaved = false;
      if (!storageBlocked) {
        try { const next = [brief, ...saved].slice(0, 10); persistBriefs(localStorage, next); setSaved(next); browserSaved = true; } catch { browserSaved = false; }
      }
      setRestored(brief);
      setNotice(browserSaved ? "Decision brief saved in this browser with frozen evidence and calculation snapshots. Saving to your private workspace…" : "Saving to your private workspace…");
      void saveAccountBrief(brief).then(record => {
        setAccountBriefs(old => [record, ...old.filter(x => x.brief.id !== record.brief.id)]);
        setAccountState({ status: "ok", message: `Private workspace storage: ${record.storage}.` });
        setNotice(`Decision brief saved${browserSaved ? " in this browser and" : ""} to your private workspace (${record.storage}). Reload restores it from the server.`);
      }).catch(failure => {
        setAccountState({ status: "unavailable", message: failure instanceof Error ? failure.message : "Account storage is unavailable." });
        if (browserSaved) setNotice(`Saved in this browser only. Workspace save failed: ${failure instanceof Error ? failure.message : "storage unavailable"}`);
        else setError(`Saving failed in both places; your work remains in memory. ${failure instanceof Error ? failure.message : ""}`);
      });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Saving failed. Your work remains in memory."); }
  };
  const importCopies = async () => {
    setBusy(true); setError("");
    try {
      // Originals are read, never removed: the browser copy stays whatever the outcome.
      let profileDraft: unknown;
      try { const raw = localStorage.getItem(PROFILE_DRAFT_STORAGE_KEY); profileDraft = raw ? JSON.parse(raw) : undefined; } catch { profileDraft = undefined; }
      const result = await importBrowserCopies({ ...(profileDraft === undefined ? {} : { profileDraft }), briefs: saved });
      const counts = result.items.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] ?? 0) + 1 }), {} as Record<string, number>);
      setNotice(`Import finished: ${counts.imported ?? 0} imported, ${counts.duplicate ?? 0} already present, ${counts.rejected ?? 0} rejected. Browser copies were not changed.${result.items.filter(x => x.reason).map(x => ` ${x.kind} ${x.id ?? ""}: ${x.reason}`).join("")}`);
      const refreshed = await listAccountBriefs(); setAccountBriefs(refreshed.briefs);
    } catch (failure) { setError(`Import failed; nothing was deleted. ${failure instanceof Error ? failure.message : ""}`); }
    finally { setBusy(false); }
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
    if (!choices[id]) setChoices(old => ({ ...old, [id]: initialChoice(bundle, bundle.search.candidates.find(x => x.candidate.id === id)!, agentSources.get(id)) }));
    setActiveId(id);
  };

  return <section id="decision-workbench" ref={sectionRef} tabIndex={-1} className="decision-workbench" aria-label="Investigation and decision briefs">
    <div className="section-heading"><div><p className="eyebrow">INVESTIGATE → COMPARE → DECIDE</p><h2><Scale size={20} /> Build an expansion brief</h2></div><span className="tiny-badge">Evidence before commitment</span></div>
    <p>Investigate a finished scouting run, compare two or three spaces, then keep a reproducible plan. Sources and assumptions stay separate.</p>
    <form className="decision-inline" onSubmit={event => { event.preventDefault(); void load(); }}><label>Completed agent run ID<input value={runInput} onChange={event => setRunInput(event.target.value)} required maxLength={64} pattern="[A-Za-z0-9-]+" /></label><button className="secondary" disabled={busy}>Load run for investigation</button></form>
    {busy && <p role="status">Loading investigation evidence…</p>}
    {error && <p className="warning" role="alert">{error}</p>}
    {notice && <p role="status" className="decision-notice">{notice}</p>}
    <details className="saved-briefs"><summary><Bookmark size={15} /> Saved decision briefs ({accountBriefs.length} in workspace · {saved.length} in this browser)</summary>
      <p className="small-note" role="status">{accountState.message}</p>
      {accountBriefs.map(record => <article key={`account-${record.brief.id}`}><strong>{record.brief.title}</strong> <span className="tiny-badge">Private workspace</span>{record.provenance === "browser_import" && <span className="tiny-badge">Imported{record.runVerified ? "" : " · run snapshot unverified"}</span>}<p>{record.brief.runSnapshot.profile.intake.restaurant.name} · profile revision {record.brief.runSnapshot.profile.revisionNumber} · {record.brief.createdAt} · {record.brief.runSnapshot.run.executionMode === "scripted" ? "Scripted test model" : "Live model"}</p><button className="secondary" onClick={() => restore(record.brief)}>Restore workspace brief: {record.brief.title}</button></article>)}
      {saved.length > 0 && accountState.status === "ok" && <button className="secondary" disabled={busy} onClick={() => void importCopies()}>Import browser copies to your workspace</button>}
      {storageBlocked && <><p className="warning">Saving is disabled. Existing storage is preserved.</p><button className="secondary" onClick={() => { try { resetBriefs(localStorage); setStorageBlocked(false); setSaved([]); setNotice("Brief storage reset explicitly. Legacy scenarios are unchanged."); } catch { setError("Browser storage is still blocked."); } }}>Reset brief storage</button></>}
      {!saved.length && <p>No decision briefs saved yet. Legacy scenarios remain in the existing saved plans.</p>}
      {saved.map(brief => <article key={brief.id}><strong>{brief.title}</strong> <span className="tiny-badge">This browser</span><p>{brief.runSnapshot.profile.intake.restaurant.name} · profile revision {brief.runSnapshot.profile.revisionNumber} · {brief.createdAt} · {brief.runSnapshot.run.executionMode === "scripted" ? "Scripted test model" : "Live model"}</p><button className="secondary" onClick={() => restore(brief)}>Restore brief: {brief.title}</button></article>)}
    </details>
    {bundle && <>
      <div className="decision-run-meta"><p><strong>{bundle.profile.intake.restaurant.name}</strong> · profile revision {bundle.profile.revisionNumber} · run {bundle.run.runId}</p><p>{bundle.run.executionMode === "scripted" ? "Deep Agents · scripted test model (synthetic acceptance, not live-model proof)" : "Deep Agents · live model"} · {bundle.run.datasetId ?? "Dataset unavailable"} · dataset date {bundle.run.datasetDate ?? "unknown"}</p><p>Profile origin: {bundle.profile.intake.origin}. Property source: {syntheticRun ? "synthetic test inputs" : "dated local records"}.</p></div>
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
          <div className="decision-requirements">{(() => { const index = evidenceIndex(choice, active.candidate); return choice.assessment.assessments.map(item => {
            const requirement = bundle.profile.requirements.requirements.find(x => x.id === item.requirementId);
            const refs = item.evidenceIds.map(id => ({ id, ref: index.get(id) }));
            return <article key={item.requirementId} data-status={item.status}><div className="decision-requirement-head"><strong>{REQUIREMENT_LABELS[item.requirementId] ?? item.requirementId}</strong>{requirement && <span className="tiny-badge">{requirement.kind === "hard" ? "Mandatory" : "Preference"}</span>}<span className={`status-chip ${item.status}`}>{item.status.replaceAll("_", " ")}</span></div>
              <p>{item.reason}</p><small>Source value: {item.sourceValue}</small>
              <ul className="decision-evidence-refs">{refs.length ? refs.map(({ id, ref }) => <li key={id}>{ref ? `${ref.label} · ${ref.origin} · dated ${ref.date ?? "unknown"}` : `Evidence ${id} (source date unknown)`}</li>) : <li>No source evidence.</li>}</ul>
              {item.status === "unknown" && <p className="decision-gap">Verification gap: {VERIFICATION_GAP[item.requirementId] ?? "Missing evidence stays unknown until a dated source is added."}</p>}
            </article>; }); })()}</div>
          {choice.assessment.conflicts.length > 0 && <p className="warning">Conflicting observations retained: {choice.assessment.conflicts.join(", ")}.</p>}
          <NoteForm candidateId={activeId} onAdd={note => { revise(activeId, [...choice.assessment.notes, note], choice.assessment.sources); setNotice(`${note.category === "assumption" ? "Assumption" : "User verification"} recorded in a new assessment revision.`); }} />
          {choice.assessment.notes.length > 0 && <div className="decision-notes">{(["verification", "assumption"] as const).map(category => { const items = choice.assessment.notes.filter(note => note.category === category); return <div key={category}><h4>{category === "verification" ? `Dated user verifications (${items.length})` : `Planning assumptions (${items.length}) — never verify a requirement`}</h4>{items.length ? <ul>{items.map(note => <li key={note.id}><strong>{note.category === "verification" ? "Observed · user-provided verification" : "Assumed · planning only"}</strong>: {note.text} · {note.fact.field}: {JSON.stringify(note.fact.value)}<p>Source: {note.fact.source.label} · date {note.fact.source.capturedAt ?? "not supplied"} · reference {note.fact.source.recordId ?? "none"} · recorded {note.createdAt}</p></li>)}</ul> : <p className="small-note">None recorded.</p>}</div>; })}</div>}
          <details className="decision-source-drawer"><summary>Sources and formula drawer</summary>
            <p>Matching: {bundle.search.matchingModelVersion}. Finance: {choice.financeResults.modelVersion}. Canonical calculations run in TypeScript.</p>
            <p>Mandatory kitchen and customer parking requirements need suite evidence. Property metadata and aerial stalls cannot verify customer parking use rights.</p>
            <p>Required sales = complete fixed costs ÷ contribution margin. Guests/day = required monthly sales ÷ average spend ÷ operating days. Usable funds = total funds − supplied reserve. Opening balance = usable funds − complete upfront plan. Recurring occupancy is added only when fixed costs exclude it.</p>
            <p>Rent: {JSON.stringify(active.candidate.rent)} · suite SF: {active.candidate.floorAreaSqFt ?? "unknown"}; size range {JSON.stringify(active.candidate.sizeRangeSqFt)}. Source IDs: {active.candidate.sourceIds.join(", ")} · record date {active.candidate.recordDate ?? "unknown"}.</p>
            <p>Mechanical sensitivity changes complete fixed costs by −20%, 0%, +20%; it does not forecast sales.</p>
            <ul>{choice.financeResults.sensitivity.map(point => <li key={point.fixedCostMultiplier}>{Math.round(point.fixedCostMultiplier * 100)}% fixed costs → {moneyRange(point.requiredSales)} required monthly sales</li>)}</ul>
            <div className="decision-form-grid"><label>Current street address (optional)<input value={currentAddress} maxLength={300} onChange={event => setCurrentAddress(event.target.value)} /></label><label>Average price level / spend (optional)<input type="number" min="0.01" max="10000" step="any" value={priceLevel} onChange={event => setPriceLevel(event.target.value)} /></label></div>
            <p className="small-note">Optional context does not edit the historical profile. No similarity or price-fit score is calculated until a supported comparison model exists.</p>
            <div className="decision-inline"><button className="secondary" disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} /> Refresh sources and reassess</button>
              {syntheticRun && <button className="secondary" disabled={busy} onClick={() => void refresh("synthetic")}>Load labeled synthetic source fixtures</button>}</div>
            {syntheticRun && <p className="small-note">Synthetic fixtures run fixture payloads through the real adapters for this synthetic run only. They are not live integration proof and never verify a requirement.</p>}
            <p>Source snapshot: {choice.assessment.sources.refreshedAt}{agentSources.has(activeId) && choice.assessment.revisionNumber === 0 ? " (collected during the agent run's inspection stage)" : ""}. Restoring never refreshes automatically.</p>
            <ul>{choice.assessment.sources.statuses.map(source => <li key={source.provider}><strong>{source.provider}: {source.status}</strong> · {source.mode} · {source.reason}</li>)}</ul>
            {SCOPE_GROUPS.map(group => { const items = choice.assessment.sources.observations.filter(x => x.scope === group.scope); return items.length > 0 && <section key={group.scope} className="decision-scope" aria-label={group.title}><h4>{group.title} ({items.length})</h4><p className="small-note">{group.note}</p>{items.map(source => <article key={source.id} className={`decision-source${source.isSynthetic ? " synthetic" : ""}`}><h4>{source.isSynthetic && <span className="tiny-badge">SYNTHETIC FIXTURE</span>} {source.label} · {source.origin} · {source.scope}</h4><p>Evidence {source.id} · source date {source.sourceDate ?? "unknown"} · retrieved {source.retrievedAt}</p><ul>{[...source.details, ...source.limitations].map((detail, i) => <li key={i}>{detail}</li>)}</ul>{source.referenceUrl && <a href={source.referenceUrl} target="_blank" rel="noreferrer">Source reference</a>}{source.viewerUrl && <iframe title={`Matterport viewer for ${active.candidate.name}`} src={source.viewerUrl} loading="lazy" allowFullScreen sandbox="allow-scripts allow-same-origin allow-presentation" />}{source.imageUrl && <details><summary>View permitted dated site imagery</summary>{/* Native image keeps provider bytes local; never sends them to a third-party optimizer. */}<Image unoptimized width={1400} height={1400} src={source.imageUrl} alt="Vexcel site context; parking access and capture freshness are unverified" /></details>}</article>)}</section>; })}
            <ul>{choice.assessment.sources.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>
            <details><summary>Assessment revision history ({choice.assessmentHistory.length})</summary>{choice.assessmentHistory.map(revision => <article key={revision.id}>Revision {revision.revisionNumber} · {revision.evaluatedAt} · {GROUP_LABELS[revision.group]} · {revision.notes.length} notes · {revision.sources.observations.length} observations</article>)}</details>
          </details>
          <FinanceForm key={`${activeId}:${restored?.id ?? "draft"}`} inputs={choice.financeInputs} onDirty={() => setPendingFinance(true)} onApply={inputs => { setChoices(old => ({ ...old, [activeId]: { ...old[activeId], financeInputs: inputs, financeResults: calculateDecisionFinance(active.candidate, inputs) } })); setPendingFinance(false); setNotice("Finance assumptions applied. Requirement verification is unchanged."); }} />
          <FinanceSummary choice={choice} />
        </div>}
        <section aria-label="Space comparison" className="decision-comparison"><h3>Compare opening plans ({selected.length})</h3><p>Every option uses profile revision {bundle.profile.revisionNumber}. Finance assumptions never verify hard requirements.</p>
          {selected.length < 2 && <p>Select at least two spaces above.</p>}
          {selected.length >= 2 && <ComparisonTable choices={selected.map(id => choices[id])} capLabel={requirementDisplayValue(bundle.profile.requirements.requirements.find(x => x.id === "occupancy.monthlyLimit")!)} />}
          <div className="decision-comparison-grid">{selected.map(id => <article key={id}><h4>{choices[id].assessment.candidate.name} · {choices[id].assessment.candidate.suite ?? id}</h4><p>{GROUP_LABELS[choices[id].assessment.group]}</p><FinanceSummary choice={choices[id]} /><button className="secondary" onClick={() => chooseSpace(id)}>Investigate compared space</button><button className="secondary" onClick={() => setSelected(old => old.filter(x => x !== id))}>Remove from comparison</button></article>)}</div>
        </section>
        <div className="decision-inline"><label>Brief title<input value={title} maxLength={160} onChange={event => setTitle(event.target.value)} /></label><button className="primary" disabled={selected.length < 2 || (storageBlocked && accountState.status !== "ok") || busy || pendingFinance || !title.trim()} onClick={save}><Bookmark size={15} />Save decision brief</button></div>
        {restored && <details open className="decision-next"><summary>Saved brief · next questions</summary><ul>{restored.nextQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul><p>Source snapshots are for local review. Restricted provider content is not exported.</p></details>}
      </>}
    </>}
  </section>;
}

function ComparisonTable({ choices, capLabel }: { choices: BriefChoice[]; capLabel: string }) {
  const status = (choice: BriefChoice, id: string) => choice.assessment.assessments.find(x => x.requirementId === id)?.status.replaceAll("_", " ") ?? "not assessed";
  const unresolvedHard = (choice: BriefChoice) => choice.assessment.assessments.filter(x => ["occupancy.monthlyLimit", "space.existingKitchen", "space.customerParking"].includes(x.requirementId) && x.status !== "pass").length;
  const rows: [string, (choice: BriefChoice) => string][] = [
    ["Group", c => GROUP_LABELS[c.assessment.group]],
    ["Unresolved or failed mandatory requirements", c => String(unresolvedHard(c))],
    [`Total occupancy vs ${capLabel}`, c => status(c, "occupancy.monthlyLimit")],
    ["Existing kitchen", c => status(c, "space.existingKitchen")],
    ["Customer parking rights", c => status(c, "space.customerParking")],
    ["Base rent / month", c => moneyRange(occupancyBreakdown(c.assessment.candidate, null).baseRent)],
    ["Total monthly occupancy", c => moneyRange(c.financeResults.occupancy)],
    ["Required monthly sales (threshold)", c => moneyRange(c.financeResults.requiredSales)],
    ["Usable funds after reserve", c => money(c.financeResults.usableFunds)],
    ["Complete upfront plan", c => money(c.financeResults.completeUpfront)],
    ["Opening funds remaining", c => money(c.financeResults.openingFundsRemaining)],
    ["Illustrative inputs in use", c => c.financeInputs.illustrative.length ? c.financeInputs.illustrative.join(", ") : "none"],
  ];
  return <div className="decision-table-wrap"><table className="decision-table"><caption>Side-by-side opening plans · same profile revision · thresholds, not forecasts</caption>
    <thead><tr><th scope="col">Measure</th>{choices.map(c => <th scope="col" key={c.candidateId}>{c.assessment.candidate.name} · {c.assessment.candidate.suite ?? c.candidateId}</th>)}</tr></thead>
    <tbody>{rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th>{choices.map(c => <td key={c.candidateId}>{value(c)}</td>)}</tr>)}</tbody></table></div>;
}

function FinanceSummary({ choice }: { choice: BriefChoice }) {
  const result = choice.financeResults;
  const split = occupancyBreakdown(choice.assessment.candidate, choice.financeInputs.additionalOccupancyMonthly);
  const upfront = (category: typeof upfrontCategories[number]) => choice.financeInputs.upfront.find(x => x.category === category)?.amount ?? null;
  return <div className="decision-finance-summary"><dl><dt>Base rent / month (quoted)</dt><dd>{moneyRange(split.baseRent)}</dd><dt>Additional occupancy charges / month</dt><dd>{split.additional.status === "included_in_rent" ? "Included in quoted rent (not added again)" : split.additional.status === "known" ? money(split.additional.monthly) : "Unknown"}</dd><dt>Total monthly occupancy</dt><dd>{moneyRange(result.occupancy)}</dd><dt>Required monthly sales (threshold)</dt><dd>{moneyRange(result.requiredSales)}</dd><dt>Required guests/day</dt><dd>{result.guestsPerDay ? `${result.guestsPerDay.low.toFixed(1)}–${result.guestsPerDay.high?.toFixed(1) ?? "unknown upper"}` : "Unavailable"}</dd><dt>Usable funds after reserve</dt><dd>{money(result.usableFunds)}</dd><dt>One-time opening cash (not recurring)</dt><dd><ul className="decision-upfront">{upfrontCategories.map(category => <li key={category}>{category.replaceAll("_", " ")}: {upfront(category) === null ? "blank" : money(upfront(category))}</li>)}</ul></dd><dt>Complete upfront plan</dt><dd>{money(result.completeUpfront)} · known subtotal {money(result.knownUpfront)}</dd><dt>Opening funds remaining</dt><dd>{money(result.openingFundsRemaining)}</dd><dt>Contribution after fixed costs at assumed sales</dt><dd>{result.assumedContributionAfterFixed ? `${money(result.assumedContributionAfterFixed.low)}–${money(result.assumedContributionAfterFixed.high)}` : "Unavailable — no sales/profit/payback prediction"}</dd></dl><details><summary>Finance gaps and assumptions ({result.gaps.length})</summary><ul>{[...result.gaps, ...result.notes].map((item, index) => <li key={index}>{item}</li>)}</ul></details></div>;
}

const financeLabels = { additionalOccupancyMonthly: "Nonincluded occupancy charges / month", fixedCostsMonthly: "Fixed costs / month", contributionMargin: "Contribution margin (0–1)", totalFunds: "Total funds", reserve: "Emergency reserve", averageSpend: "Average guest spend", operatingDays: "Operating days / month", assumedSalesMonthly: "Assumed monthly sales (optional)" } as const;
function FinanceForm({ inputs, onApply, onDirty }: { inputs: DecisionFinanceInputs; onDirty: () => void; onApply: (inputs: DecisionFinanceInputs) => void }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(Object.entries(financeLabels).map(([key]) => [key, inputs[key as keyof typeof financeLabels]?.toString() ?? ""])) as Record<keyof typeof financeLabels, string>);
  const [upfront, setUpfront] = useState(() => Object.fromEntries(upfrontCategories.map(category => [category, inputs.upfront.find(x => x.category === category)?.amount?.toString() ?? ""])) as Record<typeof upfrontCategories[number], string>);
  const [basis, setBasis] = useState(inputs.fixedCostBasis);
  const [illustrative, setIllustrative] = useState<IllustrativeKey[]>(inputs.illustrative);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const numeric = (raw: string) => raw.trim() ? Number(raw) : null;
  return <details className="decision-finance-editor"><summary>Opening finance assumptions</summary><p>Blank means unknown. Profile funds/reserve, when supplied, are copied as starting inputs; all edits are planning assumptions. Deposits and working capital are cash needs, not recurring costs.</p>
    <p className="small-note">Illustrative values are optional, clearly labeled placeholders for blank margin, spend and operating days only — never fixed costs, funds, upfront costs or sales.</p>
    <form onSubmit={event => { event.preventDefault(); const parsed = decisionFinanceInputsSchema.safeParse({ ...Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, numeric(value)])), fixedCostBasis: basis, illustrative, upfront: upfrontCategories.map(category => ({ category, amount: numeric(upfront[category]) })) }); if (parsed.success) { onApply(parsed.data); setError(""); setDirty(false); } else setError(parsed.error.issues.map(x => x.message).join(" ")); }}>
      <div className="decision-form-grid">{Object.entries(financeLabels).map(([key, label]) => <label key={key}>{label}{illustrative.includes(key as IllustrativeKey) && <span className="tiny-badge">Illustrative</span>}<input type="number" min="0" step="any" value={draft[key as keyof typeof draft]} onChange={event => { setDraft(old => ({ ...old, [key]: event.target.value })); setIllustrative(old => old.filter(x => x !== key)); setDirty(true); onDirty(); }} /></label>)}
        <label>Fixed cost scope<select value={basis} onChange={event => { setBasis(event.target.value as typeof basis); setDirty(true); onDirty(); }}><option value="excludes_occupancy">Excludes occupancy — add supported rent range</option><option value="includes_occupancy">Complete fixed costs — occupancy already included</option></select></label>
        {upfrontCategories.map(category => <label key={category}>Upfront: {category.replaceAll("_", " ")}<input type="number" min="0" step="any" value={upfront[category]} onChange={event => { setUpfront(old => ({ ...old, [category]: event.target.value })); setDirty(true); onDirty(); }} /></label>)}
      </div>{error && <p role="alert" className="warning">{error}</p>}{dirty && <p role="status">Finance edits are not applied yet. Apply them before saving the brief.</p>}<div className="decision-inline"><button type="button" className="secondary" onClick={() => {
        const current = Object.fromEntries(illustrativeKeys.map(key => [key, numeric(draft[key])])) as Record<IllustrativeKey, number | null>;
        const filled = applyIllustrative({ ...emptyFinanceInputs(), ...current, illustrative: illustrative.filter(key => current[key] !== null) });
        setDraft(old => ({ ...old, ...Object.fromEntries(illustrativeKeys.map(key => [key, filled[key]?.toString() ?? ""])) })); setIllustrative(filled.illustrative); setDirty(true); onDirty();
      }}>Fill blank fields with labeled illustrative values</button><button className="secondary">Apply finance assumptions</button></div>
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
