import { z } from "zod";
import type { Dataset } from "./dataset.ts";
import { buildFinanceReport } from "./finance-report.ts";
import { nessieIdSchema, nessieSnapshotSchema, usdCents } from "./nessie.ts";

const cents = z.number().int().min(0).max(100_000_000_000);
const signedCents = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
const id = z.string().min(1).max(120);
export const nessieBillSchema = z.object({
  _id: nessieIdSchema, account_id: nessieIdSchema, status: z.enum(["pending", "cancelled", "completed", "recurring"]),
  payee: z.string().min(1).max(500), nickname: z.string().max(500).optional(),
  payment_amount: z.number().nonnegative().max(1_000_000_000),
  payment_date: z.iso.date().nullish(), upcoming_payment_date: z.iso.date().nullish(), recurring_date: z.number().int().min(1).max(31).nullish(),
});
export const cashBankSchema = nessieSnapshotSchema.safeExtend({ bills: z.array(nessieBillSchema).max(2000) }).superRefine((bank,ctx) => {
  if (bank.bills.some(bill=>bill.account_id!==bank.account._id) || new Set(bank.bills.map(bill=>bill._id)).size!==bank.bills.length) ctx.addIssue({code:"custom",message:"Bills must be unique and belong to the account."});
});
export type CashBank = z.infer<typeof cashBankSchema>;
export const cashObligationSchema = z.object({
  id, label:z.string().trim().min(1).max(120), nextDate:z.iso.date(), cadence:z.enum(["once","weekly","monthly"]),
  basis:z.enum(["fixed","payroll","inventory"]), amountCents:cents,
  inventoryLines:z.array(z.object({inventoryId:id,quantity:z.number().positive().max(10000)})).max(100),
  bankBillId:nessieIdSchema.nullable().default(null), enabled:z.boolean(),
}).superRefine((row,ctx)=>{
  if (row.basis==="inventory" && (!row.inventoryLines.length || new Set(row.inventoryLines.map(line=>line.inventoryId)).size!==row.inventoryLines.length)) ctx.addIssue({code:"custom",message:"Restocking needs unique inventory items."});
});
export const cashConfigSchema = z.object({
  reserveCents:cents, payoutScale:z.number().min(0).max(2), payoutLagDays:z.number().int().min(0).max(14),
  payrollLoadFraction:z.number().min(0).max(1),
  obligations:z.array(cashObligationSchema).max(80),
}).superRefine((config,ctx)=>{
  if (new Set(config.obligations.map(row=>row.id)).size!==config.obligations.length) ctx.addIssue({code:"custom",message:"Duplicate obligations."});
  const linked=config.obligations.flatMap(row=>row.bankBillId?[row.bankBillId]:[]);
  if (new Set(linked).size!==linked.length) ctx.addIssue({code:"custom",message:"Each bank bill may match only one obligation."});
});
export type CashConfig = z.infer<typeof cashConfigSchema>;
export const cashCalendarSchema = z.object({version:z.literal(1), description:z.string().min(1).max(1200), bank:cashBankSchema, config:cashConfigSchema});
export const cashInputsSchema=z.object({weeklyBasePayrollCents:cents, dailyNetSalesCents:cents.nullable(), salesPeriod:z.string().max(100), inventory:z.array(z.object({id,name:z.string(),unit:z.string(),unitCostCents:cents})).max(500)});
export type CashInputs=z.infer<typeof cashInputsSchema>;
export function cashInputs(dataset:Dataset):CashInputs {
  const report=buildFinanceReport(dataset);
  return cashInputsSchema.parse({weeklyBasePayrollCents:Math.round(dataset.operations.employees.reduce((sum,row)=>sum+row.hoursThisWeek*row.hourlyRateCents,0)),dailyNetSalesCents:report?Math.round((report.revenueCents-report.delivery.feesCents)/report.days):null,salesPeriod:report?`${report.source.startDate} – ${report.source.endDate}`:"Unavailable",inventory:dataset.operations.inventory.map(({id,name,unit,unitCostCents})=>({id,name,unit,unitCostCents}))});
}
export function addDays(date:string,days:number){ const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10); }
export function monthDate(month:string,day:number){const [year,m]=month.split("-").map(Number);const last=new Date(Date.UTC(year,m,0)).getUTCDate();return `${month}-${String(Math.min(day,last)).padStart(2,"0")}`;}
function dates(nextDate:string,cadence:"once"|"weekly"|"monthly",start:string,end:string,monthlyDay=Number(nextDate.slice(8))){
  const rows:string[]=[];
  for(let date=start;date<=end;date=addDays(date,1)){
    if(date<nextDate)continue;
    if(cadence==="once"?date===nextDate:cadence==="weekly"?(Date.parse(date)-Date.parse(nextDate))%604800000===0:date===monthDate(date.slice(0,7),monthlyDay))rows.push(date);
  }
  return rows;
}
export const cashEventSchema=z.object({id,date:z.iso.date(),label:z.string(),amountCents:signedCents,source:z.enum(["payout","payroll","inventory","plan","nessie-bill"]),status:z.enum(["estimated","scheduled"]),detail:z.string(),sourceId:id});
export type CashEvent=z.infer<typeof cashEventSchema>;
export function obligationAmount(row:CashConfig["obligations"][number],inputs:CashInputs,load:number){
  if(row.basis==="payroll")return Math.round(inputs.weeklyBasePayrollCents*(1+load));
  if(row.basis==="inventory")return Math.round(row.inventoryLines.reduce((sum,line)=>{const item=inputs.inventory.find(item=>item.id===line.inventoryId);if(!item)throw new Error("Unknown inventory item");return sum+line.quantity*item.unitCostCents;},0));
  return row.amountCents;
}
export function forecastCash(bankValue:CashBank,configValue:CashConfig,inputsValue:CashInputs){
  const bank=cashBankSchema.parse(bankValue), config=cashConfigSchema.parse(configValue), inputs=cashInputsSchema.parse(inputsValue);
  if(bank.account.type==="Credit Card")throw new Error("Credit-card balances are not spendable cash.");
  const asOf=bank.fetchedAt.slice(0,10),start=addDays(asOf,1),end=addDays(start,89),events:CashEvent[]=[],warnings:string[]=[];
  const bankIds=new Set(bank.bills.map(row=>row._id));
  for(const row of config.obligations){
    if(!row.enabled)continue;
    if(row.bankBillId){
      if(!bankIds.has(row.bankBillId))throw new Error("A matched bank bill is missing. Unmatch it or refresh before forecasting.");
      continue; // explicit identity match, including completed/cancelled bills
    }
    const amount=obligationAmount(row,inputs,config.payrollLoadFraction);
    for(const date of dates(row.nextDate,row.cadence,start,end))events.push({id:`plan:${row.id}:${date}`,date,label:row.label,amountCents:-amount,source:row.basis==="fixed"?"plan":row.basis,status:"estimated",sourceId:row.id,detail:row.basis==="payroll"?"Repeats the supplied weekly HR base pay, plus the assumed payroll load. Not an actual payroll statement.":row.basis==="inventory"?"Selected quantities × Supply unit costs. Planning only; no order is placed.":"Owner-editable planned payment; not a bank transaction."});
  }
  for(const bill of bank.bills){
    if(!["pending","recurring"].includes(bill.status))continue;
    const next=bill.upcoming_payment_date??bill.payment_date;
    const recurring=bill.status==="recurring" && bill.recurring_date!=null;
    if(!next&&!recurring){warnings.push(`No usable payment date for ${bill.nickname||bill.payee}; excluded.`);continue;}
    if(!recurring&&next!<=asOf){warnings.push(`Overdue or same-day bill ${bill.nickname||bill.payee} is excluded; confirm whether it is already paid.`);continue;}
    const scheduled=dates(next??start,recurring?"monthly":"once",start,end,bill.recurring_date??Number(next?.slice(8)));
    // The explicit upcoming payment is authoritative; recur from the following month.
    const occurrences=recurring&&next&&next>=start ? [...(next<=end?[next]:[]),...scheduled.filter(date=>date.slice(0,7)>next.slice(0,7))] : scheduled;
    for(const date of occurrences)events.push({id:`bill:${bill._id}:${date}`,date,label:bill.nickname||bill.payee,amountCents:-usdCents(bill.payment_amount),source:"nessie-bill",status:"scheduled",sourceId:bill._id,detail:"Scheduled sandbox bill. Not a completed payment; recurring dates clamp to month end."});
  }
  if(inputs.dailyNetSalesCents===null)warnings.push("No dated sales report: expected payouts are unavailable.");
  else if(config.payoutScale>0 && inputs.dailyNetSalesCents>0) for(let earned=start;earned<=end;earned=addDays(earned,1)){
    const date=addDays(earned,config.payoutLagDays);if(date>end)break;
    events.push({id:`payout:${earned}`,date,label:"Sales payout",amountCents:Math.round(inputs.dailyNetSalesCents*config.payoutScale),source:"payout",status:"estimated",sourceId:"finance-report",detail:`Assumed daily receipts from ${inputs.salesPeriod}, net of supplied app commission; scaled to ${(config.payoutScale*100).toFixed(0)}%, delayed ${config.payoutLagDays} days. No historical receivables assumed.`});
  }
  events.sort((a,b)=>a.date.localeCompare(b.date)||a.amountCents-b.amountCents||a.id.localeCompare(b.id));
  let balance=usdCents(bank.account.balance);
  const days=[];
  for(let date=start;date<=end;date=addDays(date,1)){
    const rows=events.filter(row=>row.date===date),openingCents=balance,incomingCents=rows.reduce((sum,row)=>sum+Math.max(0,row.amountCents),0),outgoingCents=rows.reduce((sum,row)=>sum-Math.min(0,row.amountCents),0);
    balance+=incomingCents-outgoingCents;
    if(!Number.isSafeInteger(balance)||Math.abs(balance)>1_000_000_000_000)throw new Error("Forecast exceeds supported limits");
    days.push({date,openingCents,incomingCents,outgoingCents,closingCents:balance,status:balance<0?"red" as const:balance<config.reserveCents?"yellow" as const:"green" as const,events:rows});
  }
  const lowest=days.reduce((low,day)=>day.closingCents<low.closingCents?day:low,days[0]);
  return {modelVersion:"cash-v1" as const,asOf,start,end,balanceCents:usdCents(bank.account.balance),days,lowest,cushionCents:lowest.closingCents-config.reserveCents,warnings};
}
export type CashForecast=ReturnType<typeof forecastCash>;
export const savedCashSchema=z.object({id:z.uuid(),restaurantId:id,name:z.string().trim().min(1).max(80),savedAt:z.iso.datetime(),datasetHash:z.string().min(1).max(100),modelVersion:z.literal("cash-v1"),bankSnapshotId:id,bank:cashBankSchema,config:cashConfigSchema,inputs:cashInputsSchema});
export type SavedCash=z.infer<typeof savedCashSchema>;
