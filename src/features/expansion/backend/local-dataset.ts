import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { latLngToCell } from "h3-js";
import {
  localQuerySchema, normalizedRecordSchema, marketsResponseSchema, queryResponseSchema,
  propertyDetailResponseSchema, type LocalQuery, type NormalizedRecord, type MarketsResponse,
} from "../domain/local-data.ts";
import { propertySchema, type ExpansionArea, type ExpansionProperty } from "../domain/schemas.ts";
import { baseRentMonthly } from "../domain/scenario.ts";
import { streamRecords } from "./record-stream.ts";

export class LocalDataError extends Error {
  code: "not_configured" | "source_failure" | "invalid_query";
  constructor(code: LocalDataError["code"], message: string) { super(message); this.code = code; }
}
export type LocalConfig = { rootPath?: string; dbPath: string; datasetId?: string; datasetDate?: string | null };
const SCHEMA_VERSION = "expansion-local-v1";
const RIGHTS = "Restricted CoStar hackathon snapshot; authorized local evaluation only. No redistribution permission is asserted.";
const CITY_IDS: Record<number, { id: string; name: string }> = {14: {id:"houston",name:"Houston, TX"},20:{id:"los-angeles",name:"Los Angeles, CA"}};
const TYPES: Record<number,string> = {0:"Unknown",1:"Hospitality",2:"Industrial",3:"Land",5:"Office",6:"GeneralRetail",7:"Flex",8:"SportsAndEntertainment",9:"MixedUse",10:"Specialty",11:"Multifamily",13:"Healthcare",14:"Unknown",15:"Residential",16:"Homes"};
const SERVICES: Record<number,string> = {0:"Unknown",1:"PlusCleaning",2:"PlusElectricAndCleaning",4:"PlusElectric",5:"UtilitiesAndChar",6:"PlusUtilities",7:"FullService",8:"IndustrialGross",9:"ModifiedGross",10:"Net",11:"Negotiable",12:"DoubleNet",13:"TripleNet",14:"ToBeDetermined",15:"TenantElectric",16:"FullyRepairingAndInsuring",17:"InternalRepairingOnly",18:"InternalRepairingAndInsuring",19:"FullServiceGrossNoPass",20:"ChargesAndTaxesExcluded",21:"PlusTaxes",22:"ChargesAndTaxesIncluded",23:"PlusCharges"};
type Raw = Record<string, unknown>;
const object = (value: unknown): Raw => value && typeof value === "object" && !Array.isArray(value) ? value as Raw : {};
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const numeric = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const positive = (value: unknown) => { const n=numeric(value);return n !== null && n>0?n:null; };
const sourceId = (value: unknown): string | null => (typeof value === "number" && Number.isSafeInteger(value) && value>0) || (typeof value === "string" && /^[1-9]\d*$/.test(value)) ? String(value) : null;
const date = (value: unknown): string | null => {const s=text(value);return s && Number.isFinite(Date.parse(s))?new Date(s).toISOString():null;};
function config(value?: LocalConfig): LocalConfig {
  if(value) return {...value,dbPath:resolve(value.dbPath)};
  const dbPath=process.env.EXPANSION_DB_PATH;
  if(!dbPath) throw new LocalDataError("not_configured","Local dataset is not configured. Set EXPANSION_DB_PATH and import the snapshot.");
  return {dbPath:resolve(dbPath),rootPath:process.env.EXPANSION_COSTAR_ROOT,datasetId:process.env.EXPANSION_DATASET_ID,datasetDate:process.env.EXPANSION_DATASET_DATE || null};
}
function open(value?: LocalConfig) {
  const settings=config(value);
  if(!existsSync(settings.dbPath)) throw new LocalDataError("not_configured","The local dataset has not been imported.");
  let db:DatabaseSync|undefined;
  try {
    db=new DatabaseSync(settings.dbPath,{readOnly:true});
    if((db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get()?.value)!==SCHEMA_VERSION)throw new Error("Unsupported cache");
    return db;
  }catch {try{db?.close();}catch{}throw new LocalDataError("source_failure","The local dataset could not be opened. Rebuild the Expansion cache.");}
}
function withDB<T>(value:LocalConfig|undefined,fn:(db:DatabaseSync)=>T):T {
  const db=open(value);try{return fn(db);}catch(e){if(e instanceof LocalDataError)throw e;throw new LocalDataError("source_failure","The local snapshot query failed. Rebuild the Expansion cache.");}finally{db.close();}
}
function metadata(db:DatabaseSync): MarketsResponse["metadata"] {
  const row=db.prepare("SELECT value FROM meta WHERE key='metadata'").get();
  if(!row)throw new Error("Missing dataset metadata");return JSON.parse(String(row.value));
}
function evidenceFor(ids:string[], meta:MarketsResponse["metadata"], recordDate:string|null=null) {
  return [...new Set(ids)].map(id=>({id,provider:"CoStar local snapshot",recordId:id,label:id.startsWith("costar:listing:")?"Commercial lease listing snapshot":id.startsWith("costar:dataset:")?"Commercial dataset snapshot":"Commercial property snapshot",origin:"observed" as const,isDemo:false,observedAt:id.startsWith("costar:listing:")?recordDate:null,rights:meta.rights,notes:"Dated Matterport-capture sample; no verified current vacancy, restaurant suitability, demographics, or demand. Source dates describe research recency, not a live feed."}));
}
function markets(db:DatabaseSync): MarketsResponse {
  const meta=metadata(db);
  const rows=db.prepare("SELECT city_id, MIN(lon) west, MAX(lon) east, MIN(lat) south, MAX(lat) north, SUM(kind='property') property_count, SUM(kind='listing') listing_count, COUNT(h3) mappable_count FROM records GROUP BY city_id HAVING COUNT(h3)>0 ORDER BY city_id").all();
  const cities=rows.map(r=>{
    const west=Number(r.west),east=Number(r.east),south=Number(r.south),north=Number(r.north);
    const bounds:[number,number,number,number]=[west-.005,south-.005,east+.005,north+.005];
    const entry=Object.values(CITY_IDS).find(c=>c.id===r.city_id)!;
    return {id:String(r.city_id),name:entry.name,center:[(west+east)/2,(south+north)/2] as [number,number],bounds,isDemo:false,coverage:{propertyCount:Number(r.property_count),listingCount:Number(r.listing_count),mappableCount:Number(r.mappable_count)}};
  });
  return marketsResponseSchema.parse({cities,evidence:evidenceFor([`costar:dataset:${meta.datasetId}`],meta),metadata:meta});
}
export function getMarkets(value?:LocalConfig) {return withDB(value,markets);}

