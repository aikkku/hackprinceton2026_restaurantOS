import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { importLocalDataset, getMarkets, queryLocalDataset, getPropertyDetail, LocalDataError, type LocalConfig } from "./backend/local-dataset.ts";
import { streamRecords } from "./backend/record-stream.ts";
import { parseLocalQuery } from "./domain/local-data.ts";
import { baseRentMonthly } from "./domain/scenario.ts";

const property = (id:number,extra:Record<string,unknown>={})=>({id,buildingName:`Synthetic property ${id}`,propertyType:6,primaryAddress:{researchMarketId:14,streetNumber:String(id),streetName:"Synthetic",streetType:"Street",latitude:29.76,longitude:-95.36},...extra});
const space = (id:number,extra:Record<string,unknown>={})=>({id,propertyId:1,rateLow:2,rateHigh:2,rateBasis:1,monetaryUnit:1,serviceType:13,squareFeetMin:1200,squareFeetMax:1200,...extra});
const listing = (id:number,spaces:unknown[],extra:Record<string,unknown>={})=>({id,propertyId:1,listingStatus:1,certifiedFreshDate:"2026-01-02T00:00:00Z",forLeaseSummary:{askingRateMeasurementType:1,spaces},...extra});
async function fixture(properties:unknown[],listings:unknown[],run:(config:LocalConfig)=>Promise<void>) {
  const directory=await mkdtemp(join(tmpdir(),"restaurantos-expansion-"));
  const settings={rootPath:directory,dbPath:join(directory,"cache.sqlite"),datasetId:"synthetic-tests",datasetDate:null};
  try{await mkdir(join(directory,"data"));await writeFile(join(directory,"data/commercial-property.jsonl"),properties.map(p=>JSON.stringify(p)).join("\n"));await writeFile(join(directory,"data/commercial-listing-summary.jsonl"),listings.map(p=>JSON.stringify(p)).join("\n"));await run(settings);}finally{await rm(directory,{recursive:true,force:true});}
}
const query=()=>parseLocalQuery(new URLSearchParams({cityId:"houston",west:"-96",south:"29",east:"-95",north:"30"}));

test("streaming import verifies space relationships, deduplicates ids, preserves units and is rerunnable",async()=>{
  await fixture([property(1),property(1),property(2)],[listing(10,[space(100),space(100),space(101,{propertyId:2}),space(102,{propertyId:999})]),listing(10,[])],async config=>{
    const report=await importLocalDataset(config);
    assert.equal(report.accepted.properties,2);assert.equal(report.accepted.listings,1);assert.equal(report.accepted.spaces,2);assert.equal(report.duplicates,3);assert.equal(report.reasons.unknown_space_property,1);
    const result=queryLocalDataset(query(),config);assert.equal(result.coverage.totalMatching,4);
    const selected=getPropertyDetail("costar-space:101",config)!;
    assert.equal(selected.property.sourcePropertyId,"2");assert.equal(selected.property.sourceListingId,"10");assert.equal(selected.property.sourceSpaceId,"101");
    assert.equal(selected.property.askingRent!.amount,24);assert.equal(baseRentMonthly(selected.property.askingRent,1200),2400);
    assert.equal(selected.property.sourceRent!.rateBasisCode,1);assert.equal(selected.property.availability,"unknown");assert.equal(selected.property.recordDate,"2026-01-02T00:00:00.000Z");assert.equal(selected.property.datasetDate,null);
    assert.equal(selected.evidence.find(e=>e.id==="costar:property:2")!.observedAt,null);assert.equal(selected.evidence.find(e=>e.id==="costar:listing:10")!.observedAt,"2026-01-02T00:00:00.000Z");
    assert.deepEqual(selected.area.factors,{demand:null,similarity:null,competition:null,cost:null});
    assert.equal(selected.area.metrics!.propertyCount,2);assert.equal(selected.area.metrics!.listingCount,2);assert.equal(selected.area.metrics!.averageAskingRentPerSfYear,24);
    assert.deepEqual(await importLocalDataset(config),report);assert.equal(queryLocalDataset(query(),config).coverage.totalMatching,4);
  });
});

