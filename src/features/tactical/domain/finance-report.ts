import { z } from "zod";
import type { Dataset } from "./dataset.ts";

const cents = z.number().int().min(0).max(100_000_000);
const units = z.number().int().min(0).max(1_000_000);
export const financeReportSchema = z.object({
  sourceId: z.string().min(1), provenance: z.literal("synthetic"), description: z.string().min(1).max(1200),
  startDate: z.iso.date(), endDate: z.iso.date(),
  sales: z.array(z.object({ menuItemId: z.string().min(1), dineInUnits: units, pickupUnits: units, appUnits: units, dineInPriceCents: cents, appPriceCents: cents })).max(500),
  assumptions: z.object({ suggestedRaiseCap: z.number().min(0).max(1), suggestedVolumeLoss: z.number().min(0).max(1), slowUnitShare: z.number().min(0).max(1), slowSpoilageFraction: z.number().min(0).max(1), cutSwitchFraction: z.number().min(0).max(1), lossPerTenPercentRaise: z.number().min(0).max(1) }),
}).superRefine((data, ctx) => {
  if (data.endDate < data.startDate) ctx.addIssue({ code: "custom", message: "Report end must follow start." });
  if (new Set(data.sales.map(row => row.menuItemId)).size !== data.sales.length) ctx.addIssue({ code: "custom", message: "One sales row per menu item is required." });
});
export type FinanceReportSource = z.infer<typeof financeReportSchema>;
export function median(values: number[]) { const ordered = [...values].sort((a,b) => a-b); const middle = Math.floor(ordered.length/2); return ordered.length ? (ordered.length%2 ? ordered[middle] : (ordered[middle-1]+ordered[middle])/2) : null; }
export function priceExperiment(priceCents: number, costCents: number, quantity: number, raiseCents: number, lossPerTenPercentRaise: number) {
  for (const value of [priceCents, costCents, quantity, raiseCents, lossPerTenPercentRaise]) if (!Number.isFinite(value) || value < 0) throw new Error("Invalid experiment input");
  if (lossPerTenPercentRaise > 1 || !Number.isInteger(raiseCents)) throw new Error("Invalid experiment input");
  const nextPriceCents = priceCents + raiseCents;
  const lostFraction = priceCents > 0 ? Math.min(1, lossPerTenPercentRaise * (raiseCents / priceCents) / .1) : 0;
  const baselineContributionCents = Math.round(quantity * (priceCents-costCents));
  const nextContributionCents = Math.round(quantity * (1-lostFraction) * (nextPriceCents-costCents));
  const breakEvenLoss = priceCents > costCents && nextPriceCents > costCents ? Math.max(0, 1-(priceCents-costCents)/(nextPriceCents-costCents)) : null;
  return { nextPriceCents, lostFraction, baselineContributionCents, nextContributionCents, changeCents: nextContributionCents-baselineContributionCents, breakEvenLoss };
}

