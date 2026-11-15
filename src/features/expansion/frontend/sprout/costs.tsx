"use client";

import { useState } from "react";
import type { BriefChoice } from "../../domain/decision-brief.ts";
import { ILLUSTRATIVE_VALUES, applyIllustrative, decisionFinanceInputsSchema, occupancyBreakdown, type DecisionFinanceInputs, upfrontCategories } from "../../domain/decision-finance.ts";
import { serviceInclusion } from "../../domain/matching.ts";
import { budgetCap, estimateCostLabel, money, numberRequirement, rangeLabel } from "./model.ts";
import { placeSubtitle } from "./places.tsx";
import { AskButton, Back, Disclosure, MoneyInput, QuestionShell, Tag, formatAmount, parseAmount, type TagKind } from "./ui.tsx";
import type { Workspace } from "./workspace.ts";

type Upfront = (typeof upfrontCategories)[number];
export type CostKey = "funds" | "charges" | Upfront | "reserve" | "fixed" | "margin";

const UPFRONT_LABEL: Record<Upfront, string> = { build_out: "Renovations", equipment: "Equipment", deposit: "Deposits", fees: "Permits and fees", initial_working_capital: "Cash for the first months" };
const ADD_LABEL: Record<Upfront, string> = { build_out: "Add renovations", equipment: "Add equipment", deposit: "Add deposits", fees: "Add permits and fees", initial_working_capital: "Add cash for the first months" };

export function costSteps(choice: BriefChoice): CostKey[] {
  const needsCharges = serviceInclusion(choice.assessment.candidate.rent?.serviceTypeCode ?? null) !== "included";
  return ["funds", ...(needsCharges ? ["charges" as const] : []), "build_out", "equipment", "deposit", "fees", "initial_working_capital", "reserve", "fixed", "margin"];
}

const upfrontAmount = (inputs: DecisionFinanceInputs, category: Upfront) => inputs.upfront.find((x) => x.category === category)?.amount ?? null;
function withUpfront(inputs: DecisionFinanceInputs, category: Upfront, amount: number | null): DecisionFinanceInputs {
  const upfront = upfrontCategories.map((c) => ({ category: c, amount: c === category ? amount : upfrontAmount(inputs, c) }));
  return { ...inputs, upfront };
}

function getValue(inputs: DecisionFinanceInputs, key: CostKey): number | null {
  switch (key) {
    case "funds": return inputs.totalFunds;
    case "charges": return inputs.additionalOccupancyMonthly;
    case "reserve": return inputs.reserve;
    case "fixed": return inputs.fixedCostsMonthly;
    case "margin": return inputs.contributionMargin === null ? null : Math.round(inputs.contributionMargin * 1000) / 10;
    default: return upfrontAmount(inputs, key);
  }
}
function setValue(inputs: DecisionFinanceInputs, key: CostKey, value: number | null): DecisionFinanceInputs {
  switch (key) {
    case "funds": return { ...inputs, totalFunds: value };
    case "charges": return { ...inputs, additionalOccupancyMonthly: value };
    case "reserve": return { ...inputs, reserve: value };
    case "fixed": return { ...inputs, fixedCostsMonthly: value, fixedCostBasis: "excludes_occupancy" };
    case "margin": return { ...inputs, contributionMargin: value === null ? null : value / 100, illustrative: inputs.illustrative.filter((k) => k !== "contributionMargin") };
    default: return withUpfront(inputs, key, value);
  }
}

function validate(inputs: DecisionFinanceInputs): { ok: true; inputs: DecisionFinanceInputs } | { ok: false; message: string } {
  if (inputs.reserve !== null && inputs.totalFunds !== null && inputs.reserve > inputs.totalFunds) return { ok: false, message: "The reserve can’t be more than the money you can spend." };
  if (inputs.contributionMargin !== null && (inputs.contributionMargin < 0 || inputs.contributionMargin > 1)) return { ok: false, message: "Enter between 0 and 100 cents." };
  const parsed = decisionFinanceInputsSchema.safeParse(inputs);
  return parsed.success ? { ok: true, inputs: parsed.data } : { ok: false, message: parsed.error.issues[0]?.message ?? "Check this number." };
}

