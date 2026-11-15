import { calculateDecisionFinance, emptyFinanceInputs, occupancyBreakdown } from "../../domain/decision-finance.ts";
import type { BriefChoice } from "../../domain/decision-brief.ts";
import { EVIDENCE_VERSION, providerNames, reassessCandidate, type SourceSnapshot } from "../../domain/evidence.ts";
import {
  monthlyOccupancyRange,
  serviceInclusion,
  type AssessedCandidate,
  type AssessmentReasonCode,
  type CandidateGroup,
  type RequirementAssessment,
  type SpaceCandidate,
} from "../../domain/matching.ts";
import type { Requirement, SearchRequirements } from "../../domain/requirements.ts";
import type { RentEstimate } from "../../domain/rent-estimate.ts";

/**
 * Pure presentation model for the sprout Expansion UI (Rain-owned, no React).
 *
 * Everything here turns validated domain records into plain-language copy.
 * It never invents facts: unknown stays "Needs checking" / "Unknown", and
 * every number shown comes from the deterministic domain functions.
 */

export type Fit = "meets" | "verify" | "fails" | "other";

export const FIT_LABEL: Record<Fit, string> = {
  meets: "Looks good",
  verify: "Needs checking",
  fails: "Doesn't fit",
  other: "Not checked",
};
export const FIT_ICON: Record<Fit, string> = { meets: "✓", verify: "?", fails: "×", other: "–" };

export const fitForGroup = (group: CandidateGroup): Fit =>
  group === "meets_assessed_requirements" ? "meets" : group === "needs_verification" ? "verify" : "fails";

export const fitForStatus = (status: RequirementAssessment["status"]): Fit =>
  status === "pass" ? "meets" : status === "unknown" ? "verify" : status === "fail" ? "fails" : "other";

// ---------------------------------------------------------------------------
// Money

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const money = (value: number) => usd.format(Math.round(value));
export const moneyShort = (value: number) =>
  value >= 1000 ? `$${(value / 1000).toFixed(1).replace(/\.0$/, "")}k` : `$${Math.round(value)}`;

export type MonthlyCost =
  | { kind: "exact"; low: number; high: number }
  | { kind: "open"; low: number }
  | { kind: "unknown"; reason: string };

/** Total monthly occupancy from the record alone (extras unknown unless included). */
export function monthlyCost(candidate: SpaceCandidate, extrasMonthly: number | null = null): MonthlyCost {
  const result = monthlyOccupancyRange(candidate, extrasMonthly, serviceInclusion(candidate.rent?.serviceTypeCode ?? null));
  if ("unknown" in result) return { kind: "unknown", reason: result.reason };
  return result.known.high === null ? { kind: "open", low: result.known.low } : { kind: "exact", low: result.known.low, high: result.known.high };
}

export function costLabel(cost: MonthlyCost): string {
  if (cost.kind === "unknown") return "Rent not listed";
  if (cost.kind === "open") return `${money(cost.low)}/mo + unknown charges`;
  return cost.low === cost.high ? `${money(cost.low)}/mo` : `${money(cost.low)}–${money(cost.high)}/mo`;
}

export function costPin(cost: MonthlyCost): string {
  if (cost.kind === "unknown") return "?";
  if (cost.kind === "open") return `${moneyShort(cost.low)}+`;
  return moneyShort(cost.high);
}

export function rangeLabel(range: { low: number; high: number | null } | null, suffix = ""): string | null {
  if (!range) return null;
  if (range.high === null) return `${money(range.low)}+${suffix}`;
  return range.low === range.high ? `${money(range.low)}${suffix}` : `${money(range.low)}–${money(range.high)}${suffix}`;
}

/** Quoted rate as written in the record, e.g. "$30.00 per sq ft a year". */
export function quotedRate(candidate: SpaceCandidate): string | null {
  const rent = candidate.rent;
  if (!rent || rent.currencyCode !== 1 || rent.measurementCode !== 1) return null;
  const period = rent.rateBasisCode === 1 ? "a month" : rent.rateBasisCode === 2 ? "a year" : null;
  if (!period) return null;
  const value = rent.low === rent.high || rent.high === null ? `$${(rent.low ?? 0).toFixed(2)}` : `$${(rent.low ?? 0).toFixed(2)}–$${rent.high.toFixed(2)}`;
  return rent.low === null ? null : `${value} per sq ft ${period}`;
}

