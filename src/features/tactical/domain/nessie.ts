import { z } from "zod";

// The published schema documents legacy 24-hex IDs; the live service also returns UUIDs.
export const nessieIdSchema = z.union([z.string().regex(/^[a-f0-9]{24}$/i), z.uuid()]);
const id = nessieIdSchema;
const dollars = z.number().finite().nonnegative().max(1_000_000_000);
export const nessieAccountSchema = z.object({ _id: id, type: z.enum(["Checking", "Savings", "Credit Card"]), nickname: z.string().max(200), balance: dollars });
export const nessieTransactionSchema = z.object({ _id: id, amount: dollars, transaction_date: z.iso.date(), status: z.enum(["pending", "cancelled", "completed", "recurring"]), description: z.string().max(2000).default("") });
export const nessieSnapshotSchema = z.object({
  source: z.enum(["demo", "nessie-sandbox"]), fetchedAt: z.iso.datetime(), account: nessieAccountSchema,
  deposits: z.array(nessieTransactionSchema).max(2000), withdrawals: z.array(nessieTransactionSchema).max(2000),
}).superRefine((value, ctx) => {
  for (const kind of ["deposits", "withdrawals"] as const) {
    if (new Set(value[kind].map(row => row._id)).size !== value[kind].length) ctx.addIssue({ code: "custom", path: [kind], message: "Duplicate transaction IDs" });
  }
});
export type NessieSnapshot = z.infer<typeof nessieSnapshotSchema>;
export const cashPlanSchema = z.object({ investmentCents: z.number().int().min(0).max(100_000_000_000), reserveCents: z.number().int().min(0).max(100_000_000_000), monthlyBurnCents: z.number().int().min(0).max(100_000_000_000) });
export const usdCents = (value: number) => Math.round(dollars.parse(value) * 100);
export function cashPlan(snapshot: NessieSnapshot, input: z.infer<typeof cashPlanSchema>) {
  const data = nessieSnapshotSchema.parse(snapshot); const assumptions = cashPlanSchema.parse(input);
  // Credit balances are debt/credit, not spendable restaurant cash.
  if (data.account.type === "Credit Card") return null;
  const balanceCents = usdCents(data.account.balance);
  const remainingCents = balanceCents - assumptions.investmentCents;
  const cushionCents = remainingCents - assumptions.reserveCents;
  return { balanceCents, remainingCents, cushionCents, runwayMonths: assumptions.monthlyBurnCents > 0 ? Math.max(0, cushionCents) / assumptions.monthlyBurnCents : null };
}
export function nessieFlows(snapshot: NessieSnapshot) {
  const data = nessieSnapshotSchema.parse(snapshot);
  const total = (rows: NessieSnapshot["deposits"]) => rows.filter(row => row.status === "completed").reduce((sum, row) => sum + usdCents(row.amount), 0);
  const depositCents = total(data.deposits); const withdrawalCents = total(data.withdrawals);
  return { depositCents, withdrawalCents, netCents: depositCents - withdrawalCents, excluded: [...data.deposits, ...data.withdrawals].filter(row => row.status !== "completed").length };
}
