import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { datasetSchema, type Dataset } from "../domain/dataset.ts";
import { cashInputs, forecastCash, savedCashSchema } from "../domain/cash-calendar.ts";
import { mongoDatasets, type DatasetRepository } from "./mongodb.ts";
import { mongoCashStore, type CashStore } from "./cash-calendar-service.ts";

// Append-only migration: preserve all existing restaurant data and owner edits.
export async function seedCashCalendar(fixture:Dataset,repository:DatasetRepository=mongoDatasets,store:CashStore=mongoCashStore){
  if(!fixture.operations.cashCalendar)throw new Error("Cash fixture missing");
  let record=await repository.read(fixture.profile.id);
  if(!record)throw new Error("Restaurant missing; seed the restaurant dataset first");
  for(let attempt=0;!record.dataset.operations.cashCalendar&&attempt<3;attempt++){
    const updated=datasetSchema.parse({...record.dataset,operations:{...record.dataset.operations,cashCalendar:fixture.operations.cashCalendar}});
    const saved=await repository.save(updated,record.revision);
    record=saved??await repository.read(fixture.profile.id);
    if(!record)throw new Error("Restaurant missing");
  }
  const setup=record.dataset.operations.cashCalendar;
  if(!setup)throw new Error("Dataset revision conflict");
  const inputs=cashInputs(record.dataset),result=forecastCash(setup.bank,setup.config,inputs);
  const existing=await store.list(fixture.profile.id);
  if(!existing.length)await store.save(savedCashSchema.parse({id:randomUUID(),restaurantId:fixture.profile.id,name:"Opening cash plan",savedAt:new Date().toISOString(),datasetHash:createHash("sha256").update(JSON.stringify(inputs)).digest("hex"),modelVersion:"cash-v1",bankSnapshotId:"demo",bank:setup.bank,config:setup.config,inputs}));
  return {revision:record.revision,days:result.days.length,obligations:setup.config.obligations.length,sampleBankBills:setup.bank.bills.length,savedForecasts:(await store.list(fixture.profile.id)).length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const fixture=datasetSchema.parse(JSON.parse(await readFile(new URL("../frontend/data/demo-restaurant.json",import.meta.url),"utf8")));console.log(JSON.stringify(await seedCashCalendar(fixture)));process.exit(0);}
  catch(error){console.error(JSON.stringify({ok:false,error:error instanceof Error?error.name:"UnknownError"}));process.exit(1);}
}
