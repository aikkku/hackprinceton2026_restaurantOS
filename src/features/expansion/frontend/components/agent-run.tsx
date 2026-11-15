"use client";

import {
  AlertTriangle,
  Bot,
  Building2,
  Check,
  ChevronRight,
  Circle,
  LoaderCircle,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RestaurantIntake } from "../../domain/intake.ts";
import {
  AGENT_STAGE_LABELS,
  agentStages,
  type AgentEvent,
  type AgentRunRecord,
  type AgentStage,
  type AgentStageStatus,
  type ExecutionMode,
} from "../../domain/agent.ts";
import type {
  AssessedCandidate,
} from "../../domain/matching.ts";
import type {
  FinanceArtifact,
  SummaryArtifact,
} from "../../domain/agent.ts";
import {
  cancelAgentRun,
  createAgentRun,
  getAgentRun,
  getAgentArtifact,
  loadAgentCapabilities,
  openAgentEventStream,
  type AgentCapabilities,
} from "../data/agent-client.ts";
import {
  AssessmentList,
  GROUP_LABELS,
  REQUIREMENT_LABELS,
  topAssessment,
} from "./run-search.tsx";
import "./expansion.css";

type StageState = AgentStageStatus | "running";

const INITIAL_STAGES: Record<AgentStage, StageState> = {
  readiness: "not_run",
  market: "not_run",
  site_scout: "not_run",
  space_inspector: "not_run",
  finance: "not_run",
};

function stageFromEvent(event: AgentEvent, stages: Record<AgentStage, StageState>): Record<AgentStage, StageState> {
  if (!event.stage || !(agentStages as readonly string[]).includes(event.stage)) return stages;
  const stage = event.stage as AgentStage;
  if (event.type === "stage.started") {
    return { ...stages, [stage]: "running" };
  }
  if (event.type === "stage.completed" && event.payload && typeof event.payload === "object" && "status" in event.payload) {
    const status = String(event.payload.status);
    return { ...stages, [stage]: status === "unavailable" || status === "failed" || status === "completed" ? (status as AgentStageStatus) : "completed" };
  }
  if (event.type === "unavailable") {
    return { ...stages, [stage]: "unavailable" };
  }
  if (event.type === "stage.incomplete") {
    return { ...stages, [stage]: "failed" };
  }
  return stages;
}

const MODE_LABELS: Record<ExecutionMode, string> = {
  live: "Deep Agents · live model",
  scripted: "Deep Agents · scripted test model",
};

// Every failure that leaves the deterministic search usable offers it explicitly;
// the fallback is labeled separately and never shown as a Deep Agents success.
const FALLBACK_CODES = new Set([
  "model_unavailable", "provider_not_configured", "worker_spawn_failed",
  "worker_exited", "worker_not_started", "interrupted", "stalled", "run_timeout", "model_or_framework_failed",
]);

