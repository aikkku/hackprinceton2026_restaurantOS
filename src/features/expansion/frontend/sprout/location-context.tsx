"use client";

import type { z } from "zod";
import type { inspectionMarketContextSchema } from "../../domain/agent.ts";
import type { SourceSnapshot } from "../../domain/evidence.ts";
import { sourcesNeverChecked } from "./model.ts";
import { Tag } from "./ui.tsx";

type AgentContext = z.infer<typeof inspectionMarketContextSchema>;
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Unknown";

/** Render the same evidence the agent receives; newer source checks take precedence. */
export function LocationContext({ sources, agentContext, busy, frozen, onRefresh }: {
  sources: SourceSnapshot; agentContext?: AgentContext | null;
  busy: boolean; frozen: boolean; onRefresh: () => void;
}) {
  const neighborhood = sources.observations.find(o => o.provider === "neighborhood" && !o.isSynthetic);
  const neighborhoodName = neighborhood?.facts.find(f => f.field === "neighborhood")?.value;
  return (
    <section className="sx-stack" aria-label="Around this location" aria-busy={busy}>
      <h2 className="sx-title-sm">Around this location</h2>
      <p className="sx-small sx-muted">Population, household income and nearby restaurants help you understand the area. They don’t predict sales.</p>
      <div className="sx-ev">
        <h3 className="sx-strong">Official neighborhood</h3>
        {neighborhood ? <div className="sx-stack">
          <span><Tag kind="listing">City of Houston GIS</Tag></span>
          <strong>{neighborhoodName?.kind === "exact" ? String(neighborhoodName.value) : neighborhood.details[0]}</strong>
          <ul>{neighborhood.details.map(line => <li key={line}>{line}</li>)}</ul>
          <p className="sx-small sx-muted">Derived from the property’s coordinates and official planning boundaries. Retrieved: {date(neighborhood.retrievedAt)}. Source update date: {date(neighborhood.sourceDate)}.</p>
          {neighborhood.referenceUrl && <a href={neighborhood.referenceUrl} target="_blank" rel="noreferrer">Official City boundary source</a>}
          <p className="sx-small sx-muted">{neighborhood.limitations.join(" ")}</p>
        </div> : <p className="sx-small sx-muted">{sources.statuses.find(s => s.provider === "neighborhood")?.reason ?? "Official neighborhood membership has not been retrieved. No neighborhood name is guessed."}</p>}
      </div>
      {(["acs", "competition"] as const).map((provider) => {
        const status = sources.statuses.find(s => s.provider === provider);
        const useAgentContext = (sourcesNeverChecked(sources) || !status) && Boolean(agentContext);
        const observations = useAgentContext ? agentContext!.observations.filter(o => o.provider === provider) : sources.observations.filter(o => o.provider === provider);
        return (
          <div className="sx-ev" key={provider}>
            <h3 className="sx-strong">{provider === "acs" ? "Residents and household income" : "Mapped restaurants · OpenStreetMap · 500 m"}</h3>
            <p className="sx-small sx-muted">{provider === "acs" ? "Census estimates for the containing tract, not a 500 m population count." : "Mapped restaurant objects, not verified unique or same-cuisine competitors."}</p>
            {observations.length ? observations.map(o => (
              <div className="sx-stack" key={o.id}>
                <span><Tag kind={"isSynthetic" in o && o.isSynthetic ? "example" : o.origin === "derived" ? "estimate" : "listing"}>{"isSynthetic" in o && o.isSynthetic ? "Test data" : o.origin === "derived" ? "Derived count" : "Census estimate"}</Tag></span>
                <ul>{o.details.map((line, i) => <li key={i}>{line}</li>)}</ul>
                <p className="sx-small sx-muted">{o.label} · {o.scope === "tract" ? "Containing census tract" : "Site context"} · Source date: {date(o.sourceDate)} · Retrieved: {date(o.retrievedAt)}</p>
                <details className="sx-small sx-muted">
                  <summary>Source and limitations</summary>
                  <ul>{o.limitations.map((line, i) => <li key={i}>{line}</li>)}</ul>
                  <p>Source record: {o.sourceRecordId}</p>
                  {o.referenceUrl && <a href={o.referenceUrl} target="_blank" rel="noreferrer">{provider === "acs" ? "Census ACS source" : "OpenStreetMap source and attribution"}</a>}
                </details>
              </div>
            )) : (
              <div className="sx-stack">
                <span><Tag kind="unknown">{busy ? "Checking…" : "Not available"}</Tag></span>
                <p className="sx-small sx-muted">{busy ? "Looking for sourced neighborhood data…" : provider === "acs" ? "Population and income data have not been retrieved for this location." : "Nearby restaurant data have not been retrieved. This does not mean there are no competitors."}</p>
                {!busy && <details className="sx-small sx-muted"><summary>Why this is unavailable</summary><p>{useAgentContext ? agentContext!.gaps.join(" ") : status?.reason ?? "This source has not been checked yet."}</p></details>}
              </div>
            )}
          </div>
        );
      })}
      <div><button type="button" className="sx-btn sx-btn-secondary" disabled={busy || frozen} onClick={onRefresh}>{busy ? "Checking neighborhood data…" : "Refresh neighborhood data"}</button></div>
      {frozen && <p className="sx-small sx-muted">This saved plan shows its saved evidence. Start a new search to check for updates.</p>}
    </section>
  );
}
