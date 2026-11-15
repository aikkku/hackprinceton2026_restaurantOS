"use client";
import { useState } from "react";
import { priceExperiment, type FinanceReport } from "../../domain/finance-report";
const money=(cents:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(cents/100);
const price=(cents:number)=>(cents/100).toFixed(2);
export function PricePlayground({ report }: { report: FinanceReport }) {
  const [raises,setRaises]=useState<Record<string,string>>({});
  const [loss,setLoss]=useState(String(report.source.assumptions.lossPerTenPercentRaise*100));
  const items=report.items.filter(item=>item.dineInUnits>0).slice(0,15);
  const validLoss=loss.trim()!=="" && Number.isFinite(Number(loss)) && Number(loss)>=0 && Number(loss)<=100;
  const valid=validLoss && items.every(item=>{const raw=raises[item.menuItemId]??"0";return /^\d+(\.\d{0,2})?$/.test(raw) && Number(raw)*100<=item.dineInPriceCents*report.source.assumptions.suggestedRaiseCap;});
  const rows=valid ? items.map(item=>({item,result:priceExperiment(item.dineInPriceCents,item.ingredientCostCents,item.dineInUnits,Math.round(Number(raises[item.menuItemId]??0)*100),Number(loss)/100)})) : [];
  const total=rows.reduce((sum,row)=>sum+row.result.changeCents,0);
  const baseline=rows.reduce((sum,row)=>sum+row.result.baselineContributionCents,0);
  return <section className="price-playground" aria-label="Price playground">
    <div className="fin-section-title"><span className="fin-eyebrow">A SMALL TEST, BEFORE A BIG CHANGE</span><h2>What if you raised a few prices?</h2><p>Try the 15 biggest sellers with dine-in sales. Prices on your actual menu stay unchanged.</p></div>
    <div className="fin-play-controls"><label>Customers lost per 10% price rise (%)<input aria-label="Customers lost per 10% price rise (%)" type="number" min="0" max="100" step="1" value={loss} onChange={event=>setLoss(event.target.value)} /></label><div><button className="button primary compact" onClick={()=>setRaises(Object.fromEntries(items.map(item=>[item.menuItemId,((item.suggestedPriceCents-item.dineInPriceCents)/100).toFixed(2)])))}>Use suggested raises</button><button className="button quiet compact" onClick={()=>{setRaises({});setLoss(String(report.source.assumptions.lossPerTenPercentRaise*100));}}>Reset</button></div></div>
    {!valid && <p role="alert">Enter a customer-loss percentage from 0–100 and raises from $0 up to {report.source.assumptions.suggestedRaiseCap*100}% of each current price, with at most two decimals.</p>}
    <div className="fin-experiment-outcome" role="status"><span>Estimated contribution change · report period</span><strong className={total<0?"fin-negative":""}>{valid ? `${total>0?"+":""}${money(total)}` : "Unavailable"}</strong><p>{valid ? `${money(baseline)} → ${money(baseline+total)} after ingredients. Annualized illustration: ${total>0?"+":""}${money(total*report.annualFactor)}.` : "Correct the inputs to see this comparison."} Labor and fixed costs are excluded.</p></div>
    <div className="fin-table-scroll" role="region" tabIndex={0} aria-label="Price experiment items"><table className="fin-table playground-table"><caption>Simulated dine-in prices · same ingredient cost per unit</caption><thead><tr><th>Menu item</th><th>Current</th><th>Raise ($)</th><th>New price</th><th>Customers lost</th><th>Break-even loss</th><th>Contribution change</th></tr></thead><tbody>{items.map(item=>{
      const result=rows.find(row=>row.item.menuItemId===item.menuItemId)?.result;
      return <tr key={item.menuItemId}><th scope="row">{item.name}<small>{item.dineInUnits.toLocaleString()} dine-in units</small></th><td>${price(item.dineInPriceCents)}</td><td><input aria-label={`Raise for ${item.name}`} type="number" min="0" max={item.dineInPriceCents*report.source.assumptions.suggestedRaiseCap/100} step="0.50" value={raises[item.menuItemId]??"0"} onChange={event=>setRaises(previous=>({...previous,[item.menuItemId]:event.target.value}))} /></td><td>{result ? `$${price(result.nextPriceCents)}`:"—"}</td><td>{result ? `${(result.lostFraction*100).toFixed(1)}%`:"—"}</td><td>{result?.breakEvenLoss!==null && result?.breakEvenLoss!==undefined ? `${(result.breakEvenLoss*100).toFixed(1)}%`:"Unavailable"}</td><td className={result && result.changeCents<0?"fin-negative":""}>{result ? `${result.changeCents>0?"+":""}${money(result.changeCents)}`:"—"}</td></tr>;
    })}</tbody></table></div>
    {!items.length && <p>No dine-in sales are available for a price experiment.</p>}
    <details className="fin-details"><summary>How this experiment works</summary><p>Lost share = chosen loss per 10% rise × (price increase ÷ current price) ÷ 10%, capped at 100%. Contribution change = units × [(1 − lost share) × (new price − ingredient cost) − (current price − ingredient cost)]. Ingredient cost stays fixed per dish. Break-even loss is unavailable when the original item contribution is zero or negative.</p><p>The comparison suggestions assume a separate fixed {(report.source.assumptions.suggestedVolumeLoss*100).toFixed(0)}% loss; this playground uses your price-sensitive loss setting. Results can differ. Annualization multiplies by 365 ÷ {report.days}; it is not a demand forecast. Test a small set of items before applying anything.</p></details>
  </section>;
}