export function AgentRunSection({
  profile,
  cityId,
  onUseDeterministic,
  onInvestigateRun,
}: {
  profile: { revisionId: string; revisionNumber: number; intake: RestaurantIntake };
  cityId: string;
  onUseDeterministic: () => void;
  onInvestigateRun?: (runId: string) => void;
}) {
  const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
  const [phase, setPhase] = useState<"idle" | "starting" | "running" | "done" | "failed">("idle");
  const [run, setRun] = useState<AgentRunRecord | null>(null);
  const [stages, setStages] = useState<Record<AgentStage, StageState>>(INITIAL_STAGES);
  const [mode, setMode] = useState<ExecutionMode>("live");
  const [errorMessage, setErrorMessage] = useState("");
  const [summary, setSummary] = useState<SummaryArtifact | null>(null);
  const [finance, setFinance] = useState<FinanceArtifact | null>(null);
  const [candidates, setCandidates] = useState<AssessedCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const streamRef = useRef<{ close: () => void; lastSeq: () => number } | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    const controller = new AbortController();
    void loadAgentCapabilities(controller.signal)
      .then((value) => {
        if (cancelled) return;
        setCapabilities(value);
        setMode(value.defaultMode);
      })
      .catch(() => {
        /* capabilities are optional; the run itself reports honest failures */
      });
    return () => {
      cancelled = true;
      mountedRef.current = false;
      controller.abort();
      streamRef.current?.close();
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const applyEvent = useCallback((event: AgentEvent) => {
    setStages((current) => stageFromEvent(event, current));
  }, []);

  const finish = useCallback(async (runId: string) => {
    try {
      for (;;) {
        const record = await getAgentRun(runId);
        if (!mountedRef.current) return;
        setRun(record);
        if (record.status === "completed" || record.status === "completed_with_gaps") {
          setPhase("done");
          const [summaryArtifact, candidatesArtifact, financeArtifact] = await Promise.all([
            getAgentArtifact(runId, "summary").catch(() => null),
            getAgentArtifact(runId, "candidates").catch(() => null),
            getAgentArtifact(runId, "finance").catch(() => null),
          ]);
          if (!mountedRef.current) return;
          setSummary(summaryArtifact as SummaryArtifact | null);
          setFinance(financeArtifact as FinanceArtifact | null);
          setCandidates(candidatesArtifact && typeof candidatesArtifact === "object" && "candidates" in candidatesArtifact
            ? (candidatesArtifact as { candidates: AssessedCandidate[] }).candidates
            : []);
          return;
        }
        if (record.status === "failed") {
          setPhase("failed");
          setErrorMessage(record.error?.message ?? "The agent run failed.");
          return;
        }
        if (record.status === "cancelled") {
          setPhase("failed");
          setErrorMessage("The agent run was cancelled.");
          return;
        }
        await new Promise((resolve) => {
          pollTimer.current = setTimeout(resolve, 4000);
        });
      }
    } catch (error) {
      if (!mountedRef.current) return;
      setPhase("failed");
      setErrorMessage(error instanceof Error ? error.message : "The agent run status could not be read.");
    }
  }, []);

  const start = () => {
    setErrorMessage("");
    setSummary(null);
    setFinance(null);
    setCandidates([]);
    setSelectedId(null);
    setStages(INITIAL_STAGES);
    setPhase("starting");
    const runId = crypto.randomUUID();
    void createAgentRun({
      runId,
      cityId,
      intake: profile.intake,
      revisionId: profile.revisionId,
      revisionNumber: profile.revisionNumber,
      executionMode: mode,
    }).then((created) => {
      if (!mountedRef.current) return;
      setRun(created);
      setPhase("running");
      const stream = openAgentEventStream(runId, {
        afterSeq: 0,
        onEvent: applyEvent,
        onDone: () => {
          void finish(runId);
        },
        onDisconnect: () => {
          /* the poll loop keeps the state consistent across reconnects */
        },
      });
      streamRef.current = stream;
      pollTimer.current = setTimeout(() => {
        void finish(runId);
      }, 4000);
    }).catch((error: unknown) => {
      if (!mountedRef.current) return;
      setPhase("failed");
      setErrorMessage(error instanceof Error ? error.message : "The agent run could not be started.");
    });
  };

  const cancel = () => {
    if (!run) return;
    void cancelAgentRun(run.runId).catch(() => {
      /* terminal state will surface through the poll */
    });
  };

  const reset = () => {
    streamRef.current?.close();
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setRun(null);
    setPhase("idle");
    setStages(INITIAL_STAGES);
    setErrorMessage("");
    setSummary(null);
    setFinance(null);
    setCandidates([]);
    setSelectedId(null);
  };

  const groupCounts = useMemo(() => ({
    meets_assessed_requirements: candidates.filter((item) => item.group === "meets_assessed_requirements").length,
    needs_verification: candidates.filter((item) => item.group === "needs_verification").length,
    does_not_meet: candidates.filter((item) => item.group === "does_not_meet").length,
  }), [candidates]);

  const selected = candidates.find((item) => item.candidate.id === selectedId) ?? null;

  if (phase === "idle") {
    return (
      <section className="agent-section" aria-label="Agent-assisted scouting">
        <div className="run-cta">
          <span className="round-icon">
            <Bot size={22} />
          </span>
          <div>
            <h2>Agent-assisted scouting</h2>
            <p>
              A Python Deep Agents planner delegates to five specialists
              (readiness, market, site scout, space inspector, finance) that
              call the same deterministic search and finance tools. Live stage
              progress is streamed from the worker; matching and financial
              arithmetic always run in TypeScript.
            </p>
            {capabilities && !capabilities.workerReady && (
              <p className="small-note" role="status">
                The agent worker environment is missing on this computer
                {capabilities.reason ? `: ${capabilities.reason}` : "."} The
                deterministic search below keeps working.
              </p>
            )}
          </div>
          <div className="agent-cta-stack">
            <label className="agent-mode-label">
              Execution mode
              <select
                aria-label="Agent execution mode"
                value={mode}
                onChange={(event) => setMode(event.target.value as ExecutionMode)}
              >
                <option value="live">Live model</option>
                <option value="scripted">Scripted test model</option>
              </select>
            </label>
            <button
              className="primary"
              onClick={start}
              disabled={capabilities !== null && !capabilities.workerReady}
            >
              <Bot size={15} /> Start agent-assisted scouting
            </button>
          </div>
        </div>
        <p className="small-note">
          Deterministic search below stays available and is labeled separately;
          agent runs never replace its results.
        </p>
      </section>
    );
  }

  if (phase === "starting" || phase === "running") {
    return (
      <section className="agent-section" aria-label="Agent-assisted scouting running">
        <div className="agent-progress" role="status">
          <div className="agent-progress-head">
            <LoaderCircle size={18} className="spin" />
            <strong>
              {phase === "starting" ? "Starting the Deep Agents planner…" : "Specialists are working through the run…"}
            </strong>
            {run && <span className={`mode-badge mode-${run.executionMode}`}>{MODE_LABELS[run.executionMode]}</span>}
          </div>
          <ol className="agent-stages" aria-label="Specialist stages">
            {agentStages.map((stage) => (
              <li key={stage} className={`stage-row stage-${stages[stage]}`}>
                <span className="stage-dot" aria-hidden="true">
                  {stages[stage] === "running" ? <LoaderCircle size={12} className="spin" /> : <Circle size={10} />}
                </span>
                <span className="stage-name">{AGENT_STAGE_LABELS[stage]}</span>
                <span className={`status-chip ${stages[stage] === "completed" ? "pass" : stages[stage] === "failed" ? "fail" : stages[stage] === "unavailable" ? "unknown" : ""}`}>
                  {stages[stage].replaceAll("_", " ")}
                </span>
              </li>
            ))}
          </ol>
          {phase === "running" && (
            <button className="secondary" onClick={cancel}>
              <X size={14} /> Cancel agent run
            </button>
          )}
        </div>
      </section>
    );
  }

  if (phase === "failed") {
    return (
      <section className="agent-section" aria-label="Agent-assisted scouting failed">
        <div role="alert" className="warning">
          <AlertTriangle size={15} /> {errorMessage}
        </div>
        {run && FALLBACK_CODES.has(run.error?.code ?? "") && (
          <div className="run-actions">
            <button className="primary" onClick={onUseDeterministic}>
              Continue with deterministic search
            </button>
          </div>
        )}
        <div className="run-actions">
          <button className="secondary" onClick={reset}>
            Try another agent run
          </button>
        </div>
      </section>
    );
  }

  // phase === "done"
  return (
    <section className="agent-section" aria-label="Agent-assisted scouting results">
      <div className="section-heading">
        <div>
          <p className="eyebrow">AGENT-ASSISTED SCOUTING</p>
          <h2>Deep Agents run results</h2>
        </div>
        {run && (
          <span className={`mode-badge mode-${run.executionMode}`}>
            {MODE_LABELS[run.executionMode]}
          </span>
        )}
      </div>

      {summary && (
        <div className="agent-summary">
          <p className="small-note">
            Grounded explanation composed by the planner; every candidate ID,
            count and number below comes from validated tool outputs.
          </p>
          <p className="agent-summary-text">{summary.summaryText}</p>
          <ol className="agent-stages" aria-label="Specialist stage summaries">
            {summary.stageReports.map((report) => (
              <li key={report.stage} className={`stage-row stage-${report.status}`}>
                <span className="stage-dot" aria-hidden="true"><Circle size={10} /></span>
                <span className="stage-name">{AGENT_STAGE_LABELS[report.stage]}</span>
                <span className={`status-chip ${report.status === "completed" ? "pass" : report.status === "failed" ? "fail" : "unknown"}`}>
                  {report.status.replaceAll("_", " ")}
                </span>
                <p className="stage-digest">{report.digest}</p>
              </li>
            ))}
          </ol>
          {summary.missingEvidence.length > 0 && (
            <div className="agent-missing" role="status">
              <strong>Missing evidence (kept unavailable):</strong>
              <ul>
                {summary.missingEvidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.followUps.length > 0 && (
            <div className="agent-missing">
              <strong>Follow-ups for the owner:</strong>
              <ul>
                {summary.followUps.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.assumptions.length > 0 && (
            <div className="agent-missing">
              <strong>Assumptions (labeled):</strong>
              <ul>
                {summary.assumptions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {finance && (
        <div className="agent-finance" aria-label="Finance results">
          <p className="eyebrow">FINANCE · DETERMINISTIC TOOLS</p>
          <p className="small-note">
            Values are tool outputs, never model arithmetic.
          </p>
          {finance.requiredSales ? (
            finance.requiredSales.status === "available" ? (
              <p>
                Required monthly sales:{" "}
                <strong>${finance.requiredSales.requiredSalesMonthly?.toLocaleString("en-US")}</strong>{" "}
                <span className="small-note">
                  (fixed costs ${finance.requiredSales.fixedCostsMonthly?.toLocaleString("en-US")}, margin{" "}
                  {finance.requiredSales.contributionMargin})
                </span>
              </p>
            ) : (
              <p>
                Required sales: <strong>unavailable</strong>{" "}
                <span className="small-note">{finance.requiredSales.reason}</span>
              </p>
            )
          ) : (
            <p>Required sales were not evaluated.</p>
          )}
          {finance.occupancy.length > 0 && (
            <p className="small-note">
              Monthly-occupancy ranges were evaluated for {finance.occupancy.length} top
              candidate{finance.occupancy.length === 1 ? "" : "s"}; unavailable ranges stay unknown.
            </p>
          )}
        </div>
      )}

      <div className="agent-candidate-summary">
        <span className="summary-chip meets">
          <Check size={12} /> {groupCounts.meets_assessed_requirements} meet assessed requirements
        </span>
        <span className="summary-chip verify">
          <AlertTriangle size={12} /> {groupCounts.needs_verification} need verification
        </span>
        <span className="summary-chip reject">
          <X size={12} /> {groupCounts.does_not_meet} do not meet
        </span>
      </div>

      {candidates.length > 0 && (
        <div className="candidate-cards">
          {candidates.slice(0, 20).map((assessed) => {
            const top = topAssessment(assessed);
            return (
              <button
                key={assessed.candidate.id}
                className={`candidate-card ${selectedId === assessed.candidate.id ? "selected" : ""}`}
                onClick={() => setSelectedId(assessed.candidate.id)}
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
                    : "Area unknown"}
                </p>
                <p className="candidate-reason">
                  {top ? `${REQUIREMENT_LABELS[top.requirementId] ?? top.requirementId}: ${top.reason}` : "No assessment recorded"}
                </p>
                <span className="card-cta">Inspect requirements <ChevronRight size={13} /></span>
              </button>
            );
          })}
        </div>
      )}
      {selected && (
        <div className="agent-inspector">
          <div className="section-heading">
            <div>
              <p className="eyebrow">SPACE INSPECTOR</p>
              <h3>{selected.candidate.name}</h3>
            </div>
          </div>
          <AssessmentList assessed={selected} />
        </div>
      )}
      {candidates.length === 0 && (
        <div className="empty-state">
          <Building2 size={25} />
          <h3>No grounded candidates in this run.</h3>
          <p>
            Zero candidates is a truthful result; the site scout never
            fabricates matches.
          </p>
        </div>
      )}
      <div className="run-actions">
        {run && onInvestigateRun && <button className="primary" onClick={() => onInvestigateRun(run.runId)}>Investigate this run</button>}
        <button className="secondary" onClick={reset}>
          Start another agent run
        </button>
        <button className="secondary" onClick={onUseDeterministic}>
          Use deterministic search
        </button>
      </div>
    </section>
  );
}
