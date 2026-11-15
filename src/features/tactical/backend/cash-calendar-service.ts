import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Dataset } from "../domain/dataset.ts";
import { cashBankSchema, cashConfigSchema, cashInputs, forecastCash, savedCashSchema, type CashBank, type SavedCash } from "../domain/cash-calendar.ts";
import { authorizedAi, boundedJson, sameOrigin } from "./ai-access.ts";
import { readNessieCash } from "./adapters/nessie.ts";
import { tacticalDatabase } from "./mongodb.ts";

type BankRecord={_id:string;restaurantId:string;bank:CashBank};
export interface CashStore {
  list(restaurantId:string):Promise<SavedCash[]>;
  save(record:SavedCash):Promise<void>;
  bank(id:string,restaurantId:string):Promise<CashBank|null>;
  saveBank(id:string,restaurantId:string,bank:CashBank):Promise<void>;
}
export const mongoCashStore:CashStore={
  async list(restaurantId){const rows=await (await tacticalDatabase()).collection("tactical_cash_forecasts").find({restaurantId}).sort({savedAt:-1}).limit(20).toArray();return rows.map(row=>savedCashSchema.parse(row));},
  async save(record){await (await tacticalDatabase()).collection("tactical_cash_forecasts").insertOne({_id:record.id,...savedCashSchema.parse(record)} as never);},
  async bank(id,restaurantId){const row=await (await tacticalDatabase()).collection<BankRecord>("tactical_bank_snapshots").findOne({_id:id,restaurantId});return row?cashBankSchema.parse(row.bank):null;},
  async saveBank(id,restaurantId,bank){await (await tacticalDatabase()).collection<BankRecord>("tactical_bank_snapshots").insertOne({_id:id,restaurantId,bank:cashBankSchema.parse(bank)});},
};
export function memoryCashStore():CashStore{
  const records:SavedCash[]=[],banks=new Map<string,BankRecord>();
  return {async list(id){return records.filter(row=>row.restaurantId===id).slice(-20).reverse();},async save(record){records.push(record);},async bank(id,restaurantId){const row=banks.get(id);return row?.restaurantId===restaurantId?row.bank:null;},async saveBank(id,restaurantId,bank){if(banks.size>=50)banks.delete(banks.keys().next().value!);banks.set(id,{_id:id,restaurantId,bank});}};
}
const inputSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("refresh"),restaurantId:z.string()}),
  z.object({action:z.literal("save"),restaurantId:z.string(),name:z.string().trim().min(1).max(80),bankSnapshotId:z.union([z.literal("demo"),z.uuid()]),config:cashConfigSchema}),
]);
export function createCashHandler({load,store,read=readNessieCash,authorize=authorizedAi,cloud=false}:{load:()=>Promise<Dataset>;store:CashStore;read?:typeof readNessieCash;authorize?:typeof authorizedAi;cloud?:boolean}){
  let running=false;
  const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
  return async(request:Request)=>{
    if(!authorize(request))return reply({error:"Unlock the workspace to access bank data and saved forecasts."},401);
    if(request.method!=="GET"&&!sameOrigin(request))return reply({error:"Request not allowed."},403);
    if(!["GET","POST"].includes(request.method))return reply({error:"Method not allowed."},405);
    try{
      const dataset=await load();
      if(request.method==="GET"){
        if(new URL(request.url).searchParams.get("restaurantId")!==dataset.profile.id)return reply({error:"Restaurant not found."},404);
        return reply({ok:true,storage:cloud?"mongodb":"browser",records:cloud?await store.list(dataset.profile.id):[]});
      }
      let input;try{input=inputSchema.parse(await boundedJson(request,120_000));}catch{return reply({error:"Check the forecast inputs."},422);}
      if(input.restaurantId!==dataset.profile.id)return reply({error:"Restaurant not found."},404);
      if(input.action==="refresh"){
        if(running)return reply({error:"A bank refresh is already running."},429);
        running=true;
        try{const bank=await read({signal:request.signal});const id=randomUUID();await store.saveBank(id,dataset.profile.id,bank);return reply({ok:true,bank,bankSnapshotId:id});}finally{running=false;}
      }
      const bank=input.bankSnapshotId==="demo"?dataset.operations.cashCalendar?.bank:await store.bank(input.bankSnapshotId,dataset.profile.id);
      if(!bank)return reply({error:"Bank snapshot is unavailable. Refresh or select the local demo."},409);
      const inputs=cashInputs(dataset);
      try{forecastCash(bank,input.config,inputs);}catch{return reply({error:"Check matched bills, inventory references and account type."},422);}
      const record=savedCashSchema.parse({id:randomUUID(),restaurantId:dataset.profile.id,name:input.name,savedAt:new Date().toISOString(),datasetHash:createHash("sha256").update(JSON.stringify(inputs)).digest("hex"),modelVersion:"cash-v1",bankSnapshotId:input.bankSnapshotId,bank,config:input.config,inputs});
      if(cloud)await store.save(record);
      return reply({ok:true,storage:cloud?"mongodb":"browser",record});
    }catch{return reply({error:"Cash calendar service is unavailable. Your open forecast is unchanged; retry when the connection returns."},503);}
  };
}
