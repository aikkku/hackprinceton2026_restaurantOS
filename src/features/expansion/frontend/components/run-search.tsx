"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronRight,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import type {
  AssessedCandidate,
  CandidateGroup,
  RequirementAssessment,
} from "../../domain/matching.ts";
import type { ExcludedCandidate, RunRecord } from "../../domain/runs.ts";
import "./expansion.css";

export const REQUIREMENT_LABELS: Record<string, string> = {
  "market.target": "Target market",
  "market.neighborhoodPreference": "Neighborhood preference",
  "occupancy.monthlyLimit": "Total monthly occupancy limit",
  "occupancy.scope": "Occupancy limit scope",
  "funds.totalAvailable": "Total available funds",
  "funds.emergencyReserve": "Emergency reserve",
  "space.seats": "Preferred seats",
  "space.areaSqFt": "Space area",
  "space.existingKitchen": "Existing kitchen",
  "space.customerParking": "Customer parking",
  "space.parkingSpacesMinimum": "Parking spaces minimum",
  "space.ventilation": "Ventilation needs",
  "timeline.openingDate": "Opening date",
  "finance.baseline": "Financial baseline",
};

export const GROUP_LABELS: Record<CandidateGroup, string> = {
  meets_assessed_requirements: "Meets assessed requirements",
  needs_verification: "Needs verification",
  does_not_meet: "Does not meet",
};

const PAGE_SIZE = 20;

export function topAssessment(assessed: AssessedCandidate): RequirementAssessment | null {
  const order = (a: RequirementAssessment) =>
    a.status === "fail" ? 0 : a.status === "unknown" ? 1 : 2;
  const hard = assessed.assessments.filter((a) =>
    ["occupancy.monthlyLimit", "space.existingKitchen", "space.customerParking"].includes(a.requirementId),
  );
  return [...hard].sort((a, b) => order(a) - order(b))[0] ?? null;
}

export function AssessmentList({ assessed }: { assessed: AssessedCandidate }) {
  return (
    <div className="assessment-list" aria-label="Requirement assessment">
      <p className="eyebrow">PROFILE ASSESSMENT · DETERMINISTIC</p>
      {assessed.assessments.map((assessment) => (
        <div key={assessment.requirementId} className={`assessment-row ${assessment.status}`}>
          <div>
            <span>{REQUIREMENT_LABELS[assessment.requirementId] ?? assessment.requirementId}</span>
            <strong className={`status-chip ${assessment.status}`}>
              {assessment.status.replaceAll("_", " ")}
            </strong>
          </div>
          <p>{assessment.reason}</p>
          <small>
            Source value: {assessment.sourceValue}
            {assessment.evidenceIds.length ? ` · evidence ${assessment.evidenceIds.join(", ")}` : ""}
          </small>
        </div>
      ))}
      <p className="small-note">
        Group: {GROUP_LABELS[assessed.group]}. {assessed.orderingNotes.join(" · ")}.
      </p>
    </div>
  );
}

