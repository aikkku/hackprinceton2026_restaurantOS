import { cashBankSchema, nessieBillSchema } from "../../domain/cash-calendar.ts";
import { nessieAccountSchema, nessieIdSchema, nessieSnapshotSchema, nessieTransactionSchema } from "../../domain/nessie.ts";

export const nessieBaseUrl = "https://prod-api.nessieisreal.com";
// Fixed HTTPS host; no user-controlled URLs, no redirects, no URL/error logging (key is a query parameter).
export async function readNessie({ key = process.env.NESSIE_API_KEY, accountId = process.env.NESSIE_ACCOUNT_ID, fetcher = fetch, signal }: { key?: string; accountId?: string; fetcher?: typeof fetch; signal?: AbortSignal } = {}) {
  if (!key || !nessieIdSchema.safeParse(accountId).success) throw new Error("Nessie configuration unavailable");
  const get = async (path: string) => {
    const response = await fetcher(`${nessieBaseUrl}${path}?key=${encodeURIComponent(key)}`, { cache: "no-store", redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(12_000), ...(signal ? [signal] : [])]) });
    if (!response.ok) { await response.body?.cancel(); throw new Error("Nessie unavailable"); }
    if (!response.body) throw new Error("Nessie response unavailable");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 2_000_000) { await reader.cancel(); throw new Error("Nessie response too large"); } chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  };
  const path = `/accounts/${accountId}`;
  const results = await Promise.all([get(path), get(`${path}/deposits`), get(`${path}/withdrawals`)]);
  const account = nessieAccountSchema.parse(results[0]);
  if (account._id !== accountId) throw new Error("Account mismatch");
  return nessieSnapshotSchema.parse({ source: "nessie-sandbox", fetchedAt: new Date().toISOString(), account, deposits: nessieTransactionSchema.array().max(2000).parse(results[1]), withdrawals: nessieTransactionSchema.array().max(2000).parse(results[2]) });
}


// The calendar adds scheduled bills without changing the existing investment tool contract.
export async function readNessieCash(options: Parameters<typeof readNessie>[0] = {}) {
  const snapshot = await readNessie(options);
  const key = options.key ?? process.env.NESSIE_API_KEY;
  const response = await (options.fetcher ?? fetch)(`${nessieBaseUrl}/accounts/${snapshot.account._id}/bills?key=${encodeURIComponent(key!)}`, {
    cache:"no-store", redirect:"error", signal:AbortSignal.any([AbortSignal.timeout(12_000), ...(options.signal?[options.signal]:[])])
  });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("Nessie bills unavailable"); }
  const reader=response.body.getReader(), chunks:Uint8Array[]=[]; let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000){await reader.cancel();throw new Error("Nessie bills too large");}chunks.push(value);}
  const bills=nessieBillSchema.array().max(2000).parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  return cashBankSchema.parse({...snapshot,bills});
}
