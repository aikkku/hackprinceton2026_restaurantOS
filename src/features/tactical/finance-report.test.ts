import test from "node:test";
import assert from "node:assert/strict";
import demo from "./frontend/data/demo-restaurant.json" with { type:"json" };
import { datasetSchema } from "./domain/dataset.ts";
import { buildFinanceReport, financeReportSchema, median, priceExperiment } from "./domain/finance-report.ts";
import { buildAiContext } from "./backend/ai-context.ts";
const dataset=datasetSchema.parse(demo);
test("dated report reconciles item/channel sales and excludes the separate ledger",()=>{
  const report=buildFinanceReport(dataset)!;
  assert.equal(report.days,92); assert.equal(report.items.length,24);
  assert.equal(report.totalUnits,report.items.reduce((sum,item)=>sum+item.quantity,0));
  assert.equal(report.revenueCents,report.items.reduce((sum,item)=>sum+item.revenueCents,0));
  assert.equal(report.delivery.revenueCents,report.items.reduce((sum,item)=>sum+item.appUnits*item.appPriceCents,0));
  assert.ok(report.slow.length>0); assert.ok(report.raises.length>0); assert.ok(report.expensive.length>0);
  const changed=structuredClone(dataset); changed.operations.transactions=[];
  assert.deepEqual(buildFinanceReport(changed),report);
});
test("report contracts reject invalid periods, repeated items and unknown menu IDs",()=>{
  const input=structuredClone(dataset.operations.financeReport!);
  input.endDate="2026-01-01"; assert.equal(financeReportSchema.safeParse(input).success,false);
  input.endDate="2026-10-31"; input.sales.push(input.sales[0]); assert.equal(financeReportSchema.safeParse(input).success,false);
  const value=structuredClone(dataset);value.operations.financeReport!.sales[0].menuItemId="missing";
  assert.equal(datasetSchema.safeParse(value).success,false);
  delete value.operations.financeReport; assert.equal(datasetSchema.safeParse(value).success,true); assert.equal(buildFinanceReport(value),null);
});
test("price experiments hold food cost fixed, clamp lost volume, and handle loss-making items",()=>{
  const result=priceExperiment(1000,300,100,100,.04);
  assert.equal(result.lostFraction,.04); assert.equal(result.changeCents,6800); assert.equal(result.breakEvenLoss,.125);
  assert.equal(priceExperiment(1000,300,100,0,.04).changeCents,0);
  assert.equal(priceExperiment(1000,300,100,1000,1).lostFraction,1);
  assert.equal(priceExperiment(1000,1100,100,100,.04).breakEvenLoss,null);
  assert.throws(()=>priceExperiment(1000,300,100,-50,.04)); assert.throws(()=>priceExperiment(1000,300,100,100,NaN));
});
test("zero volume and full commission produce unavailable ratios, not infinities",()=>{
  const value=structuredClone(dataset);
  for(const row of value.operations.financeReport!.sales) {row.appUnits=0;row.dineInUnits=0;row.pickupUnits=0;}
  const empty=buildFinanceReport(value)!;assert.equal(empty.revenueCents,0);assert.equal(empty.delivery.share,null);assert.equal(empty.delivery.commissionOffsetMarkup,null);assert.equal(empty.slow.length,0);
  for(const row of value.operations.financeReport!.sales) row.appUnits=1;
  for(const row of value.operations.menu) row.deliveryCommissionFraction=1;
  assert.equal(buildFinanceReport(value)!.delivery.commissionOffsetMarkup,null);
});
test("delivery markup does not double-count existing markup or ignore supplied commission",()=>{
  const value=structuredClone(dataset); const menu=value.operations.menu[0]; menu.deliveryCommissionFraction=.25;menu.ingredientCostCents=300;menu.packagingCostCents=100;
  value.operations.financeReport!.sales=[{menuItemId:menu.id,dineInUnits:0,pickupUnits:0,appUnits:10,dineInPriceCents:1000,appPriceCents:1300}];
  const delivery=buildFinanceReport(value)!.delivery;
  assert.equal(delivery.revenueCents,13000);assert.equal(delivery.afterFeesCents,9750);assert.equal(delivery.contributionCents,5750);
  assert.equal(delivery.options[3].afterFeesCents,8625);assert.equal(delivery.options[3].changeCents,-1125);
  assert.ok(Math.abs(delivery.commissionOffsetMarkup!-1/3)<.00001);
});
test("comparison medians use one latest source per restaurant and raise caps hold",()=>{
  assert.equal(median([100,300,200,400]),250);assert.equal(median([]),null);
  const value=structuredClone(dataset); const id=value.operations.menu[0].id;
  const old={...value.operations.competitors[0],menuItemId:id,restaurant:"Only comparator",priceCents:10000,observedOn:"2026-01-01"};
  value.operations.competitors=[old,{...old,id:"latest",observedOn:"2026-11-01",priceCents:2000}];
  const item=buildFinanceReport(value)!.items.find(item=>item.menuItemId===id)!;
  assert.equal(item.comparableCents,2000);assert.equal(item.comparisons.length,1);
  assert.ok(item.suggestedPriceCents<=item.dineInPriceCents*1.25);
});
test("slow seller estimates can correctly recommend keeping an item",()=>{
  const report=buildFinanceReport(dataset)!;
  assert.ok(report.slow.some(item=>item.netIfCutCents<0));
  const item=report.slow[0];assert.equal(item.netIfCutCents,item.spoilageSavedCents-item.contributionLostCents);
  const value=structuredClone(dataset);value.operations.financeReport!.assumptions.cutSwitchFraction=1;
  assert.ok(buildFinanceReport(value)!.slow.every(item=>item.contributionLostCents===0));
});
test("finance AI and assistant receive the same report calculations and item evidence",()=>{
  for(const task of ["finance","advisor"] as const) {
    const {evidence}=buildAiContext(dataset,{task,restaurantId:dataset.profile.id,question:""});
    const report=JSON.parse(evidence.find(row=>row.id==="metric:finance-report")!.detail);
    assert.equal(report.revenueCents,buildFinanceReport(dataset)!.revenueCents);
    assert.equal(evidence.filter(row=>row.id.startsWith("finance-item:")).length,24);
  }
});


test("finance narrative input contains derived direction without source amounts or dates", async () => {
  const { financeNarrativeEvidence } = await import("./backend/ai-context.ts");
  const rows = financeNarrativeEvidence(dataset)!;
  const report = JSON.parse(rows[0].detail);
  assert.equal(report.deliveryContribution, "positive");
  assert.ok(report.lowerMarkupExamples.every((row: { change: string }) => row.change === "negative"));
  assert.ok(rows.every(row => !/\d/.test(row.detail)));
});
