import { tacticalDatabase } from "./mongodb.ts";
import { analyzedReviewSchema, type AnalyzedReview } from "../domain/review-analysis.ts";

export interface ReviewAnalysisRepository {
  read(keys: string[]): Promise<Map<string, AnalyzedReview>>;
  claim(key: string, owner: string, now: number): Promise<boolean>;
  complete(key: string, owner: string, value: AnalyzedReview): Promise<void>;
  release(key: string, owner: string): Promise<void>;
}
type Document = { _id: string; owner?: string; leaseUntil?: number; value?: AnalyzedReview };
const collection = async () => (await tacticalDatabase()).collection<Document>("tactical_review_analysis");
export const mongoReviewAnalysis: ReviewAnalysisRepository = {
  async read(keys) {
    if (!keys.length) return new Map();
    const rows = await (await collection()).find({ _id: { $in: keys }, value: { $exists: true } }).toArray();
    return new Map(rows.map(row => [row._id, analyzedReviewSchema.parse(row.value)]));
  },
  async claim(key, owner, now) {
    try {
      // _id uniqueness prevents two workers from leasing the same review. Ready rows never match.
      const result = await (await collection()).updateOne({ _id: key, value: { $exists: false }, $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: { $exists: false } }] },
        { $set: { owner, leaseUntil: now + 90_000 } }, { upsert: true });
      return result.matchedCount === 1 || result.upsertedCount === 1;
    } catch (error) {
      if (typeof error === "object" && error && "code" in error && error.code === 11000) return false;
      throw error;
    }
  },
  async complete(key, owner, value) {
    const result = await (await collection()).updateOne({ _id: key, owner }, { $set: { value: analyzedReviewSchema.parse(value) }, $unset: { owner: "", leaseUntil: "" } });
    if (result.matchedCount !== 1) throw new Error("Review lease lost");
  },
  async release(key, owner) {
    await (await collection()).updateOne({ _id: key, owner, value: { $exists: false } }, { $set: { leaseUntil: 0 }, $unset: { owner: "" } });
  },
};
