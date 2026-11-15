"use client";

import { Sprout } from "lucide-react";
import type { BriefChoice } from "../../domain/decision-brief.ts";
import type { RequirementAssessment } from "../../domain/matching.ts";
import { FACTOR_REQUIREMENT, FIT_LABEL, assessmentLabel, displayAssessment, budgetCap, compareTake, fitForGroup, fitForAssessment, money, monthlyCost, rangeLabel, unresolvedMustHaves, FACTOR_NAME, type FactorKey } from "./model.ts";
import { evidenceIndex, factTag, factorLine } from "./place-detail.tsx";
import { placeSubtitle } from "./places.tsx";
import { AskButton, Back, Disclosure, Dot, FitPill, Tag, Thumb } from "./ui.tsx";
import type { Workspace } from "./workspace.ts";

const ROWS: { key: FactorKey; label: string }[] = [
  { key: "cost", label: "Cost" },
  { key: "parking", label: "Parking" },
  { key: "kitchen", label: "Kitchen readiness" },
  { key: "space", label: "Seating" },
];

export function Compare({ workspace, choices, images, pick, onPick, onWorkOut, onAsk, onOpen, onBack }: {
  workspace: Workspace;
  choices: BriefChoice[];
  images: Map<string, string | null>;
  pick: string | null;
  onPick: (id: string) => void;
  onWorkOut: () => void;
  onAsk: () => void;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const find = (choice: BriefChoice, key: FactorKey) => choice.assessment.assessments.find((a) => a.requirementId === FACTOR_REQUIREMENT[key]);
  const differs = (key: FactorKey) => new Set(choices.map((choice) => find(choice, key)?.status ?? "none")).size > 1 || (key === "cost" && new Set(choices.map((c) => rangeLabel(c.financeResults.occupancy))).size > 1);
  const take = compareTake(choices.map((choice) => ({
    name: choice.assessment.candidate.name, assessments: choice.assessment.assessments, group: choice.assessment.group,
    cost: choice.financeResults.occupancy ? (choice.financeResults.occupancy.high === null ? { kind: "open", low: choice.financeResults.occupancy.low } : { kind: "exact", low: choice.financeResults.occupancy.low, high: choice.financeResults.occupancy.high }) : monthlyCost(choice.assessment.candidate),
  })), workspace.requirements);
  const picked = choices.find((choice) => choice.candidateId === pick) ?? null;
  const cap = budgetCap(workspace.requirements);
  const evidenceText = (choice: BriefChoice, key: FactorKey) => {
    const item = find(choice, key);
    if (!item) return "Not checked";
    return `${factorLine(key, item, choice, workspace)} · ${factTag(item, evidenceIndex(choice, choice.assessment.candidate)).text}`;
  };
  const neighborhood = (choice: BriefChoice) => {
    const item = choice.assessment.assessments.find((a) => a.requirementId === "market.neighborhoodPreference");
    return item?.reasonCode === "neighborhood_member" ? `${item.sourceValue}, one of your picks` : item?.reasonCode === "neighborhood_other" ? `${item.sourceValue}, not one of your picks` : "Not available from a source";
  };
  const monthly = (choice: BriefChoice) => {
    const total = choice.financeResults.occupancy;
    if (!total) return "Can’t work out from the listing";
    if (total.high === null) return `${money(total.low)} base + unknown charges. Missing charges aren’t counted as $0.`;
    const label = rangeLabel(total, "/mo") ?? "";
    return cap === null ? label : `${label} (${total.high <= cap ? `${money(cap - total.high)} under` : `${money(total.high - cap)} over`} budget)`;
  };

  return (
    <main className="sx-page sx-wide">
      <Back onClick={onBack}>All places</Back>
      <h1 className="sx-title">Which one should you look at first?</h1>

      <div className="sx-summary">
        <span className="sx-summary-icon" aria-hidden="true"><Sprout size={18} /></span>
        <div className="sx-stack" style={{ gap: 6 }}>
          <span className="sx-strong">Sprout’s take</span>
          {take.map((line) => <p key={line}>{line}</p>)}
          <p className="sx-small sx-muted">Based only on checked facts. You make the call.</p>
        </div>
      </div>

      <div className="sx-compare">
        {choices.map((choice) => {
          const candidate = choice.assessment.candidate;
          const preferred = choice.candidateId === pick;
          return (
            <article key={choice.candidateId} className="sx-ccard" data-preferred={preferred}>
              <Thumb src={images.get(choice.candidateId) ?? null} alt={candidate.name} variant="wide" />
              <div className="sx-stack" style={{ gap: 4 }}>
                <h2 className="sx-title-sm" style={{ fontSize: 20 }}>{candidate.name}</h2>
                <span className="sx-small sx-muted">{placeSubtitle(candidate)}</span>
                <span><FitPill fit={fitForGroup(choice.assessment.group)} /></span>
              </div>
              {ROWS.map(({ key, label }) => {
                const original = find(choice, key) as RequirementAssessment | undefined;
                const item = original ? displayAssessment(original, choice, workspace.requirements) : undefined;
                const fit = item ? fitForAssessment(item) : "other";
                return (
                  <div key={key} className="sx-crow">
                    <Dot fit={fit} title={item ? assessmentLabel(item) : undefined} />
                    <div className="sx-crow-main">
                      <span className="sx-crow-label">{label}{differs(key) && <span className="sx-crow-diff">Different</span>}</span>
                      <span className="sx-strong">{item ? assessmentLabel(item) : FIT_LABEL[fit]}</span>
                      <span className="sx-small">{item ? factorLine(key, item, choice, workspace) : "Not checked"}</span>
                    </div>
                  </div>
                );
              })}
              <button type="button" className="sx-pick" aria-pressed={preferred} onClick={() => onPick(choice.candidateId)}>{preferred ? "★ Your pick" : "Pick this one"}</button>
              <button type="button" className="sx-btn sx-btn-text" onClick={() => onOpen(choice.candidateId)}>View details</button>
            </article>
          );
        })}
      </div>

      <div className="sx-row">
        <button type="button" className="sx-btn sx-btn-primary sx-btn-big" disabled={!picked} onClick={onWorkOut}>
          {picked ? `Work out costs for ${picked.assessment.candidate.name}` : "Pick one to continue"}
        </button>
        <AskButton onClick={onAsk} />
      </div>

      <Disclosure title="Full comparison" last>
        <div className="sx-scroll">
          <table className="sx-table">
            <thead><tr><th scope="col">Detail</th>{choices.map((c) => <th scope="col" key={c.candidateId}>{c.assessment.candidate.name}</th>)}</tr></thead>
            <tbody>
              <tr><th scope="row">Match order</th>{choices.map((c) => { const base = workspace.candidates.find((x) => x.candidate.id === c.candidateId); return <td key={c.candidateId}>{base ? `#${base.rank} of ${workspace.candidates.length}` : "—"}</td>; })}</tr>
              <tr><th scope="row">Must-haves</th>{choices.map((c) => <td key={c.candidateId}>{FIT_LABEL[fitForGroup(c.assessment.group)]}</td>)}</tr>
              <tr><th scope="row">Still unproven</th>{choices.map((c) => { const open = unresolvedMustHaves(c.assessment.assessments).map((k) => FACTOR_NAME[k]); return <td key={c.candidateId}>{open.length ? open.join(", ") : "Nothing"}</td>; })}</tr>
              <tr><th scope="row">Neighborhood</th>{choices.map((c) => <td key={c.candidateId}>{neighborhood(c)}</td>)}</tr>
              <tr><th scope="row">Monthly cost</th>{choices.map((c) => <td key={c.candidateId}>{monthly(c)}{c.financeInputs.occupancyEstimate && <Tag kind="estimate">Estimate</Tag>}</td>)}</tr>
              <tr><th scope="row">Size</th>{choices.map((c) => <td key={c.candidateId}>{c.assessment.candidate.floorAreaSqFt !== null ? `${c.assessment.candidate.floorAreaSqFt.toLocaleString("en-US")} sq ft` : "Not listed"}</td>)}</tr>
              <tr><th scope="row">Seats</th>{choices.map((c) => <td key={c.candidateId}>{evidenceText(c, "space")}</td>)}</tr>
              <tr><th scope="row">Kitchen evidence</th>{choices.map((c) => <td key={c.candidateId}>{evidenceText(c, "kitchen")}</td>)}</tr>
              <tr><th scope="row">Parking evidence</th>{choices.map((c) => <td key={c.candidateId}>{evidenceText(c, "parking")}</td>)}</tr>
              <tr><th scope="row">Money to open</th>{choices.map((c) => <td key={c.candidateId}>{c.financeResults.completeUpfront !== null ? money(c.financeResults.completeUpfront) : "Not worked out yet"}</td>)}</tr>
              <tr><th scope="row">Sales needed each month</th>{choices.map((c) => <td key={c.candidateId}>{rangeLabel(c.financeResults.requiredSales) ?? "Not worked out yet"}</td>)}</tr>
              <tr><th scope="row">Sources</th>{choices.map((c) => <td key={c.candidateId}>{[c.assessment.candidate.isDemo ? "Synthetic listing" : "CoStar listing", ...c.assessment.sources.observations.map((o) => o.label)].join(" · ")}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <p className="sx-small sx-muted">Every place uses the same needs (revision {workspace.profileRevisionNumber}). Cost answers never confirm a must-have.</p>
        <span><Tag kind="followup">{workspace.isSynthetic ? "Synthetic test listings" : "Dated listing snapshots"}</Tag></span>
      </Disclosure>
    </main>
  );
}