const QUESTION: Record<CostKey, { title: string; hint?: string; label: string; suffix?: string; prefix?: string }> = {
  funds: { title: "How much can you spend on opening?", label: "Money you can spend" },
  charges: { title: "What are the extra building charges?", hint: "Taxes, insurance and upkeep the landlord adds each month. Ask the broker if the listing doesn’t say.", label: "Extra building charges", suffix: "/ month" },
  build_out: { title: "How much will renovations cost?", hint: "Walls, floors, plumbing, signs. A contractor quote is best.", label: "Renovations" },
  equipment: { title: "How much will equipment cost?", hint: "Cooking line, refrigeration, furniture, point of sale.", label: "Equipment" },
  deposit: { title: "How much are the deposits?", hint: "Security deposit and any prepaid rent the lease asks for.", label: "Deposits" },
  fees: { title: "How much for permits and fees?", hint: "Permits, licenses, inspections, legal and design fees.", label: "Permits and fees" },
  initial_working_capital: { title: "How much cash for the first months?", hint: "Money to cover costs while sales build up.", label: "Cash for the first months" },
  reserve: { title: "How much do you want to keep in reserve?", hint: "Money you won’t touch for opening. If you leave this blank, we won’t treat it as $0.", label: "Money to keep in reserve" },
  fixed: { title: "What will the other monthly costs be?", hint: "Staff, utilities, insurance, everything except rent and food per order.", label: "Other monthly costs", suffix: "/ month" },
  margin: { title: "How much is left from each sale?", hint: "After food and other per-order costs, how many cents of each $1 do you keep?", label: "Cents kept per $1", prefix: "", suffix: "¢ per $1" },
};

