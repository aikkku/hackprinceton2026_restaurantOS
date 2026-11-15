"use client";

import { useCallback, useEffect, useState } from "react";
import type { NearbyExplanation, NearbyRestaurantsResult } from "../../domain/nearby-restaurants.ts";
import { explainNearbyRestaurantsRequest, loadNearbyRestaurants } from "../data/investigation-client.ts";
import { Tag } from "./ui.tsx";

const meters = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
const time = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Live Google Places list. Loaded each time the place is opened and held only
 * in component state; never written to evidence or a saved plan.
 */
export function NearbyRestaurants({ runId, candidateId, cuisine, restaurantName }: { runId: string; candidateId: string; cuisine: string | null; restaurantName: string | null }) {
  const [attempt, setAttempt] = useState(0);
  // State is keyed to the request so a new place/retry never shows stale results.
  const key = JSON.stringify([runId, candidateId, cuisine, attempt]);
  const [loaded, setLoaded] = useState<{ key: string; result: NearbyRestaurantsResult | null; error: string } | null>(null);
  const [explained, setExplained] = useState<{ key: string; explanation: NearbyExplanation | null; error: string } | null>(null);
  const [explaining, setExplaining] = useState(false);
  const loading = loaded?.key !== key;
  const result = loading ? null : loaded.result;
  const loadError = loading ? "" : loaded.error;
  const explanation = explained?.key === key ? explained.explanation : null;
  const explainError = explained?.key === key ? explained.error : "";

  useEffect(() => {
    const controller = new AbortController();
    loadNearbyRestaurants(runId, candidateId, cuisine, controller.signal)
      .then(next => setLoaded({ key, result: next, error: "" }))
      .catch((error: unknown) => { if (!controller.signal.aborted) setLoaded({ key, result: null, error: error instanceof Error ? error.message : "Nearby restaurants could not load." }); });
    return () => controller.abort();
  }, [key, runId, candidateId, cuisine]);

  const explain = useCallback(() => {
    setExplaining(true);
    explainNearbyRestaurantsRequest(runId, { candidateId, cuisine, restaurantName })
      .then(({ result: fresh, explanation: next }) => { setLoaded({ key, result: fresh, error: "" }); setExplained({ key, explanation: next, error: "" }); })
      .catch((error: unknown) => setExplained({ key, explanation: null, error: error instanceof Error ? error.message : "The explanation could not be generated." }))
      .finally(() => setExplaining(false));
  }, [key, runId, candidateId, cuisine, restaurantName]);

  const same = new Set(result?.summary?.sameCuisinePlaceIds ?? []);
  const nameOf = new Map(result?.restaurants.map(r => [r.placeId, r.name]) ?? []);
  const retry = <button type="button" className="sx-btn sx-btn-secondary" onClick={() => setAttempt(n => n + 1)}>Try again</button>;

  return (
    <div className="sx-ev" aria-busy={loading} data-testid="nearby-restaurants">
      <h3 className="sx-strong">Nearby restaurants · Google Maps</h3>
      <p className="sx-small sx-muted">Up to 20 nearby restaurants within 500 m, nearest first. This is not a complete list of competitors.</p>
      {loading ? <p className="sx-small sx-muted" role="status"><Tag kind="unknown">Checking…</Tag> Looking up nearby restaurants…</p>
        : loadError ? <div className="sx-stack"><p className="sx-small sx-muted" role="alert">{loadError}</p><div>{retry}</div></div>
        : result && result.status !== "ok" ? <div className="sx-stack">
            <span><Tag kind="unknown">Not available</Tag></span>
            <p className="sx-small sx-muted" role={["denied", "rate_limited", "timeout", "unavailable"].includes(result.status) ? "alert" : undefined}>{result.message}</p>
            <p className="sx-small sx-muted">This doesn’t mean there are no restaurants nearby.</p>
            {["rate_limited", "timeout", "unavailable"].includes(result.status) && <div>{retry}</div>}
          </div>
        : result && !result.restaurants.length ? <div className="sx-stack">
            <span><Tag kind="listing">Google Maps</Tag></span>
            <p className="sx-small">Google returned no restaurants within 500 m of this listing.</p>
            <p className="sx-small sx-muted">Google may not list every business. Treat this as a reason to check in person, not as proof there’s no competition.</p>
          </div>
        : result && result.summary ? <div className="sx-stack">
            <p className="sx-small">
              {result.summary.capReached ? `${result.summary.returned} shown (the most Google returns), so more may exist.` : `${result.summary.returned} found.`}
              {result.summary.nearestMeters !== null && <> Nearest {meters(result.summary.nearestMeters)}</>}
              {result.summary.medianMeters !== null && <> · median {meters(result.summary.medianMeters)}</>}.
              {result.summary.cuisine && <> {same.size ? `${same.size} listed with a type matching “${result.summary.cuisine}”.` : `None listed with a type matching “${result.summary.cuisine}”.`}</>}
            </p>
            <ul className="sx-nearby" aria-label="Nearby restaurants">
              {result.restaurants.map(r => (
                <li key={r.placeId}>
                  <span className="sx-nearby-main">
                    <a href={r.googleMapsUrl} target="_blank" rel="noreferrer">{r.name}</a>
                    {same.has(r.placeId) && <Tag kind="followup">Same cuisine type</Tag>}
                  </span>
                  <span className="sx-small sx-muted">{r.typeLabel} · {meters(r.distanceMeters)} away{r.address ? ` · ${r.address}` : ""}</span>
                </li>
              ))}
            </ul>
            <details className="sx-small sx-muted">
              <summary>Source and limitations</summary>
              <ul>
                <li>{result.source.api}, ranked by distance, {result.source.radiusMeters} m radius, at most {result.source.resultCap} results.</li>
                <li>Distances are straight-line from the listing’s coordinates, not walking distance.</li>
                <li>Types are what Google reports; a place can be miscategorized. “Same cuisine type” compares your cuisine’s words with that type only.</li>
                <li>Loaded live {time(result.source.retrievedAt)}. Not saved with your plan; it reloads each time you open this place.</li>
              </ul>
            </details>
            <div className="sx-stack">
              <div><button type="button" className="sx-btn sx-btn-secondary" disabled={explaining} onClick={explain}>{explaining ? "Explaining…" : explanation ? "Explain again" : "Explain overlap and gaps"}</button></div>
              {explainError && <p className="sx-small sx-muted" role="alert">{explainError}</p>}
              {explanation && <div className="sx-stack" aria-live="polite">
                <span><Tag kind="estimate">AI interpretation</Tag></span>
                <p><strong>Overlap.</strong> {explanation.overlap}</p>
                <p><strong>Gaps.</strong> {explanation.gaps}</p>
                {explanation.caveats.length > 0 && <ul>{explanation.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>}
                <p className="sx-small sx-muted">Written by {explanation.model} from the list above only{explanation.citedPlaceIds.length ? ` (mentions ${explanation.citedPlaceIds.map(id => nameOf.get(id)).filter(Boolean).join(", ")})` : ""}. Counts and distances come from the list, not the AI. It doesn’t predict sales or demand, and it isn’t saved.</p>
              </div>}
            </div>
          </div>
        : null}
      <p className="sx-small sx-muted sx-google-attr" translate="no">Google Maps</p>
    </div>
  );
}
