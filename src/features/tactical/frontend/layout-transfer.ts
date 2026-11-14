import { layoutSchema, type Layout } from "../domain/schemas.ts";

export const maxLayoutFileBytes = 1_048_576;

export function parseLayoutFile(text: string, restaurantId: string): Layout {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Choose a valid layout JSON file.");
  }

  const parsed = layoutSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Layout could not be loaded. ${issue.path.join(".")} — ${issue.message}`);
  }
  if (parsed.data.restaurantId !== restaurantId) {
    throw new Error("This layout belongs to a different restaurant. Choose a layout exported for the current restaurant.");
  }
  return parsed.data;
}

export async function readLayoutFile(file: Pick<File, "size" | "text">, restaurantId: string) {
  if (file.size > maxLayoutFileBytes) {
    throw new Error("Choose a layout JSON file smaller than 1 MB.");
  }
  return parseLayoutFile(await file.text(), restaurantId);
}