export function CostWizard({ workspace, choice, stepIndex, onStep, onApply, onResults, onBack }: {
  workspace: Workspace;
  choice: BriefChoice;
  stepIndex: number;
  onStep: (index: number) => void;
  onApply: (inputs: DecisionFinanceInputs) => void;
  onResults: () => void;
  onBack: () => void;
}) {
  const steps = costSteps(choice);
  const key = steps[Math.min(stepIndex, steps.length - 1)];
  const inputs = choice.financeInputs;
  const [raw, setRaw] = useState(() => formatAmount(getValue(inputs, key)));
  const [error, setError] = useState("");
  const question = QUESTION[key];
  const candidate = choice.assessment.candidate;
  // Live workspaces carry estimates in workspace.rentEstimates; saved plans
  // carry the opted-in estimate in the choice's financeInputs.
  const estimate = choice.financeInputs.occupancyEstimate ?? workspace.rentEstimates.get(candidate.id) ?? null;
  const split = occupancyBreakdown(candidate, inputs.additionalOccupancyMonthly, inputs.occupancyEstimate?.monthly ?? null);
  const profileFunds = numberRequirement(workspace.requirements, "funds.totalAvailable");
  const profileReserve = numberRequirement(workspace.requirements, "funds.emergencyReserve");

  const commit = (value: number | null) => {
    const next = validate(setValue(inputs, key, value));
    if (!next.ok) { setError(next.message); return false; }
    onApply(next.inputs);
    return true;
  };
  const read = () => {
    const value = parseAmount(raw);
    if (Number.isNaN(value)) { setError("Enter a number, like 25,000."); return undefined; }
    return value;
  };
  const go = (target: "next" | "results") => {
    const value = read();
    if (value === undefined) return;
    // Unchanged values keep their provenance (e.g. an example margin stays labeled).
    if (value !== getValue(inputs, key) && !commit(value)) return;
    if (target === "results" || stepIndex >= steps.length - 1) onResults(); else onStep(stepIndex + 1);
  };
  const quick = (() => {
    if (key === "deposit" && split.baseRent && split.baseRent.high !== null && split.baseRent.low === split.baseRent.high)
      return { label: `Use 2 months of base rent (${money(split.baseRent.low * 2)})`, value: split.baseRent.low * 2, note: "Your estimate. Check the lease for the real deposit." };
    if (key === "margin") return { label: `Not sure? Try ${Math.round(ILLUSTRATIVE_VALUES.contributionMargin * 100)}¢ as an example`, value: null, note: "An example, not your number. Results using it are marked." };
    return null;
  })();
  const prefillTag = key === "funds" && inputs.totalFunds !== null && inputs.totalFunds === profileFunds ? "From your profile"
    : key === "reserve" && inputs.reserve !== null && inputs.reserve === profileReserve ? "From your profile"
    : key === "margin" && inputs.illustrative.includes("contributionMargin") ? "Example value" : null;

  return (
    <main className="sx-page">
      <QuestionShell step={stepIndex + 1} total={steps.length} title={question.title} hint={question.hint} onSubmit={() => go("next")}
        actions={<>
          <Back onClick={() => (stepIndex === 0 ? onBack() : onStep(stepIndex - 1))}>Back</Back>
          <span className="sx-spacer" />
          {stepIndex > 0 && <button type="button" className="sx-btn sx-btn-text" onClick={() => go("results")}>See results so far</button>}
          <button type="button" className="sx-btn sx-btn-text" onClick={() => (stepIndex >= steps.length - 1 ? onResults() : onStep(stepIndex + 1))}>Skip</button>
          <button className="sx-btn sx-btn-primary sx-btn-big">{stepIndex >= steps.length - 1 ? "See results" : "Next"}</button>
        </>}>
        {stepIndex === 0 && (
          <div className="sx-known">
            <span className="sx-strong">What we already know about {candidate.name}</span>
            <div className="sx-known-row"><span>Base rent</span><span className="sx-row" style={{ gap: 8 }}><span className="sx-strong">{rangeLabel(split.baseRent, "/mo") ?? "Not listed"}</span>{split.baseRent && (inputs.occupancyEstimate ? <Tag kind="estimate">Estimate</Tag> : <Tag kind="listing">From the listing</Tag>)}</span></div>
            {split.baseRent === null && estimate !== null && estimate.monthly !== null && (
              <div className="sx-known-row">
                <span>Estimated base rent</span>
                <span className="sx-row" style={{ gap: 8 }}>
                  <span className="sx-strong">{estimateCostLabel(estimate)}</span>
                  <Tag kind="estimate">Estimate</Tag>
                  <button type="button" className="sx-btn sx-btn-text" onClick={() => onApply({ ...inputs, occupancyEstimate: estimate })}>Use the estimate</button>
                </span>
              </div>
            )}
            {split.baseRent === null && estimate && (
              <p className="sx-small sx-muted">This is a market estimate from comparable listings, not this space’s price. It never changes the fit check.</p>
            )}
            <div className="sx-known-row"><span>Extra building charges</span><span className="sx-row" style={{ gap: 8 }}>
              <span className="sx-strong">{split.additional.status === "included_in_rent" ? "Included in rent" : split.additional.status === "known" ? `${money(split.additional.monthly ?? 0)}/mo` : "Unknown"}</span>
              <Tag kind={split.additional.status === "known" ? "owner" : split.additional.status === "included_in_rent" ? "listing" : "unknown"}>{split.additional.status === "known" ? "Your number" : split.additional.status === "included_in_rent" ? "From the listing" : "Not listed"}</Tag></span></div>
          </div>
        )}
        <MoneyInput label={question.label} value={raw} onChange={(value) => { setRaw(value); setError(""); }} prefix={question.prefix ?? "$"} suffix={question.suffix} autoFocus />
        {prefillTag && <p className="sx-prefill"><Tag kind={prefillTag === "Example value" ? "estimate" : "listing"}>{prefillTag}</Tag> You can change it.</p>}
        {quick && (
          <div className="sx-stack" style={{ gap: 4 }}>
            <div><button type="button" className="sx-btn sx-btn-text" style={{ paddingLeft: 0 }} onClick={() => {
              if (key === "margin") {
                const onlyMargin: DecisionFinanceInputs = { ...inputs, contributionMargin: ILLUSTRATIVE_VALUES.contributionMargin, illustrative: [...inputs.illustrative.filter((k) => k !== "contributionMargin"), "contributionMargin"] };
                const checked = validate(onlyMargin);
                if (checked.ok) { onApply(checked.inputs); setRaw(formatAmount(ILLUSTRATIVE_VALUES.contributionMargin * 100)); }
              } else if (quick.value !== null) setRaw(formatAmount(quick.value));
            }}>{quick.label}</button></div>
            <p className="sx-small sx-muted">{quick.note}</p>
          </div>
        )}
        {error && <p className="sx-error" role="alert">{error}</p>}
      </QuestionShell>
    </main>
  );
}

const NUMBER_ROWS: { key: CostKey | "averageSpend" | "operatingDays"; label: string; prefix?: string; suffix?: string }[] = [
  { key: "charges", label: "Extra building charges", suffix: "/mo" },
  { key: "fixed", label: "Other monthly costs", suffix: "/mo" },
  { key: "margin", label: "What’s left from each sale", prefix: "", suffix: "¢" },
  { key: "build_out", label: "Renovations" },
  { key: "equipment", label: "Equipment" },
  { key: "deposit", label: "Deposits" },
  { key: "fees", label: "Permits and fees" },
  { key: "initial_working_capital", label: "Cash for the first months" },
  { key: "funds", label: "Money you can spend" },
  { key: "reserve", label: "Money to keep in reserve" },
  { key: "averageSpend", label: "Average order" },
  { key: "operatingDays", label: "Days open each month", prefix: "", suffix: "days" },
];