test("invalid geography is rejected, absent geography and unsupported rent units remain unknown",async()=>{
  await fixture([property(1),property(2,{primaryAddress:{researchMarketId:14}}),property(3,{primaryAddress:{researchMarketId:14,latitude:300,longitude:-95}}),null], [listing(10,[space(100,{rateBasis:0}),space(101,{monetaryUnit:0}),space(102,{rateLow:0,rateHigh:0}),space(103,{rateLow:1,rateHigh:2}),space(104,{squareFeetMin:500,squareFeetMax:1000}),space(105,{squareFeetMin:2000,squareFeetMax:1000}),space(106,{rateLow:5,rateHigh:6,askingRateHasValue:false})])],async config=>{
    const report=await importLocalDataset(config);assert.equal(report.reasons.invalid_coordinates,1);assert.equal(report.reasons.invalid_property_id,1);assert.equal(report.reasons.invalid_area_range,1);assert.equal(report.warnings.missing_coordinates,1);
    const markets=getMarkets(config);assert.equal(markets.metadata.propertyCount,2);assert.equal(markets.metadata.mappableCount,7);
    for(const id of [100,101,102,103,106])assert.equal(getPropertyDetail(`costar-space:${id}`,config)!.property.askingRent,null);
    // A quoted 0 is never stored as a price: it is "not listed".
    assert.equal(getPropertyDetail("costar-space:102",config)!.property.sourceRent!.low,null);
    assert.equal(getPropertyDetail("costar-space:102",config)!.property.sourceRent!.high,null);
    // askingRateHasValue:false means "call for pricing" even when raw rates exist.
    const noValue=getPropertyDetail("costar-space:106",config)!.property.sourceRent!;
    assert.equal(noValue.low,null);assert.equal(noValue.high,null);
    assert.equal(getPropertyDetail("costar-space:104",config)!.property.floorAreaSqFt,null);
    assert.equal(getPropertyDetail("costar-property:2",config),null);
    const db=new DatabaseSync(config.dbPath,{readOnly:true});try{assert.equal(db.prepare("SELECT COUNT(*) n FROM properties WHERE lat IS NULL AND h3 IS NULL").get()!.n,1);}finally{db.close();}
  });
});

test("queries enforce viewport/page/filter bounds, include unknown explicitly, and return empty safely",async()=>{
  await fixture([property(1)],[listing(10,[space(100),space(101,{rateLow:0,rateHigh:0})])],async config=>{
    await importLocalDataset(config);const q=query();
    const page=queryLocalDataset({...q,limit:1},config);assert.equal(page.coverage.totalMatching,3);assert.equal(page.coverage.returned,1);assert.equal(page.dataset.properties.length,1);
    assert.equal(queryLocalDataset({...q,monthlyBudget:100,includeUnknown:false},config).coverage.totalMatching,0);
    assert.equal(queryLocalDataset({...q,monthlyBudget:100,includeUnknown:true},config).coverage.totalMatching,2);
    assert.equal(queryLocalDataset({...q,west:-94,east:-93},config).dataset.properties.length,0);
    assert.throws(()=>queryLocalDataset({...q,limit:201},config),(e:unknown)=>e instanceof LocalDataError&&e.code==="invalid_query");
    assert.throws(()=>queryLocalDataset({...q,cityId:"unsupported"},config),(e:unknown)=>e instanceof LocalDataError&&e.code==="invalid_query");
    for(const params of ["cityId=houston&west=-96&south=29&east=-95&north=30&limit=0","cityId=houston&west=-96&south=29&east=-95&north=30&unknown=x","cityId=houston&west=-96&south=29&east=-95&north=30&includeUnknown=yes","cityId=houston&west=-96&west=-97&south=29&east=-95&north=30"])assert.throws(()=>parseLocalQuery(new URLSearchParams(params)));
  });
});