export function chargesLabel(candidate: SpaceCandidate): string {
  const inclusion = serviceInclusion(candidate.rent?.serviceTypeCode ?? null);
  return inclusion === "included" ? "Included in the quoted rent" : inclusion === "not_included" ? "Not included, amount not listed" : "Not stated in the listing";
}

// ---------------------------------------------------------------------------
// Derived rent estimates (never a matching result, never "within budget")

/** "≈ $2.3k–3.4k/mo + building charges" (short) or the money() long form. */
export function estimateCostLabel(estimate: RentEstimate, short = false): string {
  const format = short ? moneyShort : money;
  if (estimate.monthly === null) return `≈ ${money(estimate.medianAnnualPerSqFt)}/sq ft/yr (no size to price)`;
  return `≈ ${format(estimate.monthly.low)}–${format(estimate.monthly.high)}/mo + building charges`;
}

/** Compact pin price for an estimated rent. */
export function estimatePin(estimate: RentEstimate): string {
  if (estimate.monthly === null) return `≈ ${moneyShort(estimate.medianAnnualPerSqFt)}/sq ft`;
  return `≈ ${moneyShort(estimate.monthly.low)}–${moneyShort(estimate.monthly.high)}`;
}

/**
 * Plain-language estimate method line. The radius claim is honest: a city
 * fallback never says "within X km". Callers prefix "Synthetic " for demo
 * candidates; this function stays pure about the text.
 */
export function estimateMethodText(estimate: RentEstimate): string {
  const basis =
    estimate.method === "nearest_neighbors"
      ? `${estimate.comparableCount} listed retail spaces within ${estimate.radiusKm} km`
      : `${estimate.comparableCount} listed retail spaces across the city (fallback)`;
  return `${basis}, median ${money(estimate.medianAnnualPerSqFt)}/sq ft/yr, CoStar snapshot${estimate.datasetDate ? ` ${estimate.datasetDate}` : ""}`;
}

const DISPLAY_GROUP_RANK: Record<CandidateGroup, number> = {
  meets_assessed_requirements: 0,
  needs_verification: 1,
  does_not_meet: 2,
};

const hasListedRent = (item: AssessedCandidate) =>
  item.candidate.rent !== null &&
  (item.candidate.rent.low !== null || item.candidate.rent.high !== null);

/**
 * Pure display ordering. Group order is preserved (meets → needs_verification
 * → does_not_meet); inside a group, listed-rent candidates keep their
 * existing relative order ahead of no-rent candidates. Among no-rent
 * candidates, those with an estimate whose monthly.high is within the cap
 * sort first (no cap → keep relative order). Final tie-break is the original
 * relative order. This NEVER reorders across groups and NEVER moves a
 * no-rent candidate ahead of a listed-rent candidate in the same group.
 */
export function displayOrder(
  assessed: AssessedCandidate[],
  estimates: Map<string, RentEstimate>,
  cap: number | null,
): AssessedCandidate[] {
  const indexed = assessed.map((item, index) => ({ item, index }));
  const sorted = [...indexed].sort((a, b) => {
    const byGroup = DISPLAY_GROUP_RANK[a.item.group] - DISPLAY_GROUP_RANK[b.item.group];
    if (byGroup) return byGroup;
    const aListed = hasListedRent(a.item);
    const bListed = hasListedRent(b.item);
    if (aListed !== bListed) return aListed ? -1 : 1;
    if (!aListed && !bListed && cap !== null) {
      const aEstimate = estimates.get(a.item.candidate.id)?.monthly;
      const bEstimate = estimates.get(b.item.candidate.id)?.monthly;
      const aUnder = aEstimate !== null && aEstimate !== undefined && aEstimate.high <= cap;
      const bUnder = bEstimate !== null && bEstimate !== undefined && bEstimate.high <= cap;
      if (aUnder !== bUnder) return aUnder ? -1 : 1;
    }
    return a.index - b.index;
  });
  return sorted.map(({ item }) => item);
}

