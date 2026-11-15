"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { agentStages, type AgentEvent, type AgentRunRecord, type AgentStage, type AgentStageStatus, type SearchArtifact, type SummaryArtifact } from "../../domain/agent.ts";
import type { RestaurantIntake } from "../../domain/intake.ts";
import { cancelAgentRun, createAgentRun, getAgentArtifact, getAgentRun, loadAgentCapabilities, openAgentEventStream } from "../data/agent-client.ts";
import { LocalDataError, cancelProfileRun, createProfileRun, getProfileRun, loadMarkets } from "../data/local-market.ts";
import { Back, Disclosure } from "./ui.tsx";

type StageState = AgentStageStatus | "running";
const INITIAL: Record<AgentStage, StageState> = { readiness: "not_run", market: "not_run", site_scout: "not_run", space_inspector: "not_run", finance: "not_run" };

// Failures that leave the deterministic search usable; it is offered and labeled separately.
const FALLBACK_CODES = new Set(["model_unavailable", "provider_not_configured", "worker_spawn_failed", "worker_exited", "worker_not_started", "interrupted", "stalled", "run_timeout", "model_or_framework_failed"]);

const SPECIALISTS: Record<AgentStage, { name: string; role: string; uses: string }> = {
  readiness: { name: "Restaurant readiness", role: "Checks your needs are complete", uses: "Your restaurant profile" },
  market: { name: "Market analyst", role: "Looks at the market data we have", uses: "CoStar market snapshot" },
  site_scout: { name: "Site scout", role: "Finds spaces for lease", uses: "CoStar property listings" },
  space_inspector: { name: "Space inspector", role: "Checks kitchens, parking and seats", uses: "Listing details, Matterport scans and Vexcel aerial photos when available" },
  finance: { name: "Finance specialist", role: "Works out monthly costs", uses: "Listings and your budget" },
};
const STAGE_STATUS_LABEL: Record<StageState, string> = { completed: "Finished", unavailable: "Missing information", failed: "Couldn’t finish", running: "Working", not_run: "Waiting" };

function applyEvent(event: AgentEvent, stages: Record<AgentStage, StageState>): Record<AgentStage, StageState> {
  if (!event.stage || !(agentStages as readonly string[]).includes(event.stage)) return stages;
  const stage = event.stage as AgentStage;
  if (event.type === "stage.started") return { ...stages, [stage]: "running" };
  if (event.type === "stage.completed" && event.payload && "status" in event.payload) {
    const status = String(event.payload.status);
    return { ...stages, [stage]: status === "unavailable" || status === "failed" ? status : "completed" };
  }
  if (event.type === "unavailable") return { ...stages, [stage]: "unavailable" };
  if (event.type === "stage.incomplete") return { ...stages, [stage]: "failed" };
  return stages;
}

type UserStep = { title: string; state: "done" | "problem" | "working" | "next"; detail: string };

function userSteps(stages: Record<AgentStage, StageState>, done: boolean, included: number | null): UserStep[] {
  const view = (statuses: StageState[], labels: { done: string; unavailable: string }): Omit<UserStep, "title"> => {
    if (statuses.some((s) => s === "failed")) return { state: "problem", detail: "Couldn’t finish" };
    if (statuses.some((s) => s === "running")) return { state: "working", detail: "Working on it…" };
    if (statuses.every((s) => s === "completed")) return { state: "done", detail: labels.done };
    if (statuses.every((s) => s === "completed" || s === "unavailable")) return { state: "problem", detail: labels.unavailable };
    if (statuses.some((s) => s !== "not_run")) return { state: "working", detail: "Working on it…" };
    return { state: done ? "problem" : "next", detail: done ? "Didn’t run" : "Up next" };
  };
  return [
    { title: "Finding properties", ...view([stages.readiness, stages.market, stages.site_scout], { done: included === null ? "Done" : `${included} ${included === 1 ? "place" : "places"} can fit a restaurant`, unavailable: "Partly done" }) },
    { title: "Checking buildings and parking", ...view([stages.space_inspector], { done: "Done", unavailable: "Partly done" }) },
    { title: "Comparing costs", ...view([stages.finance], { done: "Done", unavailable: "We’ll ask about your opening costs later" }) },
  ];
}

const STEP_ICON = { done: "✓", problem: "!", working: "", next: "" };