export function RunSearch({
  run,
  phase,
  errorMessage,
  candidates,
  excluded,
  excludedTruncated,
  group,
  onGroupChange,
  page,
  onPageChange,
  onStart,
  onCancel,
  onRetry,
  onSelect,
  selectedId,
}: {
  run: RunRecord | null;
  phase: "idle" | "starting" | "running" | "done" | "error";
  errorMessage: string;
  candidates: AssessedCandidate[];
  excluded: ExcludedCandidate[];
  excludedTruncated: boolean;
  group: CandidateGroup | null;
  onGroupChange: (group: CandidateGroup | null) => void;
  page: number;
  onPageChange: (page: number) => void;
  onStart: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onSelect: (candidateId: string) => void;
  selectedId: string | null;
}) {
  if (phase === "idle") {
    return (
      <section className="run-section" aria-label="Profile search">
        <div className="run-cta">
          <span className="round-icon">
            <Search size={22} />
          </span>
          <div>
            <h2>Search the full city with your profile</h2>
            <p>
              Evaluates every actively marketed offered space in the Houston
              snapshot against your saved requirements. Runs server-side; the
              map and page size only affect what you see, never the result.
            </p>
          </div>
          <button className="primary" onClick={onStart}>
            <Search size={15} /> Start profile search
          </button>
        </div>
      </section>
    );
  }

  if (phase === "starting" || phase === "running") {
    return (
      <section className="run-section" aria-label="Profile search running">
        <div className="run-progress" role="status">
          <LoaderCircle size={18} className="spin" />
          <div>
            <strong>
              {phase === "starting" ? "Preparing the citywide search…" : "Searching the full Houston snapshot…"}
            </strong>
            <p>
              Examining offered spaces server-side, in batches. This evaluates
              the whole snapshot, not just the visible map page.
            </p>
          </div>
          <button className="secondary" onClick={onCancel}>
            <X size={14} /> Cancel search
          </button>
        </div>
      </section>
    );
  }

  if (phase === "error") {
    return (
      <section className="run-section" aria-label="Profile search error">
        <div role="alert" className="warning">
          <AlertTriangle size={15} /> {errorMessage || "The profile search failed."}
        </div>
        <div className="run-actions">
          <button className="secondary" onClick={onRetry}>
            Retry search
          </button>
        </div>
      </section>
    );
  }

  // phase === "done"
  const counts = run?.counts;
  const total = candidates.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const visible = candidates.slice(start, start + PAGE_SIZE);
  const groupCounts = {
    meets_assessed_requirements: candidates.filter((c) => c.group === "meets_assessed_requirements").length,
    needs_verification: candidates.filter((c) => c.group === "needs_verification").length,
    does_not_meet: candidates.filter((c) => c.group === "does_not_meet").length,
  } as const;

  return (
    <section className="run-section" aria-label="Profile search results">
      <div className="section-heading">
        <div>
          <p className="eyebrow">PROFILE-DRIVEN SEARCH</p>
          <h2>Full-city matches</h2>
        </div>
        <span>
          {counts ? `${counts.examined} offered spaces examined · ${counts.included} candidates` : "—"}
        </span>
      </div>
      <div className="run-summary">
        <span className="summary-chip meets">
          <Check size={12} /> {counts?.meets ?? 0} meet assessed requirements
        </span>
        <span className="summary-chip verify">
          <AlertTriangle size={12} /> {counts?.needsVerification ?? 0} need verification
        </span>
        <span className="summary-chip reject">
          <X size={12} /> {counts?.doesNotMeet ?? 0} do not meet
        </span>
        <span className="summary-chip">
          {counts?.offMarket ?? 0} off-market · {counts?.incompatibleUse ?? 0} incompatible use · {counts?.unknownMarketingStatus ?? 0} unknown status excluded
        </span>
      </div>
      {counts?.scanCapped && (
        <div role="status" className="warning">
          The scan reached its cap before every record was examined; counts are
          partial and labeled as such.
        </div>
      )}
      {run?.status === "completed_with_gaps" && !counts?.scanCapped && (
        <div role="status" className="warning">
          The search completed with gaps; some records were not fully examined.
        </div>
      )}
      {run?.status === "cancelled" && (
        <div role="status" className="warning">
          This search was cancelled. The results below cover only the records
          examined before cancellation.
        </div>
      )}
      {counts && counts.included > 0 && counts.meets === 0 && counts.needsVerification > 0 && (
        <div className="warning">
          No space fully verifies all hard requirements from the snapshot
          alone. {counts.needsVerification} candidates need verification
          (kitchen, parking or total occupancy evidence). The profile remains
          fictional; source records remain dated snapshots.
        </div>
      )}
      {counts && counts.included === 0 && (
        <div className="empty-state">
          <Building2 size={25} />
          <h3>No actively marketed offered spaces in this snapshot.</h3>
          <p>
            Active marketing in the snapshot does not verify current vacancy;
            zero candidates is a truthful result, never a fabricated one.
          </p>
        </div>
      )}
      <div className="run-tabs" role="tablist" aria-label="Candidate groups">
        <button role="tab" aria-selected={group === null} className={group === null ? "active" : ""} onClick={() => onGroupChange(null)}>
          All ({total})
        </button>
        {(Object.keys(groupCounts) as CandidateGroup[]).map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={group === key}
            className={group === key ? "active" : ""}
            onClick={() => onGroupChange(key)}
          >
            {GROUP_LABELS[key]} ({groupCounts[key]})
          </button>
        ))}
      </div>
      {total > 0 && (
        <div className="run-pagination">
          <span>
            Showing {total === 0 ? 0 : start + 1}–{Math.min(start + PAGE_SIZE, total)} of {total}
          </span>
          <div>
            <button className="secondary" disabled={safePage === 0} onClick={() => onPageChange(safePage - 1)}>
              <ArrowLeft size={13} /> Previous
            </button>
            <button className="secondary" disabled={safePage >= pageCount - 1} onClick={() => onPageChange(safePage + 1)}>
              Next <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}
      <div className="candidate-cards">
        {visible.map((assessed) => {
          const top = topAssessment(assessed);
          return (
            <button
              key={assessed.candidate.id}
              className={`candidate-card ${selectedId === assessed.candidate.id ? "selected" : ""}`}
              onClick={() => onSelect(assessed.candidate.id)}
            >
              <div className="candidate-card-top">
                <span className={`tiny-badge group-${assessed.group === "meets_assessed_requirements" ? "meets" : assessed.group === "needs_verification" ? "verify" : "reject"}`}>
                  {GROUP_LABELS[assessed.group]}
                </span>
                <ChevronRight size={15} />
              </div>
              <Building2 size={26} strokeWidth={1.3} />
              <h3>{assessed.candidate.name}</h3>
              <p className="candidate-meta">
                {assessed.candidate.suite ? `Suite ${assessed.candidate.suite} · ` : ""}
                {assessed.candidate.floorAreaSqFt !== null
                  ? `${assessed.candidate.floorAreaSqFt.toLocaleString("en-US")} sq ft`
                  : assessed.candidate.sizeRangeSqFt.minimum !== null || assessed.candidate.sizeRangeSqFt.maximum !== null
                    ? `area ${assessed.candidate.sizeRangeSqFt.minimum ?? "?"}–${assessed.candidate.sizeRangeSqFt.maximum ?? "?"} sq ft`
                    : "Area unknown"}
              </p>
              <p className="candidate-reason">
                {top ? `${REQUIREMENT_LABELS[top.requirementId] ?? top.requirementId}: ${top.reason}` : "No assessment recorded"}
              </p>
              <span className="card-cta">
                Inspect requirements <ChevronRight size={13} />
              </span>
            </button>
          );
        })}
      </div>
      {total > PAGE_SIZE && (
        <div className="run-pagination">
          <span>
            Page {safePage + 1} of {pageCount}
          </span>
          <div>
            <button className="secondary" disabled={safePage === 0} onClick={() => onPageChange(safePage - 1)}>
              <ArrowLeft size={13} /> Previous
            </button>
            <button className="secondary" disabled={safePage >= pageCount - 1} onClick={() => onPageChange(safePage + 1)}>
              Next <ArrowRight size={13} />
            </button>
          </div>
        </div>
      )}
      {excluded.length > 0 && (
        <details className="area-list excluded-list">
          <summary>
            <X size={15} /> Excluded records and reasons{" "}
            <span>{counts?.excluded ?? excluded.length}</span>
          </summary>
          <p className="small-note">
            Off-market or unknown-status records and explicit incompatible
            suite uses are excluded from candidates and kept here with their
            reasons. Active snapshot marketing does not verify current
            vacancy.
          </p>
          <div className="excluded-rows">
            {excluded.map((item) => (
              <div key={item.id}>
                <span className={`tiny-badge reason-${item.reasonCode === "incompatible_space_use" ? "use" : "market"}`}>
                  {item.reasonCode.replaceAll("_", " ")}
                </span>
                <strong>{item.name}</strong>
                <p>{item.reason}</p>
              </div>
            ))}
          </div>
          {excludedTruncated && (
            <p className="small-note">
              The excluded list is truncated for display; the run stores every
              exclusion with its reason.
            </p>
          )}
        </details>
      )}
      <p className="source-line">
        Source: CoStar local snapshot · dataset {run?.datasetId ?? "unknown"} ·
        dataset date {run?.datasetDate ?? "not supplied"} · searched{" "}
        {run?.searchedAt ? new Date(run.searchedAt).toLocaleString() : "—"}
      </p>
      <div className="run-actions">
        <button className="secondary" onClick={onRetry}>
          <Search size={14} /> New search
        </button>
      </div>
    </section>
  );
}
