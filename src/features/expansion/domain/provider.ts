import type { Dataset } from "./schemas.ts";

/** Boundary shared by the frontend fixture and future server-backed adapters. */
export interface ExpansionProvider {
  readonly mode: "fixture" | "authorized";
  load(signal?: AbortSignal): Promise<Dataset>;
}
