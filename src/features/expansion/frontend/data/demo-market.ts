import demo from "./demo-market.json" with { type: "json" };
import { datasetSchema } from "../../domain/schemas.ts";
import type { ExpansionProvider } from "../../domain/provider.ts";

export const fixtureProvider: ExpansionProvider = {
  mode: "fixture",
  async load(signal) {
    signal?.throwIfAborted();
    return datasetSchema.parse(demo);
  },
};
