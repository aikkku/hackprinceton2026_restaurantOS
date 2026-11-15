import assert from "node:assert/strict";
import test from "node:test";
import { financeInputsFromBaseline, requiredSalesMonthly } from "./domain/scenario.ts";
import { exampleIntake } from "./frontend/data/intake-example.ts";
import { MOCK_FINANCE_SOURCE_ID, usesMockFinance, withMockFinance } from "./frontend/data/mock-finance.ts";

test("mock finance supplies a labeled synthetic monthly baseline without changing the saved intake", () => {
  const original = exampleIntake();
  original.isDemo = false;
  const before = structuredClone(original);
  const mock = withMockFinance(original);
  assert.deepEqual(original, before);
  assert.equal(original.financialBaseline.origin, "unavailable");
  assert.equal(mock.isDemo, true);
  assert.equal(mock.origin, "simulated_finance");
  assert.equal(usesMockFinance(mock), true);
  assert.match(mock.sourceAnswers.find((answer) => answer.id === MOCK_FINANCE_SOURCE_ID)!.answer, /MOCK DATA, not an owner answer/);
  assert.deepEqual(mock.budget, original.budget);
  assert.deepEqual(mock.space, original.space);
  assert.deepEqual(withMockFinance(mock), mock);
  assert.equal(mock.followUpQuestions.some((question) => question.field === "financialBaseline"), false);
});

test("mock baseline goes through canonical TypeScript calculations: $16,000 / 40% = $40,000 before occupancy", () => {
  const inputs = financeInputsFromBaseline(withMockFinance(exampleIntake()).financialBaseline);
  assert.deepEqual(inputs, { fixedCostsMonthly: 16000, contributionMargin: 0.4, origin: "derived", reasons: [] });
  assert.deepEqual(requiredSalesMonthly({ fixedCostsMonthly: inputs.fixedCostsMonthly!, contributionMargin: inputs.contributionMargin! }), {
    status: "available", requiredSalesMonthly: 40000,
  });
});

test("mock adapter preserves an existing or partially supplied financial baseline", () => {
  const actual = exampleIntake();
  actual.isDemo = false;
  actual.financialBaseline = { ...withMockFinance(exampleIntake()).financialBaseline, sourceAnswerIds: [], netSales: 12345 };
  assert.deepEqual(withMockFinance(actual), actual);
  assert.equal(usesMockFinance(withMockFinance(actual)), false);
  const partial = exampleIntake();
  partial.financialBaseline.fixedLaborCosts = 1000;
  assert.deepEqual(withMockFinance(partial), partial);
});
