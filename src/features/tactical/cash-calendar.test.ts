import test from "node:test";
import assert from "node:assert/strict";
import demo from "./frontend/data/demo-restaurant.json" with {type:"json"};
import {datasetSchema} from "./domain/dataset.ts";
import {addDays,cashBankSchema,cashConfigSchema,cashInputs,forecastCash,monthDate,savedCashSchema} from "./domain/cash-calendar.ts";
import {createCashHandler,memoryCashStore} from "./backend/cash-calendar-service.ts";
import {readNessieCash} from "./backend/adapters/nessie.ts";
const dataset=datasetSchema.parse(demo),setup=dataset.operations.cashCalendar!,inputs=cashInputs(dataset),bank=setup.bank;
const empty={...setup.config,payoutScale:0,obligations:[]};
const request=(body:unknown,origin="http://localhost")=>new Request("http://localhost/api/tactical/cash-calendar",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
const bill=(changes={})=>({...bank.bills[0],...changes});

test("cash calendar anchors to bank balance, excludes historical flows and reconciles every day",()=>{
  const result=forecastCash(bank,setup.config,inputs);
  assert.equal(result.days.length,90);assert.equal(result.start,"2026-11-16");assert.equal(result.days[0].openingCents,2500000);
  assert.ok(result.days.some(row=>row.status!=="green"));
  result.days.forEach((row,i)=>{assert.equal(row.closingCents,row.openingCents+row.incomingCents-row.outgoingCents);if(i)assert.equal(row.openingCents,result.days[i-1].closingCents);assert.equal(row.status,row.closingCents<0?"red":row.closingCents<setup.config.reserveCents?"yellow":"green");});
  const changed=structuredClone(bank);changed.deposits[0].amount=99999;changed.withdrawals[0].amount=99999;
  assert.deepEqual(forecastCash(changed,setup.config,inputs),result);
});
test("HR payroll and Supply costs share canonical inputs while payout lag excludes historical receivables",()=>{
  const result=forecastCash(bank,setup.config,inputs),payroll=result.days.flatMap(day=>day.events).find(row=>row.source==="payroll")!;
  assert.equal(-payroll.amountCents,Math.round(inputs.weeklyBasePayrollCents*(1+setup.config.payrollLoadFraction)));
  assert.equal(result.days[0].incomingCents,0);assert.equal(result.days[1].incomingCents,0);
  assert.equal(result.days[2].incomingCents,Math.round(inputs.dailyNetSalesCents!*.5));
  const doubled={...inputs,weeklyBasePayrollCents:inputs.weeklyBasePayrollCents*2,inventory:inputs.inventory.map(row=>({...row,unitCostCents:row.unitCostCents*2}))};
  const changed=forecastCash(bank,setup.config,doubled).days.flatMap(day=>day.events);
  assert.equal(changed.find(row=>row.source==="payroll")!.amountCents,payroll.amountCents*2);
  assert.equal(changed.find(row=>row.source==="inventory")!.amountCents,result.days.flatMap(day=>day.events).find(row=>row.source==="inventory")!.amountCents*2);
});
test("monthly dates clamp through leap February and recurring bills honor first upcoming date",()=>{
  assert.equal(monthDate("2028-02",31),"2028-02-29");assert.equal(addDays("2028-02-28",1),"2028-02-29");
  const result=forecastCash({...bank,fetchedAt:"2026-12-15T12:00:00Z",bills:[bill({upcoming_payment_date:"2026-12-18",recurring_date:31})]},empty,inputs);
  assert.deepEqual(result.days.flatMap(day=>day.events).map(row=>row.date),["2026-12-18","2027-01-31","2027-02-28"]);
});
test("bill matches prevent duplicates including completed bills and missing matches fail visibly",()=>{
  const obligation={...setup.config.obligations[0],nextDate:"2026-11-19",cadence:"monthly" as const,bankBillId:bank.bills[0]._id};
  const config={...empty,obligations:[obligation]};
  const result=forecastCash(bank,config,inputs);
  assert.ok(result.days.flatMap(day=>day.events).every(row=>row.source==="nessie-bill"));
  assert.equal(forecastCash({...bank,bills:[bill({status:"completed"})]},config,inputs).days.flatMap(day=>day.events).length,0);
  assert.throws(()=>forecastCash({...bank,bills:[]},config,inputs));
  assert.equal(cashConfigSchema.safeParse({...config,obligations:[obligation,{...obligation,id:"duplicate-match"}]}).success,false);
});
test("unknown dates, absent sales, credit accounts and invalid references do not fabricate cash",()=>{
  const result=forecastCash({...bank,bills:[bill({status:"pending",upcoming_payment_date:null,recurring_date:null})]},empty,{...inputs,dailyNetSalesCents:null});
  assert.equal(result.warnings.length,2);assert.ok(result.days.every(day=>day.closingCents===2500000));
  assert.throws(()=>forecastCash({...bank,account:{...bank.account,type:"Credit Card"}},empty,inputs));
  assert.throws(()=>forecastCash(bank,{...empty,reserveCents:-1},inputs));
  assert.throws(()=>forecastCash(bank,setup.config,{...inputs,inventory:[]}));
  assert.equal(datasetSchema.safeParse({...dataset,operations:{...dataset.operations,cashCalendar:{...setup,config:{...empty,obligations:[{...setup.config.obligations[5],inventoryLines:[{inventoryId:"missing",quantity:1}]}]}}}}).success,false);
});
test("Nessie calendar reads all four paths and rejects foreign bills and partial failure",async()=>{
  const paths:string[]=[];
  const fetcher:typeof fetch=async(url)=>{const path=new URL(String(url)).pathname;paths.push(path);return Response.json(path.endsWith("/bills")?bank.bills:path.endsWith("/deposits")?bank.deposits:path.endsWith("/withdrawals")?bank.withdrawals:bank.account);};
  const result=await readNessieCash({key:"test",accountId:bank.account._id,fetcher});assert.equal(paths.length,4);assert.equal(result.source,"nessie-sandbox");assert.equal(result.bills.length,1);
  assert.equal(cashBankSchema.safeParse({...bank,bills:[bill({account_id:"000000000000000000000099"})]}).success,false);
  await assert.rejects(readNessieCash({key:"test",accountId:bank.account._id,fetcher:async(url,options)=>String(url).includes("/bills?")?new Response("private",{status:503}):fetcher(url,options)}));
});
test("saved forecasts use server bank snapshots, canonical inputs and restaurant isolation",async()=>{
  const store=memoryCashStore();const handler=createCashHandler({load:async()=>dataset,store,authorize:()=>true,cloud:true,read:async()=>({...bank,source:"nessie-sandbox"})});
  const refreshed=await (await handler(request({action:"refresh",restaurantId:dataset.profile.id}))).json();
  const response=await handler(request({action:"save",restaurantId:dataset.profile.id,name:"Reserve test",bankSnapshotId:refreshed.bankSnapshotId,config:setup.config}));assert.equal(response.status,200);
  const record=savedCashSchema.parse((await response.json()).record);assert.equal(record.bank.source,"nessie-sandbox");assert.deepEqual(record.inputs,inputs);
  const original=forecastCash(record.bank,record.config,record.inputs);dataset.operations.employees[0].hourlyRateCents+=100;assert.deepEqual(forecastCash(record.bank,record.config,record.inputs),original);dataset.operations.employees[0].hourlyRateCents-=100;
  assert.equal((await handler(request({action:"save",restaurantId:"other",name:"bad",bankSnapshotId:refreshed.bankSnapshotId,config:setup.config}))).status,404);
  assert.equal((await handler(request({action:"save",restaurantId:dataset.profile.id,name:"bad",bankSnapshotId:crypto.randomUUID(),config:setup.config}))).status,409);
  assert.equal((await store.list(dataset.profile.id)).length,1);
});
test("cash endpoints enforce auth, origin, input bounds and redact provider failures",async()=>{
  const base={load:async()=>dataset,store:memoryCashStore()};
  assert.equal((await createCashHandler({...base,authorize:()=>false})(request({}))).status,401);
  const handler=createCashHandler({...base,authorize:()=>true,read:async()=>{throw new Error("secret-key");}});
  assert.equal((await handler(request({},"https://evil.example"))).status,403);
  assert.equal((await handler(request({action:"save",restaurantId:dataset.profile.id,name:"",bankSnapshotId:"demo",config:empty}))).status,422);
  const response=await handler(request({action:"refresh",restaurantId:dataset.profile.id}));assert.equal(response.status,503);assert.ok(!(await response.text()).includes("secret-key"));
});