// ---------------------------------------------------------------------------
// Requirements

export const requirementValue = (requirements: SearchRequirements, id: Requirement["id"]) =>
  requirements.requirements.find((item) => item.id === id);

export function numberRequirement(requirements: SearchRequirements, id: Requirement["id"]): number | null {
  const value = requirementValue(requirements, id)?.value;
  return value?.kind === "number" ? value.value : null;
}

export function budgetCap(requirements: SearchRequirements): number | null {
  return numberRequirement(requirements, "occupancy.monthlyLimit");
}

export function isMustHave(requirements: SearchRequirements, id: Requirement["id"]): boolean {
  const requirement = requirementValue(requirements, id);
  if (!requirement || requirement.kind !== "hard") return false;
  return requirement.value.kind === "boolean" ? requirement.value.value : true;
}

export type FactorKey = "cost" | "parking" | "kitchen" | "space" | "neighborhood";
export const FACTOR_REQUIREMENT: Record<FactorKey, Requirement["id"]> = {
  cost: "occupancy.monthlyLimit",
  parking: "space.customerParking",
  kitchen: "space.existingKitchen",
  space: "space.seats",
  neighborhood: "market.neighborhoodPreference",
};
export const FACTOR_NAME: Record<FactorKey, string> = {
  cost: "Cost",
  parking: "Parking",
  kitchen: "Kitchen",
  space: "Space",
  neighborhood: "Neighborhood",
};

/** One line per requirement for "How we checked", e.g. "Rent within $5,000/mo · must-have". */
export function ruleLabel(requirements: SearchRequirements, id: Requirement["id"]): string {
  const requirement = requirementValue(requirements, id);
  const tier = requirement?.kind === "hard" ? "must-have" : "nice to have";
  switch (id) {
    case "occupancy.monthlyLimit": {
      const cap = budgetCap(requirements);
      return `Rent within ${cap === null ? "your budget" : `${money(cap)}/mo`} · ${tier}`;
    }
    case "space.existingKitchen": return `Existing kitchen · ${isMustHave(requirements, id) ? "must-have" : "not required"}`;
    case "space.customerParking": return `Customer parking · ${isMustHave(requirements, id) ? "must-have" : "not required"}`;
    case "space.seats": {
      const value = requirement?.value;
      return value?.kind === "range" && value.minimum !== null && value.maximum !== null
        ? `${value.minimum}–${value.maximum} seats · ${tier}` : `Seats · ${tier}`;
    }
    case "market.neighborhoodPreference": {
      const value = requirement?.value;
      return value?.kind === "neighborhood" ? `In ${value.preferred.join(" or ")} · ${tier}` : `Neighborhood · ${tier}`;
    }
    default: return requirement?.label ?? id;
  }
}

/** Plain-language one-liner for an assessment reason code. */
export function friendlyReason(code: AssessmentReasonCode, requirements: SearchRequirements): string {
  const cap = budgetCap(requirements);
  const capText = cap === null ? "your budget" : `your ${money(cap)} budget`;
  switch (code) {
    case "below_cap": return `Total rent fits ${capText}`;
    case "exceeds_cap": return `Costs more than ${capText}`;
    case "range_crosses_cap": return `Might go over ${capText}`;
    case "missing_charges": return "Extra building charges aren’t listed yet";
    case "ambiguous_basis": return "The asking rent isn’t listed";
    case "unsupported_units": return "The rent uses units we can’t compare";
    case "kitchen_verified": return "Kitchen confirmed for this space";
    case "kitchen_absent": return "No kitchen in this space";
    case "kitchen_unverified": return "Kitchen isn’t confirmed yet";
    case "parking_verified": return "Customer parking confirmed";
    case "parking_absent": return "No customer parking";
    case "parking_unverified": return "Customer parking isn’t confirmed yet";
    case "capacity_aligned": return "Room for your seat count";
    case "capacity_mismatch": return "Seat count may not match";
    case "capacity_unknown": return "Seat count isn’t known";
    case "neighborhood_member": return "In a neighborhood you picked";
    case "neighborhood_other": return "Not in a neighborhood you picked";
    case "neighborhood_unresolved": return "Neighborhood isn’t confirmed";
    case "not_applicable": return "Not part of your needs";
    case "unknown_value": return "Not enough information yet";
  }
}

