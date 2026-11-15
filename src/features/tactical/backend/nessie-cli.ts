import { readFile } from "node:fs/promises";
import { z } from "zod";
import { readNessie, nessieBaseUrl } from "./adapters/nessie.ts";
import { nessieIdSchema, nessieSnapshotSchema } from "../domain/nessie.ts";

// Explicit opt-in sandbox creation only. Never modifies or deletes an existing record.
// Run one seed process at a time: Nessie does not expose idempotency keys.
async function seed() {
  const key = process.env.NESSIE_API_KEY;
  if (!key) throw new Error("Set NESSIE_API_KEY in ignored .env.local");
  const request = async (path: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(`${nessieBaseUrl}${path}?key=${encodeURIComponent(key)}`, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Nessie sandbox ${body ? "creation" : "read"} failed (HTTP ${response.status}). Retry only after inspecting existing records.`); }
    return response.json();
  };
  const sample = nessieSnapshotSchema.parse(JSON.parse(await readFile(new URL("../frontend/data/demo-nessie.json", import.meta.url), "utf8")));
  const customerInput = JSON.parse(await readFile(new URL("../frontend/data/demo-nessie-customer.json", import.meta.url), "utf8"));
  const customersSchema = z.array(z.object({ _id: nessieIdSchema, first_name: z.string(), last_name: z.string() }));
  const customers = () => request("/customers").then(value => customersSchema.parse(value));
  let matches = (await customers()).filter(item => item.first_name === customerInput.first_name && item.last_name === customerInput.last_name);
  if (!matches.length) { await request("/customers", customerInput); matches = (await customers()).filter(item => item.first_name === customerInput.first_name && item.last_name === customerInput.last_name); }
  if (matches.length !== 1) throw new Error("Ambiguous demo customer; inspect sandbox before continuing.");
  const path = `/customers/${matches[0]._id}/accounts`;
  const accountsSchema = z.array(z.object({ _id: nessieIdSchema, nickname: z.string() }));
  const accounts = () => request(path).then(value => accountsSchema.parse(value));
  let found = (await accounts()).filter(item => item.nickname === sample.account.nickname);
  if (!found.length) { await request(path, { type: sample.account.type, nickname: sample.account.nickname, rewards: 0, balance: sample.account.balance }); found = (await accounts()).filter(item => item.nickname === sample.account.nickname); }
  if (found.length !== 1) throw new Error("Ambiguous demo account; inspect sandbox before continuing.");
  const accountId = found[0]._id;
  for (const kind of ["deposits", "withdrawals"] as const) {
    const endpoint = `/accounts/${accountId}/${kind}`;
    const existing = z.array(z.object({ description: z.string() })).parse(await request(endpoint));
    for (const row of sample[kind]) {
      if (existing.some(item => item.description === row.description)) continue;
      await request(endpoint, { medium: "balance", amount: row.amount, transaction_date: row.transaction_date, status: row.status, description: row.description });
    }
  }
  const snapshot = await readNessie({ accountId });
  console.log(JSON.stringify({ ok: true, source: snapshot.source, accountId, deposits: snapshot.deposits.length, withdrawals: snapshot.withdrawals.length, instruction: "Set NESSIE_ACCOUNT_ID in ignored .env.local and restart the app." }));
}
try {
  if (process.argv[2] === "--seed-demo") await seed();
  else if (process.argv[2] === "check") { const data = await readNessie(); console.log(JSON.stringify({ ok: true, source: data.source, accountId: data.account._id, deposits: data.deposits.length, withdrawals: data.withdrawals.length, fetchedAt: data.fetchedAt })); }
  else throw new Error("Usage: nessie-cli.ts check | --seed-demo");
} catch { console.error("Nessie command failed. Check configuration and existing sandbox records; no secret or provider response was logged."); process.exitCode = 1; }
