"use client";

import { useId, useState } from "react";
import { ArrowRight, MessageSquareText, Search } from "lucide-react";
import { filterReviews, summarizeReviews, themeKey } from "../../domain/reviews";
import type { Fixture } from "../../domain/schemas";
import "./review-insights.css";

const percentage = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function ReviewInsights({ reviews, mission, onTrySeating }: {
  reviews: Fixture["reviews"];
  mission: Fixture["mission"];
  onTrySeating: () => void;
}) {
  const headingId = useId();
  const [query, setQuery] = useState("");
  const [selectedTheme, setSelectedTheme] = useState("");
  const [citedOnly, setCitedOnly] = useState(false);
  const summary = summarizeReviews(reviews);
  const evidenceIds = new Set(mission.evidenceIds);
  const citedCount = reviews.filter((review) => evidenceIds.has(review.id)).length;
  const visibleReviews = filterReviews(reviews, {
    query,
    theme: selectedTheme,
    citedOnly,
    evidenceIds: mission.evidenceIds,
  });
  const hasFilters = Boolean(query || selectedTheme || citedOnly);

  function resetFilters() {
    setQuery("");
    setSelectedTheme("");
    setCitedOnly(false);
  }

  return (
    <section className="panel review-insights" id="review-insights" aria-labelledby={headingId}>
      <div className="panel-heading">
        <div className="section-icon"><MessageSquareText size={18} /></div>
        <div>
          <h2 id={headingId}>Customer signals</h2>
          <p>Explore the example reviews behind your seating mission.</p>
        </div>
        <span className="pill review-demo-label">Demo data</span>
      </div>

      {summary.total === 0 ? (
        <p className="review-empty">This demo has no reviews to summarize yet.</p>
      ) : (
        <div className="review-insights-body">
          <div className="review-summary">
            <div className="rating-overview">
              <div>
                <span className="rating-average">{decimal.format(summary.meanRating ?? 0)}<small> / 5</small></span>
                <p>Average of {summary.total} demo reviews</p>
              </div>
              <span className="pill">Derived</span>
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

            <h3>Review themes</h3>
            <p className="review-method">Topics are supplied in the demo data. Each review is counted once per topic and can mention several topics.</p>
            <div className="review-theme-list" aria-label="Filter by review theme">
              {summary.themes.map((theme) => (
                <button
                  key={theme.key}
                  type="button"
                  className="review-theme"
                  aria-pressed={selectedTheme === theme.key}
                  onClick={() => setSelectedTheme(selectedTheme === theme.key ? "" : theme.key)}
                >
                  <span>{theme.label}</span>
                  <small>{theme.count} of {summary.total} · {percentage.format(theme.fraction)}</small>
                </button>
              ))}
            </div>
            <div className="review-mission-link">
              <h3>{mission.title}</h3>
              <p>{citedCount} of {summary.total} demo reviews support this example mission.</p>
              <button className="button secondary compact" type="button" onClick={onTrySeating}>
                {mission.action}<ArrowRight size={15} />
              </button>
            </div>
          </div>

          <div className="review-browser">
            <div className="review-filter-controls">
              <label className="review-search">
                <span>Search reviews</span>
                <span className="review-search-field"><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search text, source ID, or theme" /></span>
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={citedOnly} onChange={(event) => setCitedOnly(event.target.checked)} />
                Mission evidence only
              </label>
            </div>
            <div className="review-results-heading">
              <p role="status">{visibleReviews.length} of {summary.total} reviews shown</p>
              {hasFilters && <button className="button quiet compact" type="button" onClick={resetFilters}>Clear review filters</button>}
            </div>
            {visibleReviews.length ? (
              <ul className="review-list">
                {visibleReviews.map((review) => (
                  <li key={review.id}>
                    <div className="review-meta">
                      <span className="pill">Demo review</span>
                      {evidenceIds.has(review.id) && <span className="pill pill-warm">Mission evidence</span>}
                      <time dateTime={review.date}>{review.date}</time>
                      <span>{review.rating}/5</span>
                    </div>
                    <blockquote>{review.text}</blockquote>
                    <p>{Array.from(new Map(review.themes.map((theme) => [themeKey(theme), theme.trim()])).values()).join(" · ")}</p>
                    <small>Source ID {review.id}</small>
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
    </section>
  );
}