/** What to ask or look for when an assessment is still unknown. */
export function checkQuestion(assessment: RequirementAssessment): string | null {
  if (assessment.status !== "unknown") return null;
  switch (assessment.requirementId) {
    case "occupancy.monthlyLimit": {
      // A missing rent needs the broker's number; unknown extra charges need
      // the charges. Never ask about charges when the rent itself is missing.
      if (assessment.reasonCode === "ambiguous_basis") return "What is the asking rent? Ask the broker.";
      if (assessment.reasonCode === "missing_charges" || assessment.reasonCode === "range_crosses_cap") return "What are the extra building charges (taxes, insurance, upkeep) each month?";
      return assessment.reason;
    }
    case "space.existingKitchen": return "Does a working kitchen (hood, grease trap) come with this space?";
    case "space.customerParking": return "Can your customers use the parking? Check the lease or ask the landlord.";
    case "space.seats": return "How many seats fit in the dining room?";
    case "market.neighborhoodPreference": return "Which neighborhood is this address in?";
    default: return assessment.reason;
  }
}

const HARD = ["occupancy.monthlyLimit", "space.existingKitchen", "space.customerParking"] as const;

export function primaryFinding(assessed: Pick<AssessedCandidate, "assessments" | "group">, requirements: SearchRequirements): { fit: Fit; text: string } {
  const fit = fitForGroup(assessed.group);
  if (fit === "meets") return { fit, text: "Meets all your must-haves" };
  const status = fit === "fails" ? "fail" : "unknown";
  const item = assessed.assessments.find((a) => (HARD as readonly string[]).includes(a.requirementId) && a.status === status)
    ?? assessed.assessments.find((a) => a.status === status);
  return { fit, text: item ? friendlyReason(item.reasonCode, requirements) : FIT_LABEL[fit] };
}

export function unresolvedMustHaves(assessments: RequirementAssessment[]): FactorKey[] {
  const keys: FactorKey[] = [];
  for (const [key, id] of Object.entries(FACTOR_REQUIREMENT) as [FactorKey, Requirement["id"]][]) {
    if (!(HARD as readonly string[]).includes(id)) continue;
    if (assessments.find((a) => a.requirementId === id)?.status === "unknown") keys.push(key);
  }
  return keys;
}

export function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function verdict(assessments: RequirementAssessment[], group: CandidateGroup, requirements: SearchRequirements): string {
  const checks = assessments.filter((a) => a.status === "unknown").length;
  if (group === "meets_assessed_requirements")
    return checks ? `This place looks like a good fit. ${checks === 1 ? "One detail is" : "A few details are"} worth checking.` : "This place looks like a good fit for your must-haves.";
  if (group === "needs_verification") {
    const open = unresolvedMustHaves(assessments).map((key) => FACTOR_NAME[key].toLowerCase());
    return `This place could work, but ${joinWords(open) || "some must-haves"} ${open.length === 1 ? "isn’t" : "aren’t"} confirmed yet.`;
  }
  const failed = assessments.find((a) => a.status === "fail" && (HARD as readonly string[]).includes(a.requirementId));
  return `This place doesn’t fit: ${failed ? friendlyReason(failed.reasonCode, requirements).toLowerCase() : "it misses a must-have"}.`;
}

// ---------------------------------------------------------------------------
// Ranking and comparison

export function bestMatches(candidates: AssessedCandidate[], count = 3): AssessedCandidate[] {
  const viable = candidates.filter((c) => c.group !== "does_not_meet");
  return (viable.length ? viable : candidates).slice(0, count);
}

export type CompareInput = { name: string; assessments: RequirementAssessment[]; group: CandidateGroup; cost: MonthlyCost };

