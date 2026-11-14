# RestaurantOS — Shared Contract Proposal (for Asilbek → Rain handoff)

> **DRAFT ONLY.** These are proposed TypeScript concepts, not yet code or a finalized cross-team API. Rain's future spec may adjust them. Do not create or modify shared schemas without coordinating with both developers.

## Why a shared contract?

Tactical and Expansion are separate development domains within one product. They must speak the same language for restaurant identity, evidence, recommendation/mission cards, and saved scenarios, without importing each other's internal components.

## Candidate types

```ts
export type DataOrigin =
  | "observed"      // supplied record: review, property field, sales line
  | "derived"       // deterministic computation from records
  | "assumed"       // editable user/model-suggested planning input
  | "simulated"     // generated scenario or sandbox/demo-world value
  | "unavailable";

export type EvidenceSource = {
  id: string;
  restaurantId: string;
  kind: "review" | "menu" | "finance" | "photo" | "property" | "other";
  label: string;
  origin: DataOrigin;
  isDemo: boolean;
  capturedAt?: string; // ISO date; not assumed to be a publication date
};

export type Recommendation = {
  id: string;
  restaurantId: string;
  domain: "tactical" | "expansion";
  title: string;
  summary: string;
  evidenceIds: string[];
  assumptions: string[];
  missingData: string[];
  confidence: "low" | "medium" | "high" | "unassessed";
  priority: "low" | "medium" | "high";
  action: {
    type: string; // discriminate with an agreed union later
    payload: Record<string, unknown>;
  };
};

export type SimulationScenario<TInputs = unknown, TResults = unknown> = {
  id: string;
  restaurantId: string;
  domain: "tactical" | "expansion";
  label: string;
  baselineId?: string;
  inputs: TInputs;    // validated by domain-specific Zod schema
  results: TResults;  // calculated in tested domain/shared functions
  assumptionNotes: string[];
  evidenceIds: string[];
  modelVersion: string;
  createdAt: string;
};
```

### Proposal for schema organization

```text
src/schemas/shared.ts                  # finalized stable types/Zod schemas
src/features/tactical/schemas.ts       # domain-specific inputs, output
src/features/expansion/schemas.ts      # Rain-owned domain schema
src/lib/decision/                      # shared pure numerical functions
```

Use Zod `safeParse` at external boundaries. For dynamic `action.type`, replace `Record<string, unknown>` with a **Zod discriminated union** once real actions are settled. Don't ship generic unvalidated payloads from untrusted services.

## Cross-domain handoff example

A Tactical recommendation could declare `action.type = "explore_expansion"` with a validated payload containing `minSeats` and `preferredCity` (only if supported). The UI offers a **user-approved** link to Rain's Expansion workspace with those filters. Expansion remains responsible for scoring cells and properties; Tactical has no knowledge of H3 or map internals.

The reverse direction can provide a selected property's explicit operating costs as *assumptions* in a shared financial scenario. Avoid silently treating a property's asking rent as total occupancy cost or as a confirmed lease.

## Contracts to finalize together later

1. Restaurant ID and location/seat fields.
2. `Recommendation` vs `Mission`: whether a mission wraps one recommendation and multiple actions.
3. `EvidenceSource` metadata and citation/view permissions.
4. Domain-specific scenario discriminated unions and unit conventions.
5. Game HUD indicators and definitions; no default fabricated 'happiness' or 'score'.
6. Common error/loading/demo-data indicators.
7. Action navigation protocol for Tactical → Expansion.

Until agreed: use local domain types and small adapter functions rather than silently freezing shared APIs.
