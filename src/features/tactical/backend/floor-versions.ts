import { z } from "zod";
import { authorizedAi, boundedJson, sameOrigin } from "./ai-access.ts";
import { maxDatasetBytes } from "./data-api.ts";
import { mongoDatasets } from "./mongodb.ts";
import { layoutLibrarySchema } from "../domain/layout-library.ts";
import { modernFloorLibrary, sameFloor } from "../domain/floor-editor.ts";
import { datasetSchema, restaurantIdSchema } from "../domain/dataset.ts";

export function createFloorVersionsHandler({
  repository = mongoDatasets,
  restaurantId = () => process.env.TACTICAL_DATA_SOURCE === "mongodb" ? process.env.TACTICAL_RESTAURANT_ID : undefined,
  authorize = authorizedAi,
} = {}) {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  return async (request: Request) => {
    if (!sameOrigin(request) || !authorize(request)) return reply({ error: "Unlock the workspace to save to MongoDB." }, 401);
    const id = restaurantIdSchema.safeParse(restaurantId());
    if (!id.success) return reply({ error: "MongoDB floor plan saving is unavailable." }, 503);
    let input;
    try {
      input = z.object({ library: layoutLibrarySchema }).strict().parse(await boundedJson(request, maxDatasetBytes)).library;
      if (input.entries.some(entry => entry.layout.restaurantId !== id.data)) return reply({ error: "These floor plans belong to a different restaurant." }, 422);
    } catch {
      return reply({ error: "The floor plans could not be validated or exceed the storage limit." }, 422);
    }
    try {
      // Each write only appends versions. Rebase a revision conflict without replacing existing versions.
      for (let attempt = 0; attempt < 3; attempt++) {
        const record = await repository.read(id.data);
        if (!record) break;
        const saved = modernFloorLibrary(record.dataset.layoutConfigurations);
        const entries = [...saved.entries];
        for (const version of modernFloorLibrary(input).entries) {
          const existing = entries.find(entry => entry.id === version.id);
          if (existing && !sameFloor(existing.layout, version.layout)) return reply({ error: "A saved version changed. Reload after keeping your draft changes." }, 409);
          if (!existing) entries.push(version);
        }
        const library = { ...saved, entries, activeId: input.activeId };
        const validated = datasetSchema.safeParse({ ...record.dataset, layoutConfigurations: library });
        if (!validated.success || Buffer.byteLength(JSON.stringify(validated.data)) > maxDatasetBytes) {
          return reply({ error: "The restaurant has reached its limit for saved floor plans." }, 422);
        }
        if (entries.length === saved.entries.length && library.activeId === saved.activeId) return reply({ library, revision: record.revision });
        const updated = await repository.save(validated.data, record.revision);
        if (updated) return reply({ library: updated.dataset.layoutConfigurations, revision: updated.revision });
      }
    } catch {
      return reply({ error: "MongoDB could not save this version. Your draft is still open." }, 503);
    }
    return reply({ error: "Could not save the version yet. Try again." }, 409);
  };
}
