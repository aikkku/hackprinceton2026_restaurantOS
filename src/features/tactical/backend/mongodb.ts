import { MongoClient } from "mongodb";
import { datasetSchema, type Dataset } from "../domain/dataset.ts";

export type DatasetRecord = { _id: string; revision: number; updatedAt: string; dataset: Dataset };
export interface DatasetRepository {
  read(id: string): Promise<DatasetRecord | null>;
  list(): Promise<Array<{ id: string; name: string; revision: number; updatedAt: string }>>;
  save(dataset: Dataset, expectedRevision: number): Promise<DatasetRecord | null>;
}
const state = globalThis as typeof globalThis & { tacticalMongo?: { uri: string; promise: Promise<MongoClient> } };
async function collection() {
  const uri = process.env.MONGODB_URI;
  const db = process.env.MONGODB_DB;
  if (!uri || !db || !/^[A-Za-z0-9_-]{1,64}$/.test(db)) throw new Error("MongoDB is not configured");
  if (!state.tacticalMongo || state.tacticalMongo.uri !== uri) {
    const client = new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 5000, family: 4 });
    const promise = client.connect().catch(async error => {
      if (state.tacticalMongo?.promise === promise) state.tacticalMongo = undefined;
      await client.close();
      throw error;
    });
    state.tacticalMongo = { uri, promise };
  }
  return (await state.tacticalMongo.promise).db(db).collection<DatasetRecord>("tactical_datasets");
}
export const mongoDatasets: DatasetRepository = {
  async read(id) {
    const record = await (await collection()).findOne({ _id: id });
    if (!record) return null;
    const dataset = datasetSchema.parse(record.dataset);
    if (dataset.profile.id !== id || !Number.isSafeInteger(record.revision) || record.revision < 1) throw new Error("Invalid stored envelope");
    return { ...record, dataset };
  },
  async list() {
    const rows = await (await collection()).find({}, { projection: { _id: 1, revision: 1, updatedAt: 1, "dataset.profile.name": 1 } }).sort({ _id: 1 }).limit(100).toArray();
    return rows.map(row => ({ id: row._id, name: row.dataset.profile.name, revision: row.revision, updatedAt: row.updatedAt }));
  },
  async save(dataset, expectedRevision) {
    const parsed = datasetSchema.parse(dataset);
    const record: DatasetRecord = { _id: parsed.profile.id, revision: expectedRevision + 1, updatedAt: new Date().toISOString(), dataset: parsed };
    const records = await collection();
    if (expectedRevision === 0) {
      try { await records.insertOne(record); return record; }
      catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) return null; throw error; }
    }
    const result = await records.replaceOne({ _id: record._id, revision: expectedRevision }, record);
    return result.matchedCount === 1 ? record : null;
  },
};
