import { layoutLibrarySchema, type LayoutLibrary } from "../domain/layout-library.ts";

export const maxLibraryBytes = 4 * 1024 * 1024;
type Store = Pick<Storage, "getItem" | "setItem">;

export function parseLibraryBackup(raw: string, restaurantId: string) {
  if (new TextEncoder().encode(raw).length > maxLibraryBytes) throw new Error("Library backups must be 4 MB or smaller.");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Choose a valid library JSON backup."); }
  const parsed = layoutLibrarySchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid library: ${parsed.error.issues[0].message}`);
  if (parsed.data.entries.some(entry => entry.layout.restaurantId !== restaurantId)) throw new Error("This library belongs to a different restaurant.");
  return parsed.data;
}

export function writeLibrary(store: Store, key: string, expected: string | null, library: LayoutLibrary, restaurantId: string, recover = false) {
  const encoded = JSON.stringify(library);
  parseLibraryBackup(encoded, restaurantId);
  if (store.getItem(key) !== expected) throw new Error("Another tab changed the saved library. Export your draft, then reload the saved library before saving again.");
  // Keep the previous bytes before an explicit whole-library replacement, including corrupt data.
  if (recover && expected !== null) store.setItem(`${key}:recovery`, expected);
  store.setItem(key, encoded);
  return encoded;
}

export function downloadJson(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
