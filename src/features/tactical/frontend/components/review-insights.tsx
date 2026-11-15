"use client";

import { useCallback, useId, useState } from "react";
import { ArrowRight, GitBranch, MessageSquareText, Network, RefreshCw, Search, Sparkles, Star } from "lucide-react";
import { filterReviews, summarizeReviews, themeKey } from "../../domain/reviews";
import { matchesReview } from "../../domain/review-analysis";
import { useReviewAnalysis } from "../use-review-analysis";
import { useAiAccess } from "./ai-workbench";
import { ReviewReply } from "./review-reply";
import { StateButton } from "./state-button";
import type { Fixture } from "../../domain/schemas";
import "./review-insights.css";
import { useAssistantLocation } from "../assistant-navigation";
import { NetworkPanel } from "./network-panel";
import { SocialPipeline } from "./social-pipeline";

const percentage = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function ReviewInsights({ reviews, onTrySeating, restaurantId, active = true }: {
  restaurantId: string;
  reviews: Fixture["reviews"];
  active?: boolean;
  onTrySeating: () => void;
}) {
  const headingId = useId();
  const [tab, setTab] = useState("reviews");
  const [query, setQuery] = useState("");
  const [selectedTheme, setSelectedTheme] = useState("");
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [sentiment, setSentiment] = useState("");
  useAssistantLocation("review", useCallback(() => { setTab("reviews"); setQuery(""); setSelectedTheme(""); setPriorityOnly(false); setSentiment(""); }, []));
  const unlocked = useAiAccess();
  const analysis = useReviewAnalysis(restaurantId, JSON.stringify(reviews.map(({ id, text, rating, date }) => ({ id, text, rating, date }))), active && tab === "reviews", unlocked);
  const records = new Map(reviews.flatMap(review => {
    const record = analysis.state?.records.find(row => matchesReview(row, restaurantId, review));
    return record ? [[review.id, record] as const] : [];
  }));
  const classifiedReviews = reviews.map(review => ({ ...review, themes: records.get(review.id)?.classification.themes ?? [] }));
  const summary = summarizeReviews(classifiedReviews);
  const priorityIds = [...records.values()].filter(row => row.classification.highPriority).map(row => row.source.id);
  const seatingPriority = [...records.values()].some(row => row.classification.highPriority && row.classification.themes.some(theme => theme === "Seating" || theme === "Wait time"));
  const visibleReviews = filterReviews(classifiedReviews, {
    query,
    theme: selectedTheme,
    citedOnly: priorityOnly,
    evidenceIds: priorityIds,
  }).filter(review => !sentiment || records.get(review.id)?.classification.sentiment === sentiment);
  const hasFilters = Boolean(query || selectedTheme || priorityOnly || sentiment);

  function resetFilters() {
    setQuery("");
    setSelectedTheme("");
    setPriorityOnly(false);
    setSentiment("");
  }

  return (
    <section className="review-insights" id="review-insights" aria-labelledby={headingId}>
      <h2 id={headingId} className="floor-screen-reader">Customer signals</h2>
      <nav className="review-navigation" aria-label="Customer signals views">
        <button aria-pressed={tab === "reviews"} onClick={() => setTab("reviews")}><MessageSquareText size={17} aria-hidden="true" />Review evidence</button>
        <button aria-pressed={tab === "network"} onClick={() => setTab("network")}><Network size={17} aria-hidden="true" />Relationship network</button>
        <button aria-pressed={tab === "social"} onClick={() => setTab("social")}><GitBranch size={17} aria-hidden="true" />Content & connectivity</button>
      </nav>
      <div hidden={tab !== "social"}><SocialPipeline restaurantId={restaurantId} /></div>
      <div hidden={tab !== "network"}><NetworkPanel restaurantId={restaurantId} /></div>
      <div hidden={tab !== "reviews"}>
      <div className="review-analysis-status" aria-label="AI review classification">
        <div className="review-analysis-title"><Sparkles size={16} aria-hidden="true" /><strong>AI review filters</strong><span className="review-ai-badge">AI</span></div>
        <p role="status">{!analysis.state && !analysis.pending ? analysis.error ? "" : "Loading saved classifications…" : analysis.pending ? `Processing reviews · ${records.size} of ${reviews.length} ready` : analysis.state?.storage === "unavailable" ? "Connect MongoDB to save review classifications." : `${records.size} of ${reviews.length} classified · saved to MongoDB`}</p>
        {!unlocked && records.size < reviews.length && analysis.state?.storage === "mongodb" && <p>Unlock the AI workspace to classify new reviews.</p>}
        {analysis.error && <p role="alert">Something is wrong</p>}
        <StateButton className="button review-ai-button compact" disabled={analysis.pending} onClick={analysis.refresh} aria-label={analysis.error ? "Retry review analysis" : "Refresh review analysis"}><RefreshCw size={14} />{analysis.error ? "Retry" : "Refresh"}</StateButton>
      </div>
      {summary.total === 0 ? (
        <p className="review-empty">This demo has no reviews to summarize yet.</p>
      ) : (
        <div className="review-insights-body">
          <div className="review-summary">
            <div className="review-rating-card">
            <div className="review-rail-heading"><h3>Guest feedback</h3><span className="pill">Derived</span></div>
            <div className="rating-overview">
              <div>
                <span className="rating-average"><Star size={25} aria-hidden="true" />{decimal.format(summary.meanRating ?? 0)}<small> / 5</small></span>
                <p>Average of {summary.total} demo reviews</p>
              </div>
            </div>
            <ul className="rating-distribution" aria-label="Rating distribution">
              {summary.ratings.map((item) => (
                <li key={item.rating}>
                  <span>{item.rating} stars</span>
                  <progress value={item.count} max={summary.total} aria-label={`${item.rating} stars, ${item.count} of ${summary.total} reviews`} />
                  <span>{item.count}</span>
                </li>
              ))}
            </ul>
            </div>

            <div className="review-themes-card">
            <div className="review-rail-heading"><h3>Review themes</h3><span className="review-ai-badge"><Sparkles size={11} aria-hidden="true" />AI</span></div>
            <p className="review-method">AI themes from {records.size} classified reviews. Each review can mention several topics.</p>
            <div className="review-theme-list" role="region" tabIndex={0} aria-label="Filter by review theme">
              {summary.themes.map((theme) => (
                <button
                  key={theme.key}
                  type="button"
                  className="review-theme review-theme-ai"
                  aria-pressed={selectedTheme === theme.key}
                  onClick={() => setSelectedTheme(selectedTheme === theme.key ? "" : theme.key)}
                >
                  <span>{theme.label}</span>
                  <small>{theme.count} of {summary.total} · {percentage.format(theme.fraction)}</small>
                </button>
              ))}
              {!summary.themes.length && <p className="review-method">Themes appear after AI processing.</p>}
            </div>
            </div>
            {seatingPriority && <div className="review-priority-link">
              <p>High-priority feedback mentions seating or waiting.</p>
              <button className="button review-ai-button compact" type="button" onClick={onTrySeating}>Review floor plan<ArrowRight size={15} /></button>
            </div>}
          </div>

          <div className="review-browser">
            <div className="review-filter-controls">
              <label className="review-search">
                <span className="floor-screen-reader">Search reviews</span>
                <span className="review-search-field"><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search text, source ID, or theme" /></span>
              </label>
              <div className="review-ai-filters">
                <label className="checkbox"><input type="checkbox" checked={priorityOnly} onChange={event => setPriorityOnly(event.target.checked)} />High priority <span className="review-ai-badge">AI · {priorityIds.length}</span></label>
                <label className="review-sentiment"><span className="floor-screen-reader">AI sentiment</span><select aria-label="AI sentiment" value={sentiment} onChange={event => setSentiment(event.target.value)}><option value="">All sentiments</option><option value="positive">Positive</option><option value="mixed">Mixed</option><option value="negative">Negative</option><option value="neutral">Neutral</option></select></label>
              </div>
            </div>
            <div className="review-results-heading">
              <p role="status">{visibleReviews.length} of {summary.total} reviews shown</p>
              {hasFilters && <button className="button quiet compact" type="button" onClick={resetFilters}>Clear review filters</button>}
            </div>
            {visibleReviews.length ? (
              <ul className="review-list" tabIndex={0} aria-label="Customer review results">
                {visibleReviews.map((review) => (
                  <li key={`${review.id}-${review.text}`} data-review-id={review.id} data-assistant-key={`review:${review.id}`}>
                    <div className="review-meta">
                      <span className="pill">Demo review</span>
                      {records.get(review.id)?.classification.highPriority && <span className="review-priority-badge"><Sparkles size={12} />High priority</span>}
                      <time dateTime={review.date}>{review.date}</time>
                      <span className="review-card-rating" aria-label={`${review.rating} out of 5 stars`}><Star size={13} aria-hidden="true" />{review.rating}/5</span>
                    </div>
                    <blockquote>{review.text}</blockquote>
                    {records.has(review.id) ? <div className="review-ai-labels" tabIndex={0}
                      title={`${records.get(review.id)!.classification.reason}
AI interpretation · ${records.get(review.id)!.model} · ${records.get(review.id)!.processedAt.slice(0, 10)}`}
                      aria-description={records.get(review.id)!.classification.reason}>
                      <p><Sparkles size={12} aria-hidden="true" />{records.get(review.id)!.classification.sentiment} · {Array.from(new Map(review.themes.map(theme => [themeKey(theme), theme.trim()])).values()).join(" · ")}</p>
                    </div> : <p className="review-method">Awaiting AI classification</p>}
                    <small className="review-source-id">Source ID {review.id}</small>
                    <ReviewReply restaurantId={restaurantId} reviewId={review.id} />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="review-empty">
                <p>No reviews match these filters.</p>
                <button className="button secondary compact" type="button" onClick={resetFilters}>Show all reviews</button>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </section>
  );
}
