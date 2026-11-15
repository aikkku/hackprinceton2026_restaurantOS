"use client";

import { useState } from "react";
import type { BriefChoice } from "../../domain/decision-brief.ts";
import type { RequirementAssessment } from "../../domain/matching.ts";
import { FIT_LABEL, budgetCap, checkQuestion, fitForGroup, friendlyReason, money, rangeLabel } from "./model.ts";
import { type PlanEntry } from "./home.tsx";
import { placeSubtitle } from "./places.tsx";
import { AskButton, Back, Disclosure, FitPill, Thumb } from "./ui.tsx";
import type { Workspace } from "./workspace.ts";

const HARD = ["occupancy.monthlyLimit", "space.existingKitchen", "space.customerParking"];

/** Owner-facing next steps: open checks first, then the money still to work out. */
export function nextQuestionsFor(_workspace: Workspace, choices: BriefChoice[]): string[] {
  const money = choices.flatMap((choice) => {
    const name = choice.assessment.candidate.name;
    const result = choice.financeResults;
    return [
      result.occupancy?.high === null ? `Get the extra building charges for ${name}.` : null,
      result.completeUpfront === null ? `Work out the money needed to open ${name}.` : null,
      result.usableFunds === null ? "Decide how much money to keep in reserve." : null,
      result.requiredSales === null ? `Add monthly costs and what’s left from each sale for ${name}.` : null,
    ].filter((line): line is string => Boolean(line));
  });
  return [...new Set([
    ...choices.flatMap((choice) => choice.assessment.assessments.map(checkQuestion).filter((q): q is string => Boolean(q))),
    ...money,
  ])];
}

export function promisingLines(choice: BriefChoice, workspace: Workspace): string[] {
  const cap = budgetCap(workspace.requirements);
  const lines: string[] = [];
  const total = choice.financeResults.occupancy;
  if (total && total.high !== null && cap !== null && total.high <= cap) lines.push(`${rangeLabel(total, "/mo")} with all charges, ${money(cap - total.high)} under budget`);
  for (const item of choice.assessment.assessments) {
    if (item.status !== "pass" || item.requirementId === "occupancy.monthlyLimit") continue;
    lines.push(friendlyReason(item.reasonCode, workspace.requirements));
  }
  return lines;
}

export function biggestConcern(choice: BriefChoice, workspace: Workspace): string {
  const order = (a: RequirementAssessment) => (a.status === "fail" ? 0 : 1) + (HARD.includes(a.requirementId) ? 0 : 2);
  const open = choice.assessment.assessments.filter((a) => a.status === "fail" || a.status === "unknown").sort((a, b) => order(a) - order(b))[0];
  if (open) return open.status === "fail" ? friendlyReason(open.reasonCode, workspace.requirements) : checkQuestion(open) ?? open.reason;
  if (choice.financeResults.completeUpfront === null) return "The money needed to open isn’t worked out yet.";
  if (choice.financeResults.openingFundsRemaining !== null && choice.financeResults.openingFundsRemaining < 0) return `You’d be ${money(-choice.financeResults.openingFundsRemaining)} short of opening money after your reserve.`;
  return "Nothing open from the checks we ran. Confirm the details in person.";
}