export function CostResults({ workspace, choice, onEdit, onApply, onRecommend, onAsk, onBack, onReset }: {
  workspace: Workspace;
  choice: BriefChoice;
  onEdit: (key: CostKey) => void;
  onApply: (inputs: DecisionFinanceInputs) => void;
  onRecommend: () => void;
  onAsk: () => void;
  onBack: () => void;
  onReset: () => void;
}) {
  const inputs = choice.financeInputs;
  const result = choice.financeResults;
  const candidate = choice.assessment.candidate;
  const cap = budgetCap(workspace.requirements);
  const split = occupancyBreakdown(candidate, inputs.additionalOccupancyMonthly, inputs.occupancyEstimate?.monthly ?? null);
  const included = split.additional.status === "included_in_rent";
  const missingUpfront = upfrontCategories.filter((category) => upfrontAmount(inputs, category) === null);
  const profileFunds = numberRequirement(workspace.requirements, "funds.totalAvailable");
  const profileReserve = numberRequirement(workspace.requirements, "funds.emergencyReserve");
  const illustrative = new Set<string>(inputs.illustrative);

  const read = (key: (typeof NUMBER_ROWS)[number]["key"]): number | null => key === "averageSpend" ? inputs.averageSpend : key === "operatingDays" ? inputs.operatingDays : getValue(inputs, key);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(NUMBER_ROWS.map((row) => [row.key, formatAmount(read(row.key))])));
  const [error, setError] = useState("");
  const tagFor = (key: (typeof NUMBER_ROWS)[number]["key"]): { kind: TagKind; text: string } => {
    const value = read(key);
    const illustrativeKey = key === "margin" ? "contributionMargin" : key;
    if (illustrative.has(illustrativeKey)) return { kind: "estimate", text: "Example value" };
    if (value === null) return { kind: "unknown", text: "Unknown" };
    if (key === "funds" && value === profileFunds) return { kind: "listing", text: "From your profile" };
    if (key === "reserve" && value === profileReserve) return { kind: "listing", text: "From your profile" };
    return { kind: "owner", text: "Your number" };
  };
  const applyDraft = () => {
    let next = inputs;
    for (const row of NUMBER_ROWS) {
      if (row.key === "charges" && included) continue;
      const value = parseAmount(draft[row.key] ?? "");
      if (Number.isNaN(value)) { setError(`Check “${row.label}”.`); return; }
      if (value === read(row.key)) continue;
      if (row.key === "averageSpend") next = { ...next, averageSpend: value === 0 ? null : value, illustrative: next.illustrative.filter((k) => k !== "averageSpend") };
      else if (row.key === "operatingDays") next = { ...next, operatingDays: value === 0 ? null : value, illustrative: next.illustrative.filter((k) => k !== "operatingDays") };
      else next = setValue(next, row.key, value);
    }
    const checked = validate(next);
    if (!checked.ok) { setError(checked.message); return; }
    setError("");
    onApply(checked.inputs);
  };
  const fillExamples = () => {
    const next = applyIllustrative(inputs);
    onApply(next);
    setDraft((old) => ({ ...old, margin: formatAmount(getValue(next, "margin")), averageSpend: formatAmount(next.averageSpend), operatingDays: formatAmount(next.operatingDays) }));
  };

  const occupancyText = result.occupancy ? (result.occupancy.high === null ? `${money(result.occupancy.low)}+` : rangeLabel(result.occupancy) ?? "") : null;
  // An estimate-derived budget line is always labeled as an estimate; it can
  // never read like a plain verified "under your budget".
  const budgetDelta = result.occupancy && result.occupancy.high !== null && cap !== null
    ? `${result.occupancy.high <= cap ? money(cap - result.occupancy.high) : money(result.occupancy.high - cap)} ${result.occupancy.high <= cap ? "under" : "over"} your budget`
    : null;
  const budgetLine = budgetDelta === null ? null : inputs.occupancyEstimate ? `≈ ${budgetDelta} (estimate)` : budgetDelta;
  const value = (n: number | null) => n === null ? "unknown" : money(n);
  const sensitivityLabels: Record<string, string> = { "0.8": "Monthly costs 20% lower", "1": "Monthly costs as entered", "1.2": "Monthly costs 20% higher" };

  return (
    <main className="sx-page sx-wide">
      <Back onClick={onBack}>Change answers</Back>
      <div className="sx-stack">
        <h1 className="sx-title">What opening {candidate.name} would take</h1>
        <p className="sx-muted">{placeSubtitle(candidate)}</p>
      </div>
      {inputs.illustrative.length > 0 && <p className="sx-notice sx-small">Some results use example values, not your numbers. Replace them in “Your numbers” before you rely on them.</p>}

      <div className="sx-results">
        <section className="sx-result" aria-label="Money needed to open">
          <span className="sx-muted">Money needed to open</span>
          {result.completeUpfront !== null ? <>
            <span className="sx-result-value">{money(result.completeUpfront)}</span>
            <span className="sx-small">{result.openingFundsRemaining !== null ? result.openingFundsRemaining >= 0 ? `You’d have ${money(result.openingFundsRemaining)} left after your reserve` : `You’d be ${money(-result.openingFundsRemaining)} short after your reserve` : "Add your reserve to see what’s left"}</span>
            {result.openingFundsRemaining === null && <button type="button" className="sx-chip" onClick={() => onEdit("reserve")}>Add your reserve</button>}
          </> : <>
            <span className="sx-result-missing">Add these to work it out:</span>
            {missingUpfront.map((category) => <button key={category} type="button" className="sx-chip" onClick={() => onEdit(category)}>{ADD_LABEL[category]}</button>)}
          </>}
        </section>
        <section className="sx-result" aria-label="Monthly rent cost">
          <span className="sx-muted">Monthly rent cost</span>
          {occupancyText ? <span className="sx-result-value">{occupancyText}</span> : <span className="sx-result-missing">Can’t work out from the listing</span>}
          {result.occupancy?.high === null && <><span className="sx-small">Extra building charges aren’t known yet</span><button type="button" className="sx-chip" onClick={() => onEdit("charges")}>Add extra building charges</button></>}
          {budgetLine && <span className="sx-small">{budgetLine}</span>}
          {result.occupancy && (
            <Tag kind={inputs.occupancyEstimate ? "estimate" : inputs.additionalOccupancyMonthly !== null && !included ? "owner" : "listing"}>
              {inputs.occupancyEstimate
                ? inputs.additionalOccupancyMonthly !== null && !included ? "Estimate + your number" : "Estimate"
                : inputs.additionalOccupancyMonthly !== null && !included ? "Listing + your number" : "From the listing"}
            </Tag>
          )}
        </section>
        <section className="sx-result" aria-label="Sales needed each month">
          <span className="sx-muted">Sales needed each month</span>
          {result.requiredSales ? <>
            <span className="sx-result-value">{result.requiredSales.high === null ? `${money(result.requiredSales.low)}+` : rangeLabel(result.requiredSales)}</span>
            {result.guestsPerDay ? <span className="sx-small">About {Math.ceil(result.guestsPerDay.low)}{result.guestsPerDay.high !== null && Math.ceil(result.guestsPerDay.high) !== Math.ceil(result.guestsPerDay.low) ? `–${Math.ceil(result.guestsPerDay.high)}` : ""} orders a day to break even</span> : <span className="sx-small">Add average order and days open to see orders a day</span>}
            <span className="sx-small sx-muted">A break-even line, not a sales forecast.</span>
          </> : <>
            <span className="sx-result-missing">Add these to work it out:</span>
            {inputs.fixedCostsMonthly === null && <button type="button" className="sx-chip" onClick={() => onEdit("fixed")}>Add other monthly costs</button>}
            {inputs.contributionMargin === null && <button type="button" className="sx-chip" onClick={() => onEdit("margin")}>Add what’s left from each sale</button>}
            {result.occupancy === null && <span className="sx-small">The rent needs to be known first.</span>}
          </>}
        </section>
      </div>

      <div className="sx-row">
        <button type="button" className="sx-btn sx-btn-primary sx-btn-big" onClick={onRecommend}>See our recommendation</button>
        <AskButton onClick={onAsk} />
      </div>

      <div>
        <Disclosure title="Your numbers" hint="Edit, or see where each came from">
          <ul className="sx-inputs">
            <li><span>Base rent</span><span className="sx-strong">{rangeLabel(split.baseRent, "/mo") ?? "Not listed"}</span>{inputs.occupancyEstimate ? <Tag kind="estimate">Estimate</Tag> : <Tag kind="listing">From the listing</Tag>}</li>
            {NUMBER_ROWS.filter((row) => !(row.key === "charges" && included)).map((row) => {
              const tag = tagFor(row.key);
              return (
                <li key={row.key}>
                  <span>{row.label}</span>
                  <MoneyInput small label={row.label} value={draft[row.key] ?? ""} onChange={(v) => setDraft((old) => ({ ...old, [row.key]: v }))} prefix={row.prefix ?? "$"} suffix={row.suffix} />
                  <Tag kind={tag.kind}>{tag.text}</Tag>
                </li>
              );
            })}
            {included && <li><span>Extra building charges</span><span className="sx-strong">Included in rent</span><Tag kind="listing">From the listing</Tag></li>}
          </ul>
          {error && <p className="sx-error" role="alert">{error}</p>}
          <div className="sx-row">
            <button type="button" className="sx-btn sx-btn-primary" onClick={applyDraft}>Update results</button>
            <button type="button" className="sx-btn sx-btn-text" onClick={fillExamples}>Fill blanks with example values</button>
            <button type="button" className="sx-btn sx-btn-text" onClick={onReset}>Start over from the listing</button>
          </div>
          <p className="sx-small sx-muted">Example values only fill what’s left from each sale ({Math.round(ILLUSTRATIVE_VALUES.contributionMargin * 100)}¢), average order (${ILLUSTRATIVE_VALUES.averageSpend}) and days open ({ILLUSTRATIVE_VALUES.operatingDays}). They are never your costs or funds.</p>
        </Disclosure>

        <Disclosure title="How we calculated">
          <div className="sx-calc"><span className="sx-strong">Monthly rent cost</span>
            <span>Base rent {rangeLabel(split.baseRent) ?? "unknown"}{inputs.occupancyEstimate ? " (estimate)" : ""} + extra charges {included ? "(included in rent)" : value(inputs.additionalOccupancyMonthly)}</span>
            <span>= {occupancyText ?? "unknown"}</span></div>
          <div className="sx-calc"><span className="sx-strong">Sales needed each month</span>
            <span>(Rent cost + other monthly costs {value(inputs.fixedCostsMonthly)}) ÷ {inputs.contributionMargin === null ? "?" : `${Math.round(inputs.contributionMargin * 100)}`}¢ kept per $1</span>
            <span>= {rangeLabel(result.requiredSales) ?? "unknown"}</span></div>
          <div className="sx-calc"><span className="sx-strong">Money needed to open</span>
            <span>{upfrontCategories.map((category) => `${UPFRONT_LABEL[category].toLowerCase()} ${value(upfrontAmount(inputs, category))}`).join(" + ")}</span>
            <span>= {result.completeUpfront === null ? `unknown (known so far ${money(result.knownUpfront)})` : money(result.completeUpfront)}</span></div>
          <div className="sx-calc"><span className="sx-strong">Left over or short</span>
            <span>(Money you can spend {value(inputs.totalFunds)} − reserve {value(inputs.reserve)}) − money to open</span>
            <span>= {result.openingFundsRemaining === null ? "unknown" : money(result.openingFundsRemaining)}</span></div>
          {result.gaps.length > 0 && <ul className="sx-small sx-muted">{result.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>}
          <p className="sx-small sx-muted">Nothing is filled in for you: a result only appears when every number behind it exists. Rent is a monthly cost, never part of the money to open. Calculation {result.modelVersion}.</p>
        </Disclosure>

        <Disclosure title="If rent or monthly costs change" last>
          {result.sensitivity.some((point) => point.requiredSales) ? (
            <ul className="sx-list">
              {result.sensitivity.map((point) => (
                <li key={point.fixedCostMultiplier}><span className="sx-list-main"><span className="sx-list-label">{sensitivityLabels[String(point.fixedCostMultiplier)] ?? `${point.fixedCostMultiplier}×`}</span><span className="sx-list-value">{rangeLabel(point.requiredSales) ?? "unknown"} in sales a month</span></span></li>
              ))}
            </ul>
          ) : <p className="sx-muted">Add your monthly costs and what’s left from each sale first.</p>}
          <p className="sx-small sx-muted">This only shifts your monthly costs up or down. It doesn’t predict sales.</p>
        </Disclosure>
      </div>
    </main>
  );
}
