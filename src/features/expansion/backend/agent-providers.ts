import type { AgentProviderAdapters } from "../domain/agent-providers.ts";

/** Explicit server startup registration; no providers are enabled by default. */
const registry = globalThis as typeof globalThis & { __expansionAgentProviders?: Readonly<AgentProviderAdapters> };
export function registerAgentProviders(adapters: AgentProviderAdapters): () => void {
  if (registry.__expansionAgentProviders) throw new Error("Expansion agent providers are already registered");
  registry.__expansionAgentProviders = Object.freeze({...adapters});
  return () => { delete registry.__expansionAgentProviders; };
}
export function getAgentProviders(): Readonly<AgentProviderAdapters> {
  return registry.__expansionAgentProviders ?? {};
}
