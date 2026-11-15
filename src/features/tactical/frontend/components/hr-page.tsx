"use client";

import { useEffect, useState } from "react";
import { CalendarDays, ChevronDown, Sparkles, Users, UserPlus } from "lucide-react";
import type { Dataset } from "../../domain/dataset";
import { hrCardIds, hrOverviewSchema, workforceMetrics, type HrOverview, type HrEvidence } from "../../domain/hr";
import { aiError } from "../../domain/ai";
import { useAiAccess } from "./ai-workbench";
import { HrCalendar } from "./hr-calendar";
import { HrHiring } from "./hr-hiring";
import "./hr.css";
const currency = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
const labels = { coverage: "Team coverage", service: "Service load", labor: "Labor cost", workload: "Weekly workload" };
const statusLabels = { green: "On track", yellow: "Watch", red: "Needs attention" };

export function HrPage({ dataset, active }: { dataset: Dataset; active: boolean }) {
  const { operations } = dataset;
  const unlocked = useAiAccess();
  const [section, setSection] = useState("schedule");
  const [retry, setRetry] = useState(0);
  const [analysis, setAnalysis] = useState<{ result: HrOverview; evidence: HrEvidence[]; model: string; generatedAt: string; source: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const source = JSON.stringify([dataset.profile.id, operations, dataset.reviews]);
  const metrics = operations.workforce ? workforceMetrics(dataset) : null;
  const current = analysis?.source === source ? analysis : null;
  useEffect(() => {
    if (!active || !operations.workforce) return;
    const controller = new AbortController();
    async function load() {
      setPending(true); setError(false);
      try {
        const init = { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]) };
        let response = await fetch(`/api/tactical/hr?restaurantId=${encodeURIComponent(dataset.profile.id)}`, init);
        if (!response.ok) throw new Error(aiError);
        let body = await response.json();
        if (body.ok && body.result === null && unlocked) {
          response = await fetch("/api/tactical/hr", { ...init, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: "overview", restaurantId: dataset.profile.id }) });
          if (!response.ok) throw new Error(aiError);
          body = await response.json();
        }
        if (!body.ok) throw new Error(aiError);
        if (!controller.signal.aborted) setAnalysis(body.result ? { result: hrOverviewSchema.parse(body.result), evidence: body.evidence, model: body.model, generatedAt: body.generatedAt, source } : null);
      } catch { if (!controller.signal.aborted) { setError(true); setAnalysis(null); } }
      finally { if (!controller.signal.aborted) setPending(false); }
    }
    void load();
    return () => controller.abort();
  }, [active, dataset.profile.id, operations.workforce, source, unlocked, retry]);
  const values = metrics ? { coverage: `${metrics.staff} people`, service: `${metrics.orders} orders`, labor: metrics.laborFraction === null ? "Unavailable" : `${(metrics.laborFraction * 100).toFixed(1)}% of sales`, workload: `${metrics.hours} hours` } : null;
  return <div className="hr-hub">
    <header className="hr-heading"><div><span className="hr-kicker">PEOPLE & OPERATIONS</span><h2>Your team, in sync.</h2></div><span className="pill">Demo week · {operations.workforce?.weekStart ?? "Unavailable"}</span></header>
    <div className="hr-health" aria-label="AI staffing assessment">{hrCardIds.map(id => {
      const card = current?.result.cards.find(row => row.id === id);
      const explanation = card ? `${card.reason}\n${card.limitation}\nSources: ${card.evidenceIds.map(id => current?.evidence.find(row => row.id === id)?.label ?? id).join(" · ")}` : "Unlock AI to assess the current demo week.";
      return <div key={id} className={`hr-health-card health-${card?.status ?? "neutral"}`} tabIndex={0} aria-describedby={`hr-explanation-${id}`} onKeyDown={event => { if (event.key === "Escape") event.currentTarget.blur(); }} aria-label={`${labels[id]}: ${card ? statusLabels[card.status] : "Not analyzed"}`}>
        <div className="hr-health-label"><span>{labels[id]}</span><Sparkles size={13} /></div>
        <strong>{values?.[id] ?? "Unavailable"}</strong>
        <span className="hr-health-status"><i />{card ? statusLabels[card.status] : pending ? "Analyzing…" : "Not analyzed"}<small>AI</small></span>
        <div id={`hr-explanation-${id}`} role="tooltip" className="hr-health-tooltip">{explanation}</div>
      </div>;
    })}</div>
    {error && <div className="hr-inline-error" role="alert">{aiError}<button className="button ai-button compact" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    <nav className="hr-tabs" aria-label="HR sections">{[["schedule", "Schedule", CalendarDays], ["team", "Team", Users], ["hire", "Hire employees", UserPlus]].map(([id, label, Icon]) => <button key={id as string} aria-pressed={section === id} onClick={() => setSection(id as string)}><Icon size={15} />{label as string}{id === "team" && <small>{operations.employees.length}</small>}</button>)}</nav>
    {section === "schedule" && <HrCalendar operations={operations} />}
    {section === "team" && <section className="hr-roster" aria-label="Team roster">{operations.employees.map(employee => <details className="hr-person" key={employee.id}>
      <summary><span className="hr-avatar">{employee.name.split(" ").map(part => part[0]).join("")}</span><span><strong>{employee.name}</strong><small>{employee.role}</small></span><span className="hr-person-hours">{employee.hoursThisWeek}h<small>{employee.type}</small></span><ChevronDown size={14} /></summary>
      <dl><div><dt>Pay assumption</dt><dd>${(employee.hourlyRateCents / 100).toFixed(2)}/hr</dd></div><div><dt>Availability</dt><dd>{employee.availability}</dd></div><div><dt>Contact</dt><dd>{employee.email}</dd></div><div><dt>Tenure</dt><dd>{employee.tenure}</dd></div></dl>
    </details>)}</section>}
    {section === "hire" && <HrHiring key={source} restaurantId={dataset.profile.id} />}
    <details className="hr-data-notes"><summary>Data & assumptions</summary>
      <p>{operations.workforce?.description ?? "No dated demand sample is available."}</p>
      {metrics && <p>Estimated scheduled base labor: {currency(metrics.laborCents)}. {metrics.orders} orders · {currency(metrics.salesCents)} item sales. Excludes overtime premiums, taxes and benefits.</p>}
      {operations.workforce && <p>Planning guides: {(operations.workforce.assumptions.targetLaborFraction * 100).toFixed(0)}% labor / sales; {operations.workforce.assumptions.targetOrdersPerFloorHour} peak orders per floor staff-hour; {operations.workforce.assumptions.weeklyHoursGuide} hours per person. These are mock assumptions, not industry or legal standards.</p>}
      {current && <><p className="hr-eyebrow">AI · {current.model} · {current.generatedAt.slice(0, 10)}</p><details><summary>Analysis sources</summary>{current.evidence.map(row => <details key={row.id}><summary>{row.label} · {row.id}</summary><pre>{JSON.stringify(row.detail, null, 2)}</pre></details>)}</details></>}
    </details>
  </div>;
}
