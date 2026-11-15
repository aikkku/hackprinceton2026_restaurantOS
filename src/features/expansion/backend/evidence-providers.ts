import { z } from "zod";
import {
  PROVIDER_CONTRACT_VERSION,
  inspectionProviderRequestSchema,
  inspectionProviderResultSchema,
  marketProviderRequestSchema,
  marketProviderResultSchema,
  type AgentProviderAdapters,
} from "../domain/agent-providers.ts";
import type { SourceObservation } from "../domain/evidence.ts";
import { evidenceSchema } from "../domain/schemas.ts";
import { collectCandidateSources, type SourceDependencies } from "./investigation-sources.ts";

/**
 * Phase 4 implementations of the Phase 3 provider hooks
 * (`expansion-agent-providers-v1`, docs/expansion/PHASE3_AGENT_INTERFACES.md).
 *
 * - Live source evidence only. Synthetic fixtures are never returned here, so a
 *   fixture can never reach a worker artifact.
 * - Failures become `unavailable` results with explicit gaps.
 * - NOT registered by default. The Phase 3 worker on `main` does not call the
 *   registry yet; wiring is pending Phase 3 integration (see DECISIONS.md).
 */
type Evidence = z.infer<typeof evidenceSchema>;

const toDateTime = (value: string | null) => {
  if (!value) return null;
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  return z.iso.datetime({ offset: true }).safeParse(candidate).success ? new Date(candidate).toISOString() : null;
};

export function observationEvidence(observation: SourceObservation): Evidence {
  return evidenceSchema.parse({
    id: observation.id, provider: observation.provider, recordId: observation.sourceRecordId,
    label: observation.label, origin: observation.origin, isDemo: observation.isSynthetic,
    observedAt: toDateTime(observation.sourceDate),
    rights: observation.exportAllowed ? "Display and export permitted with attribution" : "Local display only; not exportable",
    notes: [...observation.limitations].join(" ") || "No limitations recorded.",
  });
}

export function createEvidenceProviderAdapters(deps: SourceDependencies = {}): AgentProviderAdapters {
  return {
    async market(raw, signal) {
      const request = marketProviderRequestSchema.parse(raw);
      signal.throwIfAborted();
      // ACS, neighborhood and competition are site/tract-scoped per candidate;
      // no city-level composite model is versioned, so city context is unavailable.
      return marketProviderResultSchema.parse({
        version: PROVIDER_CONTRACT_VERSION, scope: request.scope, cityId: request.cityId, status: "unavailable", evidence: [],
        gaps: ["City-level market context is unscored: Phase 4 sources are candidate-site/tract scoped (ACS tract, Heights lookup, OSM 500 m). No composite model is versioned."],
        context: [],
      });
    },
    async inspect(raw, signal) {
      const request = inspectionProviderRequestSchema.parse(raw);
      signal.throwIfAborted();
      const unavailable = (gap: string) => inspectionProviderResultSchema.parse({
        version: PROVIDER_CONTRACT_VERSION, scope: request.scope, candidateId: request.candidate.id, status: "unavailable", evidence: [], gaps: [gap], facts: [],
      });
      let snapshot;
      try { snapshot = await collectCandidateSources(request.candidate, { currentAddress: null, priceLevel: null }, deps); }
      catch { return unavailable("Evidence sources failed; nothing substituted."); }
      signal.throwIfAborted();
      const live = snapshot.observations.filter(x => !x.isSynthetic && x.candidateId === request.candidate.id);
      const facts = live.flatMap(x => x.facts).filter(f => f.entityId === request.candidate.id && !f.isDemo);
      const verified = snapshot.statuses.filter(x => x.status === "verified").length;
      return inspectionProviderResultSchema.parse({
        version: PROVIDER_CONTRACT_VERSION, scope: request.scope, candidateId: request.candidate.id,
        status: live.length === 0 ? "unavailable" : verified === snapshot.statuses.length ? "available" : "partial",
        evidence: live.map(observationEvidence), gaps: snapshot.gaps.slice(0, 50), facts,
      });
    },
  };
}