export function Plan({ workspace, choices, pick, image, plans, restoredFrom, saving, notice, error, onSave, onAsk, onBack, onOpenPlan, onStartOver }: {
  workspace: Workspace;
  choices: BriefChoice[];
  pick: BriefChoice;
  image: string | null;
  plans: PlanEntry[];
  restoredFrom: string | null;
  saving: boolean;
  notice: string;
  error: string;
  onSave: (title: string) => void;
  onAsk: () => void;
  onBack: () => void;
  onOpenPlan: (entry: PlanEntry) => void;
  onStartOver: () => void;
}) {
  const candidate = pick.assessment.candidate;
  const [title, setTitle] = useState(() => `${candidate.name} plan`);
  const promising = promisingLines(pick, workspace);
  const concern = biggestConcern(pick, workspace);
  // The concern is already shown in step 3; next steps continue from there.
  const questions = nextQuestionsFor(workspace, [pick]).filter((q) => q !== concern);
  const allQuestions = nextQuestionsFor(workspace, choices);
  const total = rangeLabel(pick.financeResults.occupancy, "/mo");
  const canSave = Boolean(workspace.bundle) && choices.length >= 2 && choices.length <= 3;

  return (
    <main className="sx-page">
      <Back onClick={onBack}>{restoredFrom ? "Home" : "Opening costs"}</Back>
      {restoredFrom && <p className="sx-notice sx-small">This is a saved plan from {new Date(restoredFrom).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}. Its facts were frozen when you saved it; listings may have changed since.</p>}
      <h1 className="sx-title">Here’s what we recommend looking at first.</h1>

      <div className="sx-reco">
        <div className="sx-reco-top">
          <Thumb src={image} alt={candidate.name} variant="reco" />
          <div className="sx-stack" style={{ gap: 4 }}>
            <span className="sx-reco-label">1 · Your pick</span>
            <h2 className="sx-title-sm" style={{ fontSize: 22 }}>{candidate.name}</h2>
            <span className="sx-small sx-muted">{[placeSubtitle(candidate), total].filter(Boolean).join(" · ")}</span>
            <span><FitPill fit={fitForGroup(pick.assessment.group)} /></span>
          </div>
        </div>
        <div className="sx-reco-item">
          <span className="sx-reco-num">2</span>
          <div className="sx-stack" style={{ gap: 4 }}>
            <span className="sx-reco-label">Why it’s promising</span>
            {promising.length ? promising.map((line) => <p key={line} className="sx-reco-text">{line}</p>) : <p className="sx-reco-text">Nothing is confirmed yet. Start with the checks below.</p>}
          </div>
        </div>
        <div className="sx-reco-item">
          <span className="sx-reco-num">3</span>
          <div className="sx-stack" style={{ gap: 4 }}>
            <span className="sx-reco-label">Biggest remaining concern</span>
            <p className="sx-reco-text">{concern}</p>
          </div>
        </div>
        <div className="sx-reco-item">
          <span className="sx-reco-num">4</span>
          <div className="sx-stack" style={{ gap: 6 }}>
            <span className="sx-reco-label">Next step</span>
            <p className="sx-reco-text">{questions[0] ?? `Visit ${candidate.name} and confirm the details in person.`}</p>
            {questions.length > 1 && (
              <details>
                <summary className="sx-btn-text" style={{ cursor: "pointer", paddingLeft: 0, fontWeight: 600 }}>See all next steps ({questions.length - 1} more)</summary>
                <ul className="sx-small" style={{ margin: "8px 0 0", paddingLeft: 20 }}>{questions.slice(1).map((q) => <li key={q}>{q}</li>)}</ul>
              </details>
            )}
          </div>
        </div>
      </div>

      {!restoredFrom && (
        <form className="sx-form" aria-label="Save this plan" onSubmit={(event) => { event.preventDefault(); onSave(title.trim()); }}>
          <div className="sx-field">
            <label htmlFor="sx-plan-name">Plan name</label>
            <input id="sx-plan-name" className="sx-textinput" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
          </div>
          {!canSave && <p className="sx-small sx-muted">{workspace.bundle ? "Compare 2 or 3 saved places to keep a plan." : "Plans can only be saved from a full search with the specialists."}</p>}
          <div className="sx-row">
            <button className="sx-btn sx-btn-primary sx-btn-big" disabled={!canSave || saving || !title.trim()}>{saving ? "Saving…" : "Save this plan"}</button>
            <AskButton onClick={onAsk} />
          </div>
        </form>
      )}
      {restoredFrom && <div><AskButton onClick={onAsk} /></div>}
      {notice && <p className="sx-notice sx-notice-good" role="status">{notice}</p>}
      {error && <p className="sx-notice sx-notice-bad" role="alert">{error}</p>}

      <div>
        <Disclosure title="Money side by side">
          <div className="sx-scroll">
            <table className="sx-table">
              <thead><tr><th scope="col">&nbsp;</th>{choices.map((c) => <th scope="col" key={c.candidateId}>{c.assessment.candidate.name}{c.candidateId === pick.candidateId ? " ★" : ""}</th>)}</tr></thead>
              <tbody>
                <tr><th scope="row">Must-haves</th>{choices.map((c) => <td key={c.candidateId}>{FIT_LABEL[fitForGroup(c.assessment.group)]}</td>)}</tr>
                <tr><th scope="row">Monthly rent cost</th>{choices.map((c) => <td key={c.candidateId}>{rangeLabel(c.financeResults.occupancy, "/mo") ?? "Not known"}</td>)}</tr>
                <tr><th scope="row">Money needed to open</th>{choices.map((c) => <td key={c.candidateId}>{c.financeResults.completeUpfront === null ? "Not worked out yet" : money(c.financeResults.completeUpfront)}</td>)}</tr>
                <tr><th scope="row">Left over or short</th>{choices.map((c) => <td key={c.candidateId}>{c.financeResults.openingFundsRemaining === null ? "Not worked out yet" : money(c.financeResults.openingFundsRemaining)}</td>)}</tr>
                <tr><th scope="row">Sales needed each month</th>{choices.map((c) => <td key={c.candidateId}>{rangeLabel(c.financeResults.requiredSales) ?? "Not worked out yet"}</td>)}</tr>
                <tr><th scope="row">Example values used</th>{choices.map((c) => <td key={c.candidateId}>{c.financeInputs.illustrative.length ? "Yes" : "No"}</td>)}</tr>
              </tbody>
            </table>
          </div>
          <p className="sx-small sx-muted">Break-even lines, not forecasts. Only the places you worked out costs for have full numbers.</p>
        </Disclosure>
        <Disclosure title="Questions still open" hint={allQuestions.length}>
          {allQuestions.length ? <ul className="sx-small" style={{ margin: 0, paddingLeft: 20 }}>{allQuestions.map((q) => <li key={q}>{q}</li>)}</ul> : <p className="sx-muted">None from the checks we ran.</p>}
        </Disclosure>
        <Disclosure title="Saved plans" hint={plans.length} last>
          {plans.length === 0 ? <p className="sx-muted sx-small">No saved plans yet.</p> : (
            <ul className="sx-list">
              {plans.map((entry) => (
                <li key={`${entry.where}-${entry.brief.id}`}>
                  <span className="sx-list-main"><span className="sx-list-value">{entry.brief.title}</span><span className="sx-list-label">{new Date(entry.brief.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {entry.where === "workspace" ? "Your workspace" : "This browser"}</span></span>
                  <button type="button" className="sx-btn sx-btn-secondary" onClick={() => onOpenPlan(entry)}>Open</button>
                </li>
              ))}
            </ul>
          )}
        </Disclosure>
      </div>
      <div><button type="button" className="sx-btn sx-btn-text" onClick={onStartOver}>Start over</button></div>
    </main>
  );
}
