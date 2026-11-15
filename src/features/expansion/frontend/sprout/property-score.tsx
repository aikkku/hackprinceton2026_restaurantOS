import { propertyScoreLabel, type PropertyScore } from "../../domain/property-score.ts";
import { Disclosure } from "./ui.tsx";

export function ScoreBadge({ result }: { result: PropertyScore }) {
  return <span className="sx-score" data-tone={result.score === null ? "unknown" : result.score >= 8 ? "good" : result.score >= 6 ? "mixed" : "low"} aria-label={`Property fit score: ${propertyScoreLabel(result)}. ${result.includedCount} of ${result.activeCount} applicable factors included.`}>
    {propertyScoreLabel(result)}<span className="sx-score-coverage">{result.includedCount}/{result.activeCount} factors</span>
  </span>;
}

export function ScoreBreakdown({ result }: { result: PropertyScore }) {
  return <Disclosure title="How this score works" hint={propertyScoreLabel(result)}>
    <p>Fit for your needs, based on structured findings from this search. Unknown factors receive no points or penalties. Factors you don’t require have no effect.</p>
    <p className="sx-small sx-muted">{result.isDemo ? "Synthetic example · " : ""}{Math.round(result.coverage * 100)}% of applicable factor weight has usable data. Scores with different coverage use different evidence. This is a planning comparison, not a success prediction.</p>
    {result.factors.map(factor => <div className="sx-ev" key={factor.key}>
      <div className="sx-ev-head"><strong>{factor.label}</strong><span>{factor.score === null ? factor.weight === 0 ? "Not required" : "Excluded · unverified or unavailable" : `${factor.score.toFixed(1)}/10 · weight ${factor.weight}`}</span></div>
      <p className="sx-small">{factor.explanation}</p>
    </div>)}
    <p className="sx-small sx-muted">Weighted average over included factors, rounded to one decimal. At least 25% coverage is required. Base rent is scored without unknown extra charges; seating can use a labeled floor-area estimate. Demographics and competition context have no owner-specific scoring model, so they are excluded. Model: {result.modelVersion}.</p>
  </Disclosure>;
}
