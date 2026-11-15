"use client";

import { useState } from "react";
import type { BriefChoice } from "../../domain/decision-brief.ts";
import { investigationNoteSchema, type InvestigationNote, type SourceObservation } from "../../domain/evidence.ts";
import type { AssessedCandidate, CandidateFact, RequirementAssessment } from "../../domain/matching.ts";
import {
  FACTOR_NAME, FACTOR_REQUIREMENT, FIT_LABEL, chargesLabel, checkQuestion, costLabel, estimateCostLabel, estimateMethodText, fitForGroup, fitForStatus, friendlyReason,
  money, monthlyCost, quotedRate, rangeLabel, ruleLabel, verdict, occupancyBreakdown, type FactorKey,
} from "./model.ts";
import { placeSubtitle } from "./places.tsx";
import { AskButton, Back, Disclosure, Dot, FitPill, Tag, Thumb, type TagKind } from "./ui.tsx";
import type { Workspace } from "./workspace.ts";

type EvidenceRef = { label: string; date: string | null; origin: string; user: boolean };

export function evidenceIndex(choice: BriefChoice, candidate: AssessedCandidate["candidate"]): Map<string, EvidenceRef> {
  const index = new Map<string, EvidenceRef>();
  for (const id of candidate.sourceIds) index.set(id, { label: candidate.isDemo ? "Synthetic listing record" : "CoStar listing record", date: candidate.recordDate ?? candidate.datasetDate, origin: "observed", user: false });
  for (const observation of choice.assessment.sources.observations) {
    index.set(observation.id, { label: observation.label, date: observation.sourceDate, origin: observation.origin, user: false });
    for (const fact of observation.facts) index.set(fact.id, { label: fact.source.label, date: fact.source.capturedAt, origin: fact.origin, user: false });
  }
  for (const note of choice.assessment.notes) index.set(note.fact.id, { label: note.fact.source.label, date: note.fact.source.capturedAt, origin: note.fact.origin, user: true });
  return index;
}

const dateText = (value: string | null) => {
  if (!value) return "date unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export function factTag(assessment: RequirementAssessment, index: Map<string, EvidenceRef>): { kind: TagKind; text: string } {
  const refs = assessment.evidenceIds.map((id) => index.get(id)).filter((ref): ref is EvidenceRef => Boolean(ref));
  if (refs.some((ref) => ref.user)) return { kind: "owner", text: "Your check" };
  if (assessment.status === "unknown") return { kind: "unknown", text: "Not confirmed" };
  if (assessment.status === "not_applicable") return { kind: "unknown", text: "Not checked" };
  if (refs.some((ref) => ref.origin === "derived")) return { kind: "estimate", text: "Estimate" };
  return { kind: "listing", text: refs.length && refs.every((ref) => ref.label !== "CoStar listing record" && ref.label !== "Synthetic listing record") ? "From a source check" : "From the listing" };
}

export function factorLine(key: FactorKey, assessment: RequirementAssessment, choice: BriefChoice, workspace: Workspace): string {
  if (key === "cost") return rangeLabel(choice.financeResults.occupancy, "/mo") ?? costLabel(monthlyCost(choice.assessment.candidate));
  if (key === "space") return assessment.status === "pass" || assessment.status === "fail" ? assessment.sourceValue : friendlyReason(assessment.reasonCode, workspace.requirements);
  return friendlyReason(assessment.reasonCode, workspace.requirements);
}