/** Deterministic "Sprout's take" — every sentence restates checked facts, never a model opinion. */
export function compareTake(items: CompareInput[], requirements: SearchRequirements): string[] {
  const lines: string[] = [];
  const meets = items.filter((i) => i.group === "meets_assessed_requirements");
  const verify = items.filter((i) => i.group === "needs_verification");
  const fails = items.filter((i) => i.group === "does_not_meet");
  if (meets.length) lines.push(`${joinWords(meets.map((i) => i.name))} ${meets.length === 1 ? "meets" : "meet"} all your must-haves.`);
  for (const item of verify) {
    const open = unresolvedMustHaves(item.assessments).map((key) => FACTOR_NAME[key].toLowerCase());
    lines.push(`${item.name} still needs checking on ${joinWords(open) || "some must-haves"}.`);
  }
  for (const item of fails) {
    const failed = item.assessments.find((a) => a.status === "fail");
    lines.push(`${item.name} doesn’t fit: ${failed ? friendlyReason(failed.reasonCode, requirements).toLowerCase() : "it misses a must-have"}.`);
  }
  const unknownCost = items.filter((i) => i.cost.kind !== "exact");
  for (const item of unknownCost) lines.push(`The full monthly cost of ${item.name} isn’t known yet.`);
  const exact = items.filter((i): i is CompareInput & { cost: { kind: "exact"; low: number; high: number } } => i.cost.kind === "exact");
  if (exact.length === items.length && items.length > 1) {
    const [cheapest, next] = [...exact].sort((a, b) => a.cost.high - b.cost.high);
    if (cheapest.cost.high < next.cost.high) lines.push(`${cheapest.name} has the lowest monthly cost (${money(cheapest.cost.high)}).`);
    else if (exact.every((item) => item.cost.high === cheapest.cost.high)) lines.push(`They all cost the same each month (${money(cheapest.cost.high)}).`);
  }
  const inArea = items.filter((i) => i.assessments.find((a) => a.requirementId === "market.neighborhoodPreference")?.status === "pass");
  if (inArea.length === 1 && items.length > 1) lines.push(`Only ${inArea[0].name} is confirmed to be in a neighborhood you picked.`);
  else if (inArea.length === 0) lines.push("None of these is confirmed to be in a neighborhood you picked.");
  return lines;
}

// ---------------------------------------------------------------------------
// Choices (assessment + finance working state per place)

const NOT_CHECKED = "Not checked yet.";

export function emptySources(candidateId: string, now = new Date().toISOString()): SourceSnapshot {
  return {
    version: EVIDENCE_VERSION, candidateId, refreshedAt: now,
    statuses: providerNames.map((provider) => ({ provider, status: "unavailable", mode: "unavailable", checkedAt: now, capabilities: [], reason: NOT_CHECKED })),
    observations: [], gaps: ["Source evidence has not been checked yet."],
  };
}

/** True when no source lookup has ever run for this place (only the emptySources placeholder). */
export function sourcesNeverChecked(sources: SourceSnapshot): boolean {
  return sources.observations.length === 0 && sources.statuses.every((status) => status.reason === NOT_CHECKED);
}

/** Revision 0 for a place: the run's evidence (if any) reassessed against the run's requirements. */
export function makeChoice(requirements: SearchRequirements, base: AssessedCandidate, sources?: SourceSnapshot): BriefChoice {
  const financeInputs = emptyFinanceInputs();
  financeInputs.totalFunds = numberRequirement(requirements, "funds.totalAvailable");
  const reserve = numberRequirement(requirements, "funds.emergencyReserve");
  financeInputs.reserve = reserve !== null && financeInputs.totalFunds !== null && reserve > financeInputs.totalFunds ? null : reserve;
  return {
    candidateId: base.candidate.id,
    assessmentHistory: [],
    assessment: reassessCandidate(base, requirements, [], sources ?? emptySources(base.candidate.id), {
      id: crypto.randomUUID(), parentId: null, revisionNumber: 0, evaluatedAt: new Date().toISOString(),
    }),
    financeInputs,
    financeResults: calculateDecisionFinance(base.candidate, financeInputs),
  };
}

export { occupancyBreakdown };
