import { conversationSchema, type Conversation, type ConversationSummary } from "../../domain/assistant.ts";
import { datasetSchema } from "../../domain/dataset.ts";
import { tacticalDatabase, tacticalMongoClient, mongoDatasets, type DatasetRecord } from "../mongodb.ts";
import { demoRecord, saveDemoRecord } from "../demo-store.ts";
export class AssistantConflict extends Error {}
export interface AssistantRepository {
  storage: "mongodb" | "session";
  dataset(): Promise<DatasetRecord>;
  list(restaurantId: string): Promise<ConversationSummary[]>;
  read(id: string, restaurantId: string): Promise<Conversation | null>;
  save(thread: Conversation, expected: number): Promise<void>;
  apply(thread: Conversation, expected: number, record: DatasetRecord, datasetRevision: number): Promise<void>;
}
const summary = (thread: Conversation): ConversationSummary => ({ id: thread.id, title: thread.title, updatedAt: thread.updatedAt, revision: thread.revision });
export function memoryAssistantRepository(initial?: DatasetRecord): AssistantRepository {
  let local = initial ? structuredClone(initial) : null;
  const threads = new Map<string, Conversation>();
  function check(thread: Conversation, expected: number) {
    const old = threads.get(thread.id);
    if ((old?.revision ?? 0) !== expected || (old && old.restaurantId !== thread.restaurantId)) throw new AssistantConflict();
    if (!old && threads.size >= 100) throw new Error("Session conversation limit");
  }
  return {
    storage: "session",
    async dataset() { return structuredClone(local ?? demoRecord()); },
    async list(id) { return [...threads.values()].filter(row => row.restaurantId === id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30).map(summary); },
    async read(id, restaurantId) { const row = threads.get(id); return row?.restaurantId === restaurantId ? structuredClone(row) : null; },
    async save(thread, expected) { check(thread, expected); threads.set(thread.id, conversationSchema.parse(structuredClone(thread))); },
    async apply(thread, expected, record, datasetRevision) {
      check(thread, expected);
      const parsed = conversationSchema.parse(thread);
      datasetSchema.parse(record.dataset);
      if (local) { if (local.revision !== datasetRevision) throw new AssistantConflict(); local = structuredClone(record); }
      else if (!saveDemoRecord(record, datasetRevision)) throw new AssistantConflict();
      threads.set(thread.id, structuredClone(parsed));
    },
  };
}
const state = globalThis as typeof globalThis & { tacticalAssistantMemory?: AssistantRepository };
const collection = async () => (await tacticalDatabase()).collection<Conversation & { _id: string }>("tactical_conversations");
export function assistantRepository(): AssistantRepository {
  const mode = process.env.TACTICAL_DATA_SOURCE ?? "demo";
  if (mode === "demo") return state.tacticalAssistantMemory ??= memoryAssistantRepository();
  if (mode !== "mongodb") throw new Error("Unknown source");
  return {
    storage: "mongodb",
    async dataset() { const record = await mongoDatasets.read(process.env.TACTICAL_RESTAURANT_ID ?? ""); if (!record) throw new Error("Missing restaurant"); return record; },
    async list(restaurantId) { return (await (await collection()).find({ restaurantId }, { projection: { id: 1, title: 1, updatedAt: 1, revision: 1 } }).sort({ updatedAt: -1, _id: 1 }).limit(30).toArray()).map(summary); },
    async read(id, restaurantId) { const row = await (await collection()).findOne({ _id: id, restaurantId }); return row ? conversationSchema.parse(row) : null; },
    async save(thread, expected) {
      const parsed = conversationSchema.parse(thread), rows = await collection();
      if (expected === 0) {
        try { await rows.insertOne({ ...parsed, _id: parsed.id }); }
        catch (error) { if (typeof error === "object" && error && "code" in error && error.code === 11000) throw new AssistantConflict(); throw error; }
      } else {
        const result = await rows.replaceOne({ _id: thread.id, restaurantId: thread.restaurantId, revision: expected }, parsed);
        if (result.matchedCount !== 1) throw new AssistantConflict();
      }
    },
    async apply(thread, expected, record, datasetRevision) {
      const parsed = conversationSchema.parse(thread);
      datasetSchema.parse(record.dataset);
      const session = (await tacticalMongoClient()).startSession();
      try {
        await session.withTransaction(async () => {
          const db = await tacticalDatabase();
          const saved = await db.collection<DatasetRecord>("tactical_datasets").replaceOne({ _id: record._id, revision: datasetRevision }, record, { session });
          if (saved.matchedCount !== 1) throw new AssistantConflict();
          const chat = await (await collection()).replaceOne({ _id: thread.id, restaurantId: record._id, revision: expected }, parsed, { session });
          if (chat.matchedCount !== 1) throw new AssistantConflict();
        });
      } finally { await session.endSession(); }
    },
  };
}