export function PlaceDetail({ workspace, choice, isSaved, savedCount, maxSaved, image, busy, notice, error, onBack, onToggleSave, onCompare, onAsk, onRefresh, onAddNote }: {
  workspace: Workspace;
  choice: BriefChoice;
  isSaved: boolean;
  savedCount: number;
  maxSaved: number;
  image: string | null;
  busy: boolean;
  notice: string;
  error: string;
  onBack: () => void;
  onToggleSave: () => void;
  onCompare: () => void;
  onAsk: () => void;
  onRefresh: (mode: "live" | "synthetic") => void;
  onAddNote: (note: InvestigationNote) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const candidate = choice.assessment.candidate;
  const assessments = choice.assessment.assessments;
  const index = evidenceIndex(choice, candidate);
  const byId = (id: RequirementAssessment["requirementId"]) => assessments.find((item) => item.requirementId === id);
  const neighborhood = byId("market.neighborhoodPreference");
  const area = neighborhood?.status === "pass" ? neighborhood.sourceValue : null;
  const questions = [...new Set(assessments.map(checkQuestion).filter((q): q is string => Boolean(q)))];
  const inspectorTasks = workspace.tasks.get(candidate.id) ?? [];
  const observations = choice.assessment.sources.observations;
  const scans = observations.filter((o) => o.provider === "matterport");
  const aerials = observations.filter((o) => o.provider === "vexcel");
  const statusFor = (provider: SourceObservation["provider"]) => choice.assessment.sources.statuses.find((s) => s.provider === provider);
  // Owner-friendly wording for missing scans/aerials; the exact provider status
  // and reason stay visible in "Source status" under Listing details.
  const gapText = (provider: "matterport" | "vexcel") => {
    const status = statusFor(provider);
    const none = provider === "matterport" ? "No interior scan exists for this space." : "No aerial photo is available for this place.";
    if (!status || status.reason.includes("Configure EXPANSION_SOURCE_NETWORK") || status.status === "configured") return none;
    if (status.status === "outside_coverage") return provider === "matterport" ? none : "No aerial photo is in our imagery source's coverage for this area.";
    if (status.status === "denied") return provider === "matterport" ? "We couldn’t reach the scan source right now (access was denied)." : "We couldn’t reach the imagery source right now (access was denied).";
    return provider === "matterport" ? "We couldn’t reach the scan source right now." : "We couldn’t reach the imagery source right now.";
  };
  // Live workspaces carry estimates in workspace.rentEstimates; saved plans
  // carry the opted-in estimate in the choice's financeInputs (provenance).
  const estimate = choice.financeInputs.occupancyEstimate ?? workspace.rentEstimates.get(candidate.id) ?? null;
  const split = occupancyBreakdown(candidate, choice.financeInputs.additionalOccupancyMonthly, choice.financeInputs.occupancyEstimate?.monthly ?? null);
  const factors = (["cost", "parking", "kitchen", "space"] as FactorKey[]).map((key) => ({ key, assessment: byId(FACTOR_REQUIREMENT[key]) })).filter((x): x is { key: FactorKey; assessment: RequirementAssessment } => Boolean(x.assessment));

  return (
    <main className="sx-page">
      <Back onClick={onBack}>All places</Back>
      <div className="sx-hero">
        <Thumb src={image} alt={candidate.name} variant="hero" />
        <div className="sx-hero-main">
          <span className="sx-small sx-muted">{area ?? "Neighborhood not confirmed"}</span>
          <h1 className="sx-title-sm">{candidate.name}</h1>
          <span className="sx-muted">{placeSubtitle(candidate)}</span>
          <div className="sx-row" style={{ gap: 8 }}>
            <FitPill fit={fitForGroup(choice.assessment.group)} />
            {isSaved && <Tag kind="followup">Saved</Tag>}
            {candidate.isDemo && <Tag kind="example">Synthetic listing</Tag>}
          </div>
        </div>
      </div>

      <p className="sx-verdict">{verdict(assessments, choice.assessment.group, workspace.requirements)}</p>

      <div className="sx-factors">
        {factors.map(({ key, assessment }) => {
          const fit = fitForStatus(assessment.status);
          const tag = factTag(assessment, index);
          return (
            <div key={key} className="sx-factor">
              <Dot fit={fit} />
              <div className="sx-stack" style={{ gap: 4 }}>
                <span className="sx-factor-name">{FACTOR_NAME[key]}</span>
                <span className="sx-factor-status">{FIT_LABEL[fit]}</span>
                <span>{factorLine(key, assessment, choice, workspace)}</span>
                <span><Tag kind={tag.kind}>{tag.text}</Tag></span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sx-row">
        {isSaved && savedCount >= 2
          ? <button type="button" className="sx-btn sx-btn-primary sx-btn-big" onClick={onCompare}>Compare saved places</button>
          : !isSaved && <button type="button" className="sx-btn sx-btn-primary sx-btn-big" disabled={savedCount >= maxSaved} onClick={onToggleSave}>Save this place</button>}
        <AskButton onClick={onAsk} />
        {isSaved && <button type="button" className="sx-btn sx-btn-text" onClick={onToggleSave}>Remove from saved</button>}
      </div>
      {!isSaved && savedCount >= maxSaved && <p className="sx-small sx-muted">You’ve saved {maxSaved} places. Remove one to save this place.</p>}
      {notice && <p className="sx-notice sx-notice-good" role="status">{notice}</p>}
      {error && <p className="sx-notice sx-notice-bad" role="alert">{error}</p>}

      <div>
        <Disclosure title="Things to check" hint={questions.length}>
          {questions.length === 0 ? <p className="sx-muted">Nothing open from the checks we ran.</p> : (
            <ul className="sx-check-list">
              {questions.map((question) => <li key={question} className="sx-check-q"><Dot fit="verify" /><span>{question}</span></li>)}
            </ul>
          )}
          <div className="sx-row">
            <button type="button" className="sx-btn sx-btn-secondary" disabled={busy || workspace.source === "saved_plan"} onClick={() => onRefresh("live")}>{busy ? "Looking…" : "Look for missing details"}</button>
            <button type="button" className="sx-btn sx-btn-text" aria-expanded={noteOpen} onClick={() => setNoteOpen((open) => !open)}>I checked something</button>
            {workspace.isSynthetic && workspace.source === "agent" && <button type="button" className="sx-btn sx-btn-text" disabled={busy} onClick={() => onRefresh("synthetic")}>Load test source examples</button>}
          </div>
          {workspace.source === "saved_plan" && <p className="sx-small sx-muted">Saved plans keep the evidence they were saved with. Start a new search to look again.</p>}
          {noteOpen && <NoteForm candidateId={candidate.id} onAdd={(note) => { onAddNote(note); setNoteOpen(false); }} />}
        </Disclosure>

        <Disclosure title="How we checked">
          {assessments.map((assessment) => {
            const tag = factTag(assessment, index);
            const refs = assessment.evidenceIds.map((id) => ({ id, ref: index.get(id) }));
            return (
              <div key={assessment.requirementId} className="sx-ev">
                <span className="sx-strong">{ruleLabel(workspace.requirements, assessment.requirementId)}</span>
                <div className="sx-ev-head"><FitPill fit={fitForStatus(assessment.status)} /><Tag kind={tag.kind}>{tag.text}</Tag></div>
                <ul>
                  <li>{assessment.reason}</li>
                  <li>What the record says: {assessment.sourceValue}</li>
                  {refs.map(({ id, ref }) => <li key={id}>{ref ? `${ref.label} (${dateText(ref.date)})` : `Evidence ${id} (date unknown)`}</li>)}
                </ul>
              </div>
            );
          })}
          {estimate && (
            <div className="sx-ev">
              <span className="sx-strong">Estimated rent method</span>
              <div className="sx-ev-head"><Tag kind="estimate">Estimate</Tag></div>
              <ul>
                <li>{candidate.isDemo ? `Synthetic ${estimateMethodText(estimate)}` : estimateMethodText(estimate)}</li>
                <li>Base rent only; extra building charges aren’t included.</li>
              </ul>
            </div>
          )}
          {inspectorTasks.length > 0 && (
            <div className="sx-ev">
              <span className="sx-strong">Space inspector’s follow-ups</span>
              <ul>{inspectorTasks.map((task) => <li key={task}>{task}</li>)}</ul>
            </div>
          )}
          {choice.assessment.conflicts.length > 0 && <p className="sx-notice sx-small">Some sources disagree about {choice.assessment.conflicts.join(", ")}. We keep both and mark it as needing checking.</p>}
          {choice.assessment.notes.length > 0 && (
            <div className="sx-ev">
              <span className="sx-strong">Your notes</span>
              <ul>{choice.assessment.notes.map((note) => <li key={note.id}>{note.category === "verification" ? "You checked" : "Your assumption (doesn’t confirm a must-have)"}: {note.text} · {note.fact.source.label}{note.fact.source.capturedAt ? ` (${dateText(note.fact.source.capturedAt)})` : ""}</li>)}</ul>
            </div>
          )}
        </Disclosure>

        <Disclosure title="Inside the space" open={scans.some((scan) => scan.viewerUrl) || undefined} hint={scans.length ? (scans[0].sourceDate ? `Scan from ${dateText(scans[0].sourceDate)}` : "Interior scan available") : "No scan yet"}>
          {scans.length ? scans.map((scan) => (
            <div key={scan.id} className="sx-stack">
              {scan.isSynthetic && <Tag kind="example">Test example, not a real scan</Tag>}
              {scan.viewerUrl
                // play=1 starts the tour without the splash/play button; qs=1 skips the fly-in intro.
                ? <iframe className="sx-viewer" title={`Interior scan of ${candidate.name}`} src={`${scan.viewerUrl}&play=1&qs=1`} allow="fullscreen; xr-spatial-tracking" allowFullScreen sandbox="allow-scripts allow-same-origin allow-presentation" />
                : <p className="sx-muted">{scan.label}</p>}
              <ul className="sx-small sx-muted">{[...scan.details, ...scan.limitations].map((line, i) => <li key={i}>{line}</li>)}</ul>
            </div>
          )) : <p className="sx-muted">{gapText("matterport")}</p>}
        </Disclosure>

        <Disclosure title="From above" hint={aerials.length ? (aerials[0].sourceDate ? `Aerial photo, ${dateText(aerials[0].sourceDate)}` : "Aerial photo available") : "No aerial photo yet"}>
          {aerials.length ? aerials.map((aerial) => (
            <div key={aerial.id} className="sx-stack">
              {aerial.isSynthetic && <Tag kind="example">Test example, not a real photo</Tag>}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {aerial.imageUrl && <div className="sx-aerial"><img src={aerial.imageUrl} alt={`Aerial view around ${candidate.name}`} /></div>}
              <ul className="sx-small sx-muted">{[...aerial.details, ...aerial.limitations].map((line, i) => <li key={i}>{line}</li>)}</ul>
              <p className="sx-small sx-muted">Visible parking spaces don’t show who may use them.</p>
            </div>
          )) : <p className="sx-muted">{gapText("vexcel")}</p>}
        </Disclosure>

        <Disclosure title="Listing details and sources" last>
          <dl className="sx-facts">
            <div><dt>Space available</dt><dd>{candidate.floorAreaSqFt !== null ? `${candidate.floorAreaSqFt.toLocaleString("en-US")} sq ft` : candidate.sizeRangeSqFt.minimum !== null ? `${candidate.sizeRangeSqFt.minimum.toLocaleString("en-US")}–${candidate.sizeRangeSqFt.maximum?.toLocaleString("en-US") ?? "?"} sq ft` : "Not listed"}</dd></div>
            <div><dt>Quoted rent</dt><dd>{quotedRate(candidate) ?? "Not listed in a supported unit"}</dd></div>
            {quotedRate(candidate) === null && (
              <div><dt>Estimated base rent</dt><dd>{estimate ? estimateCostLabel(estimate) : "Not available"}</dd></div>
            )}
            <div><dt>Base rent</dt><dd>{rangeLabel(split.baseRent, "/mo") ?? "Can’t work out"}</dd></div>
            <div><dt>Extra building charges</dt><dd>{split.additional.status === "known" && split.additional.monthly !== null ? `${money(split.additional.monthly)}/mo (your number)` : chargesLabel(candidate)}</dd></div>
            <div><dt>Total monthly cost</dt><dd>{rangeLabel(choice.financeResults.occupancy, "/mo") ?? "Not known yet"}</dd></div>
            <div><dt>Address</dt><dd>{candidate.address ?? "Not listed"}</dd></div>
            <div><dt>Suite</dt><dd>{candidate.suite ?? "Not listed"}</dd></div>
            <div><dt>Record date</dt><dd>{dateText(candidate.recordDate ?? candidate.datasetDate)}</dd></div>
            <div><dt>Listing IDs</dt><dd>{candidate.sourceIds.join(", ")}</dd></div>
            <div><dt>Match order</dt><dd>{(() => { const base = workspace.candidates.find((c) => c.candidate.id === candidate.id); return base ? `#${base.rank} of ${workspace.candidates.length}` : "—"; })()}</dd></div>
          </dl>
          <div className="sx-stack">
            <span className="sx-strong">Where these facts come from</span>
            <div className="sx-ev">
              <span className="sx-strong">{candidate.isDemo ? "Synthetic test listing" : "CoStar property listing"}</span>
              <span className="sx-small sx-muted">{dateText(candidate.recordDate ?? candidate.datasetDate)} · Used for: rent, size, suite, location</span>
              <span className="sx-small sx-muted">Limits: broker marketing data; not checked on site. A listing can change after its snapshot.</span>
            </div>
            {observations.map((observation) => (
              <div key={observation.id} className="sx-ev">
                <span className="sx-strong">{observation.label}{observation.isSynthetic ? " (test example)" : ""}</span>
                <span className="sx-small sx-muted">{dateText(observation.sourceDate)} · covers the {observation.scope}</span>
                {observation.limitations.length > 0 && <span className="sx-small sx-muted">Limits: {observation.limitations.join(" ")}</span>}
                {observation.referenceUrl && <a href={observation.referenceUrl} target="_blank" rel="noreferrer" className="sx-small">Source reference</a>}
              </div>
            ))}
            <details className="sx-small sx-muted">
              <summary>Source status ({choice.assessment.sources.statuses.length})</summary>
              <ul>{choice.assessment.sources.statuses.map((status) => <li key={status.provider}>{status.provider}: {status.status} · {status.reason}</li>)}</ul>
            </details>
            <p className="sx-small sx-muted">Checked {dateText(choice.assessment.sources.refreshedAt)} · assessment version {choice.assessment.revisionNumber + 1}{workspace.source === "agent" && choice.assessment.revisionNumber === 0 && workspace.evidence.has(candidate.id) ? " · evidence collected during the search" : ""}.</p>
          </div>
        </Disclosure>
      </div>
    </main>
  );
}

function NoteForm({ candidateId, onAdd }: { candidateId: string; onAdd: (note: InvestigationNote) => void }) {
  const [field, setField] = useState<"existingKitchen" | "customerParking" | "monthlyAdditionalCharges">("existingKitchen");
  const [value, setValue] = useState("verified_present");
  const [how, setHow] = useState<"verification" | "assumption">("verification");
  const [source, setSource] = useState("");
  const [date, setDate] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const options = field === "existingKitchen"
    ? [["verified_present", "There is a kitchen"], ["verified_absent", "There is no kitchen"]]
    : [["verified_customer_parking", "Customers can use the parking"], ["verified_absent", "No customer parking"]];
  return (
    <form className="sx-form" aria-label="Record something you checked" onSubmit={(event) => {
      event.preventDefault();
      const id = crypto.randomUUID();
      const amount = Number(value.replace(/,/g, ""));
      const fact = {
        id: `user:${id}`, entityScope: "space", entityId: candidateId, field,
        value: field === "monthlyAdditionalCharges" ? { kind: "exact", value: amount } : { kind: "exact", value },
        unit: field === "monthlyAdditionalCharges" ? "USD/month" : null,
        origin: how === "verification" ? "observed" : "assumed",
        source: { label: how === "verification" ? `You checked: ${source}` : "Your assumption", recordId: how === "verification" ? source : null, capturedAt: how === "verification" && date ? `${date}T00:00:00.000Z` : null },
        method: how === "verification" ? "Owner says this source applies to this suite; customer parking means documented use rights." : "Owner planning assumption; not verified",
        limitations: ["Provided by you; not independently certified."], isDemo: false,
      } as CandidateFact;
      const parsed = investigationNoteSchema.safeParse({ id, category: how, createdAt: new Date().toISOString(), text: text.trim() || "Owner note", fact });
      if (field === "monthlyAdditionalCharges" && (!value.trim() || !Number.isFinite(amount) || amount < 0)) { setError("Enter the monthly charges as a number."); return; }
      if (parsed.success) { onAdd(parsed.data); setError(""); } else setError(how === "verification" ? "Add where you saw it and the date." : "Check the details and try again.");
    }}>
      <div className="sx-form-grid">
        <div className="sx-field"><label htmlFor="sx-note-field">What did you check?</label>
          <select id="sx-note-field" className="sx-textinput" value={field} onChange={(event) => { const next = event.target.value as typeof field; setField(next); setValue(next === "existingKitchen" ? "verified_present" : next === "customerParking" ? "verified_customer_parking" : ""); }}>
            <option value="existingKitchen">Kitchen</option><option value="customerParking">Customer parking</option><option value="monthlyAdditionalCharges">Extra building charges</option>
          </select></div>
        <div className="sx-field"><label htmlFor="sx-note-value">What did you find?</label>
          {field === "monthlyAdditionalCharges"
            ? <input id="sx-note-value" className="sx-textinput" inputMode="decimal" placeholder="$ per month" value={value} onChange={(event) => setValue(event.target.value)} />
            : <select id="sx-note-value" className="sx-textinput" value={value} onChange={(event) => setValue(event.target.value)}>{options.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}
        </div>
        <div className="sx-field"><label htmlFor="sx-note-how">How do you know?</label>
          <select id="sx-note-how" className="sx-textinput" value={how} onChange={(event) => setHow(event.target.value as typeof how)}>
            <option value="verification">I saw it (document or visit)</option><option value="assumption">It’s my assumption</option>
          </select></div>
        {how === "verification" && <>
          <div className="sx-field"><label htmlFor="sx-note-source">Where did you see it?</label><input id="sx-note-source" className="sx-textinput" placeholder="Lease draft, site visit…" value={source} onChange={(event) => setSource(event.target.value)} /></div>
          <div className="sx-field"><label htmlFor="sx-note-date">When?</label><input id="sx-note-date" className="sx-textinput" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div>
        </>}
        <div className="sx-field"><label htmlFor="sx-note-text">Note (optional)</label><input id="sx-note-text" className="sx-textinput" maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} /></div>
      </div>
      <p className="sx-small sx-muted">{how === "assumption" ? "An assumption is kept as a note. It never confirms a must-have." : "We’ll re-check this place with what you saw. If sources disagree, both are kept."}</p>
      {error && <p className="sx-error" role="alert">{error}</p>}
      <div><button className="sx-btn sx-btn-primary">Add to this place</button></div>
    </form>
  );
}