test("mixed rent service types stay unaggregated; off-market marketing does not imply vacancy",async()=>{
  await fixture([property(1)],[listing(10,[space(100),space(101,{serviceType:7})]),listing(11,[space(102)],{listingStatus:3})],async config=>{
    await importLocalDataset(config);assert.equal(getPropertyDetail("costar-space:100",config)!.area.metrics!.averageAskingRentPerSfYear,null);assert.equal(getPropertyDetail("costar-space:102",config)!.property.availability,"unknown");
  });
});

test("unmappable cities do not receive invented bounds and invalid rents are rejected",async()=>{
  await fixture([property(1),property(2,{primaryAddress:{researchMarketId:20}})],[listing(10,[space(100,{rateLow:-1}),space(101,{rateLow:3,rateHigh:2}),space(102,{serviceType:0}),space(103,{serviceType:null}),space(104)])],async config=>{
    const report=await importLocalDataset(config);assert.equal(report.reasons.invalid_rent_range,2);
    assert.deepEqual(getMarkets(config).cities.map(c=>c.id),["houston"]);assert.equal(getPropertyDetail("costar-space:102",config)!.area.metrics!.averageAskingRentPerSfYear,null);
  });
});

test("source failures preserve last valid cache and redact filesystem details",async()=>{
  await fixture([property(1)],[],async config=>{
    await importLocalDataset(config);await rm(join(config.rootPath!,"data/commercial-property.jsonl"));
    await assert.rejects(importLocalDataset(config),(e:unknown)=>e instanceof LocalDataError&&e.code==="source_failure"&&!e.message.includes(config.dbPath));
    assert.equal(getMarkets(config).metadata.propertyCount,1);
    assert.throws(()=>getMarkets({dbPath:join(config.rootPath!,"missing.sqlite")}),(e:unknown)=>e instanceof LocalDataError&&e.code==="not_configured");
    const db=new DatabaseSync(config.dbPath);try{db.prepare("UPDATE meta SET value='unsupported-version' WHERE key='schemaVersion'").run();}finally{db.close();}
    assert.throws(()=>getMarkets(config),(e:unknown)=>e instanceof LocalDataError&&e.code==="source_failure");
    await writeFile(config.dbPath,"broken database");assert.throws(()=>getMarkets(config),(e:unknown)=>e instanceof LocalDataError&&e.code==="source_failure");
  });
});

test("missing server configuration is distinct from a broken source",()=>{
  const previous=process.env.EXPANSION_DB_PATH;
  try{delete process.env.EXPANSION_DB_PATH;assert.throws(()=>getMarkets(),(e:unknown)=>e instanceof LocalDataError&&e.code==="not_configured");}
  finally{if(previous===undefined)delete process.env.EXPANSION_DB_PATH;else process.env.EXPANSION_DB_PATH=previous;}
});

test("bounded reader handles CSV quoting, JSONL rejection, and incremental JSON arrays",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"restaurantos-stream-"));
  try{
    const csv=join(directory,"sample.csv");await writeFile(csv,'id,name,note\r\n1,"Synthetic, Site","two\nlines"\r\n2,"A ""quote""",ok');
    const rows=[];for await(const row of streamRecords(csv))rows.push(row);assert.deepEqual(rows,[{id:"1",name:"Synthetic, Site",note:"two\nlines"},{id:"2",name:'A "quote"',note:"ok"}]);
    const json=join(directory,"sample.json");await writeFile(json,'[ {"nested":[{"text":"} \\\" ["}]}, {"id":2} ]');const records=[];for await(const r of streamRecords(json))records.push(r);assert.equal(records.length,2);
    const jsonl=join(directory,"sample.jsonl");await writeFile(jsonl,'{"id":1}\ninvalid\n{"id":2}');const lines=[];for await(const r of streamRecords(jsonl))lines.push(r);assert.deepEqual(lines,[{id:1},null,{id:2}]);
    for(const invalid of ['[{},]','[,{}]','[{}{}]','[{},,{}]','[{"id":1}']){await writeFile(json,invalid);await assert.rejects(async()=>{for await(const r of streamRecords(json))void r;});}
  }finally{await rm(directory,{recursive:true,force:true});}
});