function stored(row:Record<string,unknown>): NormalizedRecord {return normalizedRecordSchema.parse(JSON.parse(String(row.payload)));}
function mapped(record:NormalizedRecord): ExpansionProperty {return propertySchema.parse(record);}
function area(db:DatabaseSync,h3Index:string,cityId:string,meta:MarketsResponse["metadata"]):ExpansionArea {
  const counts=db.prepare("SELECT COUNT(DISTINCT property_id) property_count,SUM(kind='listing') listing_count,COUNT(annual_rate) rent_count,COUNT(CASE WHEN service_code NOT IN (0,11,14) THEN annual_rate END) known_rent_count,COUNT(DISTINCT CASE WHEN annual_rate IS NOT NULL THEN service_code END) services,AVG(annual_rate) average_rate FROM records WHERE h3=? AND city_id=?").get(h3Index,cityId)!;
  return {h3Index,h3Resolution:8,cityId,label:`H3 ${h3Index}`,factors:{demand:null,similarity:null,competition:null,cost:null},sourceIds:[`costar:dataset:${meta.datasetId}`],isDemo:false,averageBaseRentMonthly:null,metrics:{propertyCount:Number(counts.property_count),listingCount:Number(counts.listing_count),rentSampleCount:Number(counts.rent_count),averageAskingRentPerSfYear:Number(counts.services)===1&&Number(counts.known_rent_count)===Number(counts.rent_count)&&counts.average_rate!==null?Number(counts.average_rate):null}};
}
export function queryLocalDataset(input:LocalQuery,value?:LocalConfig) {
  const checked=localQuerySchema.safeParse(input);
  if(!checked.success)throw new LocalDataError("invalid_query","Invalid city, viewport, filter, or pagination.");
  const q=checked.data;
  return withDB(value,db=>{
    const info=markets(db);const city=info.cities.find(c=>c.id===q.cityId);
    if(!city)throw new LocalDataError("invalid_query","Unsupported city.");
    const clauses=["city_id=?","lon BETWEEN ? AND ?","lat BETWEEN ? AND ?","h3 IS NOT NULL"];
    const params:SQLInputValue[]=[q.cityId,q.west,q.east,q.south,q.north];
    if(q.monthlyBudget!==undefined){clauses.push(q.includeUnknown?"(monthly_rent<=? OR monthly_rent IS NULL)":"monthly_rent<=?");params.push(q.monthlyBudget);}
    if(q.minimumArea!==undefined){clauses.push(q.includeUnknown?"(floor_area>=? OR floor_area IS NULL)":"floor_area>=?");params.push(q.minimumArea);}
    if(q.availability){clauses.push("availability=?");params.push(q.availability);}
    if(q.propertyType){clauses.push("property_type=?");params.push(q.propertyType);}
    const where=clauses.join(" AND ");
    const total=Number(db.prepare(`SELECT COUNT(*) n FROM records WHERE ${where}`).get(...params)!.n);
    const rows=db.prepare(`SELECT payload FROM records WHERE ${where} ORDER BY kind, id LIMIT ? OFFSET ?`).all(...params,q.limit,q.offset);
    const properties=rows.map(r=>mapped(stored(r)));
    const cells=[...new Set(properties.map(r=>r.h3Index))];
    const areas=cells.map(h=>area(db,h,q.cityId,info.metadata));
    const allCells=Number(db.prepare(`SELECT COUNT(DISTINCT h3) n FROM records WHERE ${where}`).get(...params)!.n);
    const ids=[...new Set([...properties.flatMap(r=>r.sourceIds),...areas.flatMap(r=>r.sourceIds)])];
    const evidence=ids.map(id=>evidenceFor([id],info.metadata,properties.find(p=>p.sourceIds.includes(id))?.recordDate??null)[0]);
    return queryResponseSchema.parse({dataset:{cities:[city],areas,properties,evidence,metadata:info.metadata},coverage:{totalMatching:total,returned:properties.length,limit:q.limit,offset:q.offset,areasReturned:areas.length,areasLimited:allCells>cells.length}});
  });
}
export function getPropertyDetail(id:string,value?:LocalConfig) {
  if(!/^costar-(?:property|space):[1-9]\d*$/.test(id))throw new LocalDataError("invalid_query","Invalid property identifier.");
  return withDB(value,db=>{
    const row=db.prepare("SELECT payload FROM records WHERE id=?").get(id);
    if(!row)return null;
    const record=stored(row);if(record.h3Index===null)return null;
    const meta=metadata(db);const selectedArea=area(db,record.h3Index,record.cityId,meta);
    return propertyDetailResponseSchema.parse({property:mapped(record),area:selectedArea,evidence:evidenceFor([...record.sourceIds,...selectedArea.sourceIds],meta,record.recordDate),metadata:meta});
  });
}

