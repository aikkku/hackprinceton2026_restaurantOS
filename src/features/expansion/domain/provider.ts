import type { Dataset } from "./schemas.ts";

/** Injectable fixture boundary. Local mode uses the HTTP contracts in local-data.ts. */
export interface ExpansionProvider {
  readonly mode: "fixture" | "authorized";
  load(signal?: AbortSignal): Promise<Dataset>;
}