export function SearchProgress({ profile, cityId, onSeeLocations, onBack }: {
  profile: { revisionId: string; revisionNumber: number; intake: RestaurantIntake };
  cityId: string;
  onSeeLocations: (source: "agent" | "deterministic", runId: string) => void;
  onBack: () => void;
}) {
  const [phase, setPhase] = useState<"starting" | "running" | "done" | "failed" | "fallback">("starting");
  const [stages, setStages] = useState(INITIAL);
  const [run, setRun] = useState<AgentRunRecord | null>(null);
  const [summary, setSummary] = useState<SummaryArtifact | null>(null);
  const [search, setSearch] = useState<SearchArtifact | null>(null);
  const [error, setError] = useState<{ message: string; fallback: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const stream = useRef<{ close: () => void } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackRun = useRef<string | null>(null);
  // The run is bound to the profile revision it started with; later parent
  // re-renders must not restart it.
  const request = useRef({ profile, cityId });

  const stopWatching = () => { stream.current?.close(); if (timer.current) clearTimeout(timer.current); };

  const finish = useCallback(async (runId: string) => {
    try {
      for (;;) {
        const record = await getAgentRun(runId);
        if (!mounted.current) return;
        setRun(record);
        if (record.status === "completed" || record.status === "completed_with_gaps") {
          setStages(record.stages);
          const [summaryArtifact, searchArtifact] = await Promise.all([
            getAgentArtifact(runId, "summary").catch(() => null),
            getAgentArtifact(runId, "candidates").catch(() => null),
          ]);
          if (!mounted.current) return;
          setSummary(summaryArtifact as SummaryArtifact | null);
          setSearch(searchArtifact as SearchArtifact | null);
          setPhase("done");
          stopWatching();
          return;
        }
        if (record.status === "failed" || record.status === "cancelled") {
          setStages(record.stages);
          setError({ message: record.status === "cancelled" ? "You stopped this search." : record.error?.message ?? "The search couldn’t finish.", fallback: record.status === "failed" && FALLBACK_CODES.has(record.error?.code ?? "") });
          setPhase("failed");
          stopWatching();
          return;
        }
        await new Promise((resolve) => { timer.current = setTimeout(resolve, 2500); });
      }
    } catch (failure) {
      if (!mounted.current) return;
      setError({ message: failure instanceof Error ? failure.message : "We lost track of the search.", fallback: false });
      setPhase("failed");
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void (async () => {
      // Without a property dataset every search fails at the first listing
      // lookup, so say that plainly instead of reporting a generic agent failure.
      const markets = await loadMarkets(controller.signal).then(() => null, (failure: unknown) => failure);
      if (controller.signal.aborted) return;
      if (markets instanceof LocalDataError) {
        setError({
          message: markets.code === "not_configured"
            ? "Property data isn’t set up on this server, so there’s nothing to search yet. Set EXPANSION_DB_PATH to your imported dataset (for example src/features/expansion/data/data/expansion.sqlite) and try again."
            : `The property data couldn’t be read: ${markets.message}`,
          fallback: false,
        });
        setPhase("failed");
        return;
      }
      const capabilities = await loadAgentCapabilities(controller.signal).catch(() => null);
      if (controller.signal.aborted) return;
      if (capabilities && !capabilities.workerReady) {
        setError({ message: `Sprout’s specialists aren’t set up on this computer${capabilities.reason ? ` (${capabilities.reason})` : ""}.`, fallback: true });
        setPhase("failed");
        return;
      }
      const runId = crypto.randomUUID();
      const { profile: owner, cityId: city } = request.current;
      try {
        const created = await createAgentRun({ runId, cityId: city, intake: owner.intake, revisionId: owner.revisionId, revisionNumber: owner.revisionNumber, executionMode: capabilities?.defaultMode ?? "live" }, controller.signal);
        if (controller.signal.aborted) return;
        setRun(created);
        setPhase("running");
        // The server may reuse an active search after a retry or double submission.
        const activeRunId = created.runId;
        stream.current = openAgentEventStream(activeRunId, {
          afterSeq: 0,
          onEvent: (event) => setStages((current) => applyEvent(event, current)),
          onDone: () => { void finish(activeRunId); },
          onDisconnect: () => { /* the status poll keeps state consistent */ },
        });
        timer.current = setTimeout(() => { void finish(activeRunId); }, 3000);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError({ message: failure instanceof Error ? failure.message : "The search couldn’t start.", fallback: false });
        setPhase("failed");
      }
    })();
    return () => { mounted.current = false; controller.abort(); stopWatching(); };
  }, [attempt, finish]);

  const retry = () => { stopWatching(); setStages(INITIAL); setRun(null); setSummary(null); setSearch(null); setError(null); setPhase("starting"); setAttempt((value) => value + 1); };

  const startFallback = async () => {
    setPhase("fallback");
    setError(null);
    const runId = crypto.randomUUID();
    fallbackRun.current = runId;
    const { profile: owner, cityId: city } = request.current;
    try {
      await createProfileRun({ runId, cityId: city, intake: owner.intake, revisionId: owner.revisionId, revisionNumber: owner.revisionNumber });
      for (;;) {
        const record = await getProfileRun(runId);
        if (!mounted.current || fallbackRun.current !== runId) return;
        if (record.status === "completed" || record.status === "completed_with_gaps") { onSeeLocations("deterministic", runId); return; }
        if (record.status === "failed" || record.status === "cancelled") throw new Error(record.error?.message ?? "The basic search couldn’t finish.");
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } catch (failure) {
      if (!mounted.current) return;
      setError({ message: failure instanceof Error ? failure.message : "The basic search couldn’t finish.", fallback: false });
      setPhase("failed");
    }
  };

  const included = search ? search.candidates.length : null;
  const steps = userSteps(stages, phase === "done", included);
  const inspectorTrouble = stages.space_inspector === "failed" || stages.space_inspector === "unavailable";
  const reports = new Map((summary?.stageReports ?? []).map((report) => [report.stage, report]));

  if (phase === "fallback") {
    return (
      <main className="sx-page">
        <Back onClick={onBack}>Your needs</Back>
        <div className="sx-stack">
          <h1 className="sx-title">Searching listings without the specialists…</h1>
          <p className="sx-lead">This basic search checks every listing against your needs. It can’t inspect buildings, and saving a plan needs a full search.</p>
        </div>
        <ol className="sx-steps"><li className="sx-step sx-step-working"><span className="sx-step-icon" aria-hidden="true" /><div><p className="sx-step-title">Finding properties</p><p className="sx-small sx-muted">Working on it…</p></div></li></ol>
        <div><button type="button" className="sx-btn sx-btn-text" onClick={() => { const id = fallbackRun.current; fallbackRun.current = null; if (id) void cancelProfileRun(id).catch(() => undefined); onBack(); }}>Stop searching</button></div>
      </main>
    );
  }

  return (
    <main className="sx-page">
      <Back onClick={onBack}>Your needs</Back>
      <div className="sx-stack">
        <h1 className="sx-title" aria-live="polite">
          {phase === "failed" ? "The search didn’t finish." : phase === "done" ? included === 0 ? "We didn’t find places that match yet." : `We found ${included ?? 0} ${included === 1 ? "place" : "places"} to look at.` : "Sprout is looking for locations that match your needs."}
        </h1>
        {phase !== "done" && phase !== "failed" && <p className="sx-lead">This takes about a minute. You can look at places as soon as we find them.</p>}
        {phase === "done" && included === 0 && <p className="sx-lead">No listing in the property data fits a restaurant right now. Try changing your needs.</p>}
      </div>

      <ol className="sx-steps" aria-label="Search progress">
        {steps.map((step, index) => (
          <li key={step.title} className={`sx-step sx-step-${step.state}`}>
            <span className="sx-step-icon" aria-hidden="true">{STEP_ICON[step.state] || index + 1}</span>
            <div><p className="sx-step-title">{step.title}</p><p className="sx-small sx-muted">{step.detail}</p></div>
          </li>
        ))}
      </ol>

      {phase === "done" && inspectorTrouble && (
        <div className="sx-notice" role="status"><span aria-hidden="true">!</span><p>We couldn’t check every interior and parking lot. The listings are fine, so you can keep going. Open a place to see what still needs checking.</p></div>
      )}
      {error && (
        <div className="sx-notice sx-notice-bad" role="alert">
          <div className="sx-stack">
            <p>{error.message}</p>
            <div className="sx-row">
              <button type="button" className="sx-btn sx-btn-secondary" onClick={retry}>Try again</button>
              {error.fallback && <button type="button" className="sx-btn sx-btn-primary" onClick={() => void startFallback()}>Search without the specialists</button>}
            </div>
            {error.fallback && <p className="sx-small">The basic search uses the same listing checks, but can’t inspect buildings or keep a plan.</p>}
          </div>
        </div>
      )}

      <div className="sx-row">
        <button type="button" className="sx-btn sx-btn-primary sx-btn-big" disabled={phase !== "done" || !run || !included} onClick={() => run && onSeeLocations("agent", run.runId)}>See locations</button>
        {phase === "running" && run && <button type="button" className="sx-btn sx-btn-text" onClick={() => void cancelAgentRun(run.runId).catch(() => undefined)}>Stop searching</button>}
        {phase === "done" && included === 0 && <button type="button" className="sx-btn sx-btn-secondary" onClick={onBack}>Change your needs</button>}
      </div>

      <Disclosure title="View details" hint="What each specialist did" last>
        {agentStages.map((stage) => {
          const info = SPECIALISTS[stage];
          const report = reports.get(stage);
          return (
            <div key={stage} className="sx-agent">
              <div className="sx-row" style={{ justifyContent: "space-between" }}>
                <span className="sx-strong">{info.name}</span>
                <span className="sx-small sx-muted">{STAGE_STATUS_LABEL[stages[stage]]}</span>
              </div>
              <p className="sx-small sx-muted">{info.role} · Uses: {info.uses}</p>
              {report && <ul><li>{report.digest}</li>{report.missing.map((item) => <li key={item}>{item}</li>)}</ul>}
            </div>
          );
        })}
        {run && (
          <p className="sx-small sx-muted">
            {run.completedAt ? `Finished ${new Date(run.completedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · ` : ""}
            Property data: {run.datasetId ?? "not loaded"}{run.datasetDate ? ` as of ${run.datasetDate}` : " (undated snapshot)"} ·{" "}
            {run.executionMode === "scripted" ? "Test mode: scripted model (not a live AI run)" : "Live model"}
          </p>
        )}
        <p className="sx-small sx-muted">Specialists only call the same checked tools. Matching and money math always run in code, never in the AI.</p>
      </Disclosure>
    </main>
  );
}