export type ImportReport = {accepted:{properties:number;listings:number;spaces:number};rejected:number;duplicates:number;reasons:Record<string,number>;warnings:Record<string,number>};
function reject(report:ImportReport,reason:string){report.rejected++;report.reasons[reason]=(report.reasons[reason]??0)+1;}
function warning(report:ImportReport,reason:string){report.warnings[reason]=(report.warnings[reason]??0)+1;}
function sourceFile(root:string,name:string) {for(const ext of ["jsonl","json"]){const p=join(root,"data",`${name}.${ext}`);if(existsSync(p))return p;}throw new Error("Required source dataset is missing");}
function geography(address:Raw) {
  const lat=numeric(address.latitude),lon=numeric(address.longitude);
  if((lat!==null&&(lat < -90||lat>90))||(lon!==null&&(lon < -180||lon>180)))throw new Error("invalid_coordinates");
  // Partial geography remains unknown; no geocoding, centroid substitution or coordinate inference.
  if(lat===null||lon===null)return {latitude:null,longitude:null,h3Index:null};
  return {latitude:lat,longitude:lon,h3Index:latLngToCell(lat,lon,8)};
}
function propertyRecord(raw:Raw,settings:LocalConfig):NormalizedRecord {
  const id=sourceId(raw.id);if(!id)throw new Error("invalid_property_id");
  const address=object(raw.primaryAddress);const market=CITY_IDS[Number(address.researchMarketId)];if(!market)throw new Error("unsupported_market");
  const street=[address.streetNumber,address.streetName,address.streetType].map(text).filter(Boolean).join(" ") || null;
  return normalizedRecordSchema.parse({id:`costar-property:${id}`,sourcePropertyId:id,sourceListingId:null,recordKind:"property",cityId:market.id,name:text(raw.buildingName)??street??`Property ${id}`,address:street,...geography(address),floorAreaSqFt:null,askingRent:null,originalRentUnit:null,rentBasis:null,availability:"unknown",previousUse:null,parkingSpaces:null,propertyType:TYPES[Number(raw.propertyType)]??null,recordDate:null,datasetDate:settings.datasetDate??null,sourceIds:[`costar:property:${id}`],isDemo:false});
}
function spaceRecord(raw:Raw,listing:Raw,parent:NormalizedRecord,settings:LocalConfig,report:ImportReport):NormalizedRecord {
  const id=sourceId(raw.id),listingId=sourceId(listing.id);if(!id||!listingId)throw new Error("invalid_space_or_listing_id");
  const low=positive(raw.rateLow),high=positive(raw.rateHigh),basis=numeric(raw.rateBasis),currency=numeric(raw.monetaryUnit),measurement=numeric(object(listing.forLeaseSummary).askingRateMeasurementType),service=numeric(raw.serviceType);
  if((numeric(raw.rateLow)??0)<0||(numeric(raw.rateHigh)??0)<0||(low!==null&&high!==null&&low>high))throw new Error("invalid_rent_range");
  const status=numeric(listing.listingStatus);
  if(low===null)warning(report,"missing_rent");
  if(basis!==1&&basis!==2)warning(report,"unknown_rent_period");
  if(currency!==1||measurement!==1)warning(report,"unsupported_rent_units");
  const exact=low!==null&&high!==null&&low===high&&currency===1&&measurement===1&&(basis===1||basis===2);
  const askingRent=exact?{amount:basis===1?low*12:low,unit:"USD_PER_SF_YEAR" as const}:null;
  const min=positive(raw.squareFeetMin),max=positive(raw.squareFeetMax);
  if(min!==null&&max!==null&&min>max)throw new Error("invalid_area_range");
  // Divisible ranges are not one exact premises area. The user can enter financial assumptions.
  const floorAreaSqFt=min!==null&&max!==null&&min===max?min:null;
  if(min===null||max===null)warning(report,"missing_floor_area");
  const sourceRent={low:numeric(raw.rateLow),high:numeric(raw.rateHigh),rateBasisCode:basis,measurementCode:measurement,currencyCode:currency,serviceTypeCode:service,availabilityTypeCode:numeric(raw.availabilityType),availableOnDate:date(raw.availableOnDate),listingStatusCode:status,certifiedFreshDate:date(listing.certifiedFreshDate),dateOnMarket:date(raw.dateOnMarket)};
  return normalizedRecordSchema.parse({...parent,id:`costar-space:${id}`,sourceSpaceId:id,sourceListingId:listingId,recordKind:"listing",name:`${parent.name}${text(raw.suite)?` · Suite ${text(raw.suite)}`:` · Space ${id}`}`,floorAreaSqFt,askingRent,originalRentUnit:`currency=${currency??"unknown"}; measurement=${measurement??"unknown"}; rateBasis=${basis??"unknown"}`,rentBasis:`${low??"unknown"}${high!==null&&high!==low?`–${high}`:""} ${currency===1?"USD":`currency code ${currency??"unknown"}`} / ${measurement===1?"SF":`measurement code ${measurement??"unknown"}`} / ${basis===1?"month":basis===2?"year":"unknown period"}; ${SERVICES[service??0]??"Unknown service"}; ${status===1?"marketed Active in snapshot":status===3?"OffMarket in snapshot":`listing status ${status??"unknown"}`}; ${floorAreaSqFt===null?`area range ${min??"unknown"}–${max??"unknown"} SF; exact scenario area unknown`:"exact offered area"}`,availability:"unknown",recordDate:date(listing.certifiedFreshDate),datasetDate:settings.datasetDate??null,sourceRent,sourceIds:[...parent.sourceIds,`costar:listing:${listingId}`],isDemo:false});
}
function initialize(db:DatabaseSync) {
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE properties(id TEXT PRIMARY KEY,property_id TEXT UNIQUE NOT NULL,city_id TEXT NOT NULL,lat REAL,lon REAL,h3 TEXT,floor_area REAL,monthly_rent REAL,annual_rate REAL,service_code INTEGER,availability TEXT,property_type TEXT,payload TEXT NOT NULL);
    CREATE TABLE listings(listing_id TEXT PRIMARY KEY,property_id TEXT,status INTEGER,created_date TEXT,certified_date TEXT,status_date TEXT,measurement_code INTEGER,currency_code INTEGER);
    CREATE TABLE spaces(id TEXT PRIMARY KEY,property_id TEXT NOT NULL REFERENCES properties(property_id),listing_id TEXT NOT NULL REFERENCES listings(listing_id),city_id TEXT NOT NULL,lat REAL,lon REAL,h3 TEXT,floor_area REAL,monthly_rent REAL,annual_rate REAL,service_code INTEGER,availability TEXT,property_type TEXT,payload TEXT NOT NULL);
    CREATE INDEX properties_viewport ON properties(city_id,lon,lat);
    CREATE INDEX spaces_viewport ON spaces(city_id,lon,lat);
    CREATE INDEX properties_h3 ON properties(h3,city_id);
    CREATE INDEX spaces_h3 ON spaces(h3,city_id);
    CREATE INDEX spaces_property ON spaces(property_id);
    CREATE VIEW records AS SELECT 'property' kind,id,property_id,city_id,lat,lon,h3,floor_area,monthly_rent,annual_rate,service_code,availability,property_type,payload FROM properties UNION ALL SELECT 'listing',id,property_id,city_id,lat,lon,h3,floor_area,monthly_rent,annual_rate,service_code,availability,property_type,payload FROM spaces;`);
}
function insertRecord(db:DatabaseSync,table:"properties"|"spaces",r:NormalizedRecord) {
  const service=(r as NormalizedRecord & {sourceRent?:{serviceTypeCode:number|null}}).sourceRent?.serviceTypeCode??null;
  const values:SQLInputValue[]=[r.id,r.sourcePropertyId,r.cityId,r.latitude,r.longitude,r.h3Index,r.floorAreaSqFt,baseRentMonthly(r.askingRent,r.floorAreaSqFt),r.askingRent?.unit==="USD_PER_SF_YEAR"?r.askingRent.amount:null,service,r.availability,r.propertyType,JSON.stringify(r)];
  const columns="id,property_id,city_id,lat,lon,h3,floor_area,monthly_rent,annual_rate,service_code,availability,property_type,payload";
  if(table==="spaces"){db.prepare(`INSERT INTO spaces(${columns},listing_id) VALUES(${values.map(()=>"?").join(",")},?)`).run(...values,r.sourceListingId);}
  else db.prepare(`INSERT INTO properties(${columns}) VALUES(${values.map(()=>"?").join(",")})`).run(...values);
}

/** Rebuilds into a sibling file and publishes only a fully committed, validated cache. */
export async function importLocalDataset(value?:LocalConfig):Promise<ImportReport> {
  const settings=config(value);if(!settings.rootPath)throw new LocalDataError("not_configured","Set EXPANSION_COSTAR_ROOT to the extracted CoStar kit.");
  if(settings.datasetDate&&!/^\d{4}-\d{2}-\d{2}$/.test(settings.datasetDate))throw new LocalDataError("invalid_query","Dataset date must be YYYY-MM-DD, if documented.");
  const report:ImportReport={accepted:{properties:0,listings:0,spaces:0},rejected:0,duplicates:0,reasons:{},warnings:{}};
  mkdirSync(dirname(settings.dbPath),{recursive:true});
  const temporary=`${settings.dbPath}.import-${process.pid}.tmp`;
  // The only removed file is this import's fixed sibling, never a directory or supplied source path.
  if(existsSync(temporary))rmSync(temporary);
  const db=new DatabaseSync(temporary);
  try {
    initialize(db);db.exec("BEGIN IMMEDIATE");
    const propertyFile=sourceFile(settings.rootPath,"commercial-property");
    const listingFile=sourceFile(settings.rootPath,"commercial-listing-summary");
    for await(const value of streamRecords(propertyFile)){
      try{
        const raw=object(value);const r=propertyRecord(raw,settings);
        if(db.prepare("SELECT 1 FROM properties WHERE id=?").get(r.id)){report.duplicates++;continue;}
        insertRecord(db,"properties",r);report.accepted.properties++;
        if(r.h3Index===null)warning(report,"missing_coordinates");
      }catch(e){reject(report,e instanceof Error&&/^[a-z_]+$/.test(e.message)?e.message:"invalid_property_record");}
    }
    for await(const value of streamRecords(listingFile)){
      const raw=object(value),id=sourceId(raw.id);
      if(!id){reject(report,"invalid_listing_id");continue;}
      if(db.prepare("SELECT 1 FROM listings WHERE listing_id=?").get(id)){report.duplicates++;continue;}
      db.prepare("INSERT INTO listings VALUES(?,?,?,?,?,?,?,?)").run(id,sourceId(raw.propertyId),numeric(raw.listingStatus),date(raw.createdDate),date(raw.certifiedFreshDate),date(raw.listingStatusUpdatedDate),numeric(object(raw.forLeaseSummary).askingRateMeasurementType),numeric(raw.monetaryUnit));report.accepted.listings++;
      const spaces=object(raw.forLeaseSummary).spaces;
      if(!Array.isArray(spaces))continue;
      for(const s of spaces){
        try{
          const space=object(s);const parentId=sourceId(space.propertyId);
          const parent=parentId?db.prepare("SELECT payload FROM properties WHERE property_id=?").get(parentId):undefined;
          if(!parent){reject(report,"unknown_space_property");continue;}
          const r=spaceRecord(space,raw,stored(parent),settings,report);
          if(db.prepare("SELECT 1 FROM spaces WHERE id=?").get(r.id)){report.duplicates++;continue;}
          insertRecord(db,"spaces",r);report.accepted.spaces++;
        }catch(e){reject(report,e instanceof Error&&/^[a-z_]+$/.test(e.message)?e.message:"invalid_space_record");}
      }
    }
    const importedAt=new Date().toISOString();
    const mappableCount=Number(db.prepare("SELECT COUNT(*) n FROM records WHERE h3 IS NOT NULL").get()!.n);
    const meta={mode:"local",datasetId:settings.datasetId??"costar-matterport-snapshot",provider:"CoStar local snapshot",datasetDate:settings.datasetDate??null,importedAt,rights:RIGHTS,propertyCount:report.accepted.properties,listingCount:report.accepted.spaces,mappableCount,notes:["Dated, nonrepresentative Matterport-capture sample for Houston and Los Angeles; no marketwide coverage claim.","Dataset release date is unknown unless explicitly supplied from source documentation; import time is separate.","Properties and offered spaces are separate records. An active marketing snapshot does not verify current availability or vacancy.","Building floor area is not offered suite area. Divisible area and asking-rent ranges remain unknown for exact financial calculation.","H3 metrics count all source records in a cell. Mean asking rent is available only for exact USD/SF/year quotes with one recorded service type; mixed services remain unknown.","No demographic, competition, demand or composite suitability scores are supported."]};
    db.prepare("INSERT INTO meta VALUES('schemaVersion',?)").run(SCHEMA_VERSION);
    db.prepare("INSERT INTO meta VALUES('metadata',?)").run(JSON.stringify(meta));
    db.prepare("INSERT INTO meta VALUES('importReport',?)").run(JSON.stringify(report));
    db.exec("COMMIT");markets(db);db.close();
    renameSync(temporary,settings.dbPath);return report;
  }catch(e){try{db.close();}catch{}if(existsSync(temporary))rmSync(temporary);if(e instanceof LocalDataError)throw e;throw new LocalDataError("source_failure","Import failed. Check source files and configuration; the previous cache was preserved.");}
}