export function buildFinanceReport(dataset: Dataset) {
  const source = dataset.operations.financeReport;
  if (!source) return null;
  financeReportSchema.parse(source);
  const days = Math.round((Date.parse(source.endDate)-Date.parse(source.startDate))/86_400_000)+1;
  const annualFactor = 365/days;
  const totalUnits = source.sales.reduce((sum,row)=>sum+row.dineInUnits+row.pickupUnits+row.appUnits,0);
  const items = source.sales.map(row => {
    const menu = dataset.operations.menu.find(item=>item.id===row.menuItemId);
    if (!menu) throw new Error("Missing menu reference");
    const quantity = row.dineInUnits+row.pickupUnits+row.appUnits;
    const revenueCents = (row.dineInUnits+row.pickupUnits)*row.dineInPriceCents+row.appUnits*row.appPriceCents;
    const feesCents = Math.round(row.appUnits*row.appPriceCents*menu.deliveryCommissionFraction);
    const packagingCents = (row.pickupUnits+row.appUnits)*menu.packagingCostCents;
    const contributionCents = revenueCents - quantity*menu.ingredientCostCents-feesCents-packagingCents;
    // Latest supplied observation per restaurant; duplicate observations never gain extra median weight.
    const latest = new Map<string, Dataset["operations"]["competitors"][number]>();
    for (const observation of dataset.operations.competitors.filter(item=>item.menuItemId===menu.id)) {
      const previous=latest.get(observation.restaurant);
      if (!previous || observation.observedOn>previous.observedOn) latest.set(observation.restaurant,observation);
    }
    const comparisons=[...latest.values()].filter(item=>item.priceCents>0);
    const comparableCents=median(comparisons.map(item=>item.priceCents));
    const gap=comparableCents!==null && row.dineInPriceCents>0 ? row.dineInPriceCents/comparableCents-1 : null;
    const cap=Math.floor(row.dineInPriceCents*(1+source.assumptions.suggestedRaiseCap)/50)*50;
    const target=gap!==null && gap<-.05 && comparableCents!==null ? Math.min(cap,Math.max(row.dineInPriceCents+50,Math.round((row.dineInPriceCents+comparableCents)/2/50)*50)) : row.dineInPriceCents;
    const suggestedPriceCents=target>row.dineInPriceCents && row.dineInUnits>0 ? target : row.dineInPriceCents;
    const suggestedGainCents=suggestedPriceCents>row.dineInPriceCents ? Math.round(row.dineInUnits*((1-source.assumptions.suggestedVolumeLoss)*(suggestedPriceCents-menu.ingredientCostCents)-(row.dineInPriceCents-menu.ingredientCostCents))) : 0;
    const unitShare=totalUnits ? quantity/totalUnits : 0;
    const spoilageSavedCents=Math.round(quantity*menu.ingredientCostCents*source.assumptions.slowSpoilageFraction);
    const contributionLostCents=Math.round(contributionCents*(1-source.assumptions.cutSwitchFraction));
    return { ...row, name:menu.name, category:menu.category, ingredientCostCents:menu.ingredientCostCents, packagingCostCents:menu.packagingCostCents, commission:menu.deliveryCommissionFraction, quantity, revenueCents, feesCents, packagingCents, contributionCents, comparisons, comparableCents, gap, suggestedPriceCents, suggestedGainCents, unitShare, spoilageSavedCents, contributionLostCents, netIfCutCents:spoilageSavedCents-contributionLostCents };
  }).sort((a,b)=>b.revenueCents-a.revenueCents || a.menuItemId.localeCompare(b.menuItemId));
  const sum=(key:"revenueCents"|"contributionCents"|"feesCents")=>items.reduce((total,item)=>total+item[key],0);
  const revenueCents=sum("revenueCents");
  const appRevenueCents=items.reduce((total,item)=>total+item.appUnits*item.appPriceCents,0);
  const appBaseRevenueCents=items.reduce((total,item)=>total+item.appUnits*item.dineInPriceCents,0);
  const appPackagingCents=items.reduce((total,item)=>total+item.appUnits*item.packagingCostCents,0);
  const appFoodCents=items.reduce((total,item)=>total+item.appUnits*item.ingredientCostCents,0);
  const retainedBaseCents=items.reduce((total,item)=>total+item.appUnits*item.dineInPriceCents*(1-item.commission),0);
  const delivery={ revenueCents:appRevenueCents, baseRevenueCents:appBaseRevenueCents, share:revenueCents ? appRevenueCents/revenueCents : null, feesCents:sum("feesCents"), packagingCents:appPackagingCents, foodCents:appFoodCents, afterFeesCents:appRevenueCents-sum("feesCents"), contributionCents:appRevenueCents-sum("feesCents")-appPackagingCents-appFoodCents, markup:appBaseRevenueCents ? appRevenueCents/appBaseRevenueCents-1 : null, commissionOffsetMarkup:retainedBaseCents>0 ? appBaseRevenueCents/retainedBaseCents-1 : null, commission:appRevenueCents ? sum("feesCents")/appRevenueCents : null,
    options:[0,.05,.1,.15,.2].map(markup=>{ const afterFeesCents=Math.round(retainedBaseCents*(1+markup)); return {markup,afterFeesCents,changeCents:afterFeesCents-(appRevenueCents-sum("feesCents"))}; }) };
  const slow=items.filter(item=>item.quantity>0 && item.unitShare<source.assumptions.slowUnitShare).sort((a,b)=>b.netIfCutCents-a.netIfCutCents);
  const raises=items.filter(item=>item.suggestedPriceCents>item.dineInPriceCents).sort((a,b)=>b.suggestedGainCents-a.suggestedGainCents);
  return {source,days,annualFactor,items,totalUnits,revenueCents,contributionCents:sum("contributionCents"),delivery,slow,slowRevenueShare:revenueCents ? slow.reduce((sum,item)=>sum+item.revenueCents,0)/revenueCents : 0,raises,expensive:items.filter(item=>item.gap!==null && item.gap>.15).slice(0,5),comparisonCoverage:items.filter(item=>item.comparableCents!==null).length,profitableRaiseGainCents:raises.reduce((sum,item)=>sum+Math.max(0,item.suggestedGainCents),0)};
}
export type FinanceReport = NonNullable<ReturnType<typeof buildFinanceReport>>;
