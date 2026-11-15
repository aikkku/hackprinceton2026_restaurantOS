"""Pydantic mirror of the Phase 2 TypeScript contracts plus the Phase 3
agent envelopes.

These models are contract code: they must round-trip the committed JSON
fixtures with the TypeScript Zod schemas in
``src/features/expansion/domain``. Unknown fields, unknown versions, unknown
IDs and invalid numbers are rejected — never coerced.
"""

from __future__ import annotations

import datetime as _dt
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .versions import (
    AGENT_RUN_VERSION,
    ARTIFACT_VERSION,
    EVENT_VERSION,
    FINANCE_TOOL_VERSION,
    INSPECTION_TOOL_VERSION,
    INTAKE_SCHEMA_VERSION,
    MARKET_TOOL_VERSION,
    MATCHING_MODEL_VERSION,
    READINESS_TOOL_VERSION,
    REQUIREMENTS_MODEL_VERSION,
    SEARCH_MODEL_VERSION,
)

# ---------------------------------------------------------------------------
# Shared primitives

Origin = Literal["observed", "derived", "assumed", "simulated", "unavailable"]

ID = Field(min_length=1, max_length=300)
ISO_DT = Field(pattern=r"^\d{4}-\d{2}-\d{2}T")
DATE = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=False,
        str_strip_whitespace=True,
        validate_assignment=True,
    )


def finite_nonneg(v: float) -> float:
    if v != v or v in (float("inf"), float("-inf")) or v < 0:
        raise ValueError("expected a finite nonnegative number")
    return v


class SourceAnswer(StrictModel):
    id: str = ID
    question: str = Field(min_length=1)
    answer: str = Field(min_length=1)


class FollowUpQuestion(StrictModel):
    field: Literal[
        "budget.cashReserveToKeep",
        "space.ventilationRequirements",
        "financialBaseline",
    ]
    question: str = Field(min_length=1)
    blocksInitialSearch: bool
    neededFor: str = Field(min_length=1)


class RestaurantSection(StrictModel):
    name: str = Field(min_length=1)
    cuisine: str = Field(min_length=1)
    serviceType: str = Field(min_length=1)
    currentCity: str = Field(min_length=1)
    currentState: str = Field(min_length=1)
    currentCountry: str = Field(min_length=1)
    sourceAnswerIds: list[str] = Field(default_factory=list)


class ExpansionSection(StrictModel):
    goal: str = Field(min_length=1)
    targetCity: str = Field(min_length=1)
    targetState: str = Field(min_length=1)
    targetCountry: str = Field(min_length=1)
    preferredNeighborhoods: list[str] = Field(default_factory=list)
    otherNeighborhoodsAcceptable: bool
    targetOpeningDate: _dt.date | None = None
    sourceAnswerIds: list[str] = Field(default_factory=list)


class BudgetSection(StrictModel):
    currency: str = Field(min_length=3, max_length=3)
    totalAvailableFunds: float
    cashReserveToKeep: float | None = None
    maximumUpfrontSpending: float | None = None
    maximumMonthlyOccupancyCost: float
    monthlyOccupancyCostIncludes: Literal[
        "base_rent_and_additional_occupancy_charges", "base_rent_only"
    ]
    monthlyOccupancyLimitIsHard: bool
    sourceAnswerIds: list[str] = Field(default_factory=list)

    @field_validator("totalAvailableFunds", "cashReserveToKeep",
                     "maximumUpfrontSpending", "maximumMonthlyOccupancyCost", mode="before")
    @classmethod
    def _finite(cls, v: Any) -> Any:
        if v is None:
            return v
        return finite_nonneg(float(v))

    @model_validator(mode="after")
    def _budget_rules(self) -> "BudgetSection":
        funds = self.totalAvailableFunds
        if self.cashReserveToKeep is not None and self.cashReserveToKeep > funds:
            raise ValueError("The emergency reserve cannot exceed the total available funds.")
        if self.maximumUpfrontSpending is not None and self.maximumUpfrontSpending > funds:
            raise ValueError("Maximum upfront spending cannot exceed the total available funds.")
        if (
            self.cashReserveToKeep is not None
            and self.maximumUpfrontSpending is not None
            and self.cashReserveToKeep + self.maximumUpfrontSpending > funds
        ):
            raise ValueError(
                "The emergency reserve plus maximum upfront spending exceeds the total available funds."
            )
        return self


class SeatRange(StrictModel):
    minimum: int = Field(ge=0)
    maximum: int = Field(ge=0)
    isHardRequirement: bool

    @model_validator(mode="after")
    def _ordered(self) -> "SeatRange":
        if self.minimum > self.maximum:
            raise ValueError("The seat range minimum cannot exceed its maximum.")
        return self


class AreaRange(StrictModel):
    minimum: float | None = None
    maximum: float | None = None

    @model_validator(mode="after")
    def _ordered(self) -> "AreaRange":
        if (
            self.minimum is not None
            and self.maximum is not None
            and self.minimum > self.maximum
        ):
            raise ValueError("The area range minimum cannot exceed its maximum.")
        return self


class SpaceMustHave(StrictModel):
    existingKitchen: bool
    customerParking: bool


class SpaceSection(StrictModel):
    preferredSeats: SeatRange
    areaSqFt: AreaRange
    mustHave: SpaceMustHave
    minimumCustomerParkingSpaces: int | None = Field(default=None, ge=0)
    ventilationRequirements: str | None = None
    sourceAnswerIds: list[str] = Field(default_factory=list)


class FinancialBaseline(StrictModel):
    origin: Literal["observed", "unavailable"]
    currency: str = Field(min_length=3, max_length=3)
    periodStart: _dt.date | None = None
    periodEnd: _dt.date | None = None
    netSales: float | None = None
    guestsServed: float | None = None
    averageSpendPerGuest: float | None = None
    operatingDays: float | None = None
    variableCosts: float | None = None
    fixedLaborCosts: float | None = None
    otherFixedCostsExcludingOccupancy: float | None = None
    sourceAnswerIds: list[str] = Field(default_factory=list)

    @field_validator(
        "netSales", "guestsServed", "averageSpendPerGuest", "operatingDays",
        "variableCosts", "fixedLaborCosts", "otherFixedCostsExcludingOccupancy",
        mode="before",
    )
    @classmethod
    def _finite(cls, v: Any) -> Any:
        if v is None:
            return v
        return finite_nonneg(float(v))


class RestaurantIntake(StrictModel):
    schemaVersion: Literal[INTAKE_SCHEMA_VERSION]
    recordType: Literal["expansion_intake"]
    isDemo: bool
    origin: str = Field(min_length=1)
    description: str
    restaurant: RestaurantSection
    expansion: ExpansionSection
    budget: BudgetSection
    space: SpaceSection
    financialBaseline: FinancialBaseline
    sourceAnswers: list[SourceAnswer]
    followUpQuestions: list[FollowUpQuestion]
    matchingNotes: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _answer_references(self) -> "RestaurantIntake":
        answer_ids = {a.id for a in self.sourceAnswers}
        if len(answer_ids) != len(self.sourceAnswers):
            raise ValueError("Duplicate source answer IDs are not allowed.")
        for name, refs in [
            ("restaurant", self.restaurant.sourceAnswerIds),
            ("expansion", self.expansion.sourceAnswerIds),
            ("budget", self.budget.sourceAnswerIds),
            ("space", self.space.sourceAnswerIds),
            ("financialBaseline", self.financialBaseline.sourceAnswerIds),
        ]:
            if len(set(refs)) != len(refs):
                raise ValueError(f"Duplicate source answer references in {name}.")
            for ref in refs:
                if ref not in answer_ids:
                    raise ValueError(
                        f'Unknown source answer "{ref}" referenced by {name}.'
                    )
        return self


# ---------------------------------------------------------------------------
# Requirements

REQUIREMENT_IDS = [
    "market.target",
    "market.neighborhoodPreference",
    "occupancy.monthlyLimit",
    "occupancy.scope",
    "funds.totalAvailable",
    "funds.emergencyReserve",
    "space.seats",
    "space.areaSqFt",
    "space.existingKitchen",
    "space.customerParking",
    "space.parkingSpacesMinimum",
    "space.ventilation",
    "timeline.openingDate",
    "finance.baseline",
]
RequirementId = Literal[
    "market.target", "market.neighborhoodPreference", "occupancy.monthlyLimit",
    "occupancy.scope", "funds.totalAvailable", "funds.emergencyReserve",
    "space.seats", "space.areaSqFt", "space.existingKitchen",
    "space.customerParking", "space.parkingSpacesMinimum", "space.ventilation",
    "timeline.openingDate", "finance.baseline",
]


class NumberValue(StrictModel):
    kind: Literal["number"]
    value: float


class RangeValue(StrictModel):
    kind: Literal["range"]
    minimum: float | None = None
    maximum: float | None = None


class BooleanValue(StrictModel):
    kind: Literal["boolean"]
    value: bool


class SupportedMarket(StrictModel):
    city: str = Field(min_length=1)
    state: str = Field(min_length=1)
    country: str = Field(min_length=1)


class MarketValue(StrictModel):
    kind: Literal["market"]
    market: SupportedMarket


class NeighborhoodValue(StrictModel):
    kind: Literal["neighborhood"]
    preferred: list[str] = Field(min_length=1)
    othersAcceptable: bool


class TextValue(StrictModel):
    kind: Literal["text"]
    value: str | None = None


class UnknownValue(StrictModel):
    kind: Literal["unknown"]


RequirementValue = (
    NumberValue | RangeValue | BooleanValue | MarketValue | NeighborhoodValue
    | TextValue | UnknownValue
)


class Requirement(StrictModel):
    id: RequirementId
    kind: Literal["hard", "soft"]
    label: str = Field(min_length=1)
    value: RequirementValue
    unit: str | None = None
    origin: Origin
    state: Literal["known", "unknown"]
    sourceAnswerIds: list[str] = Field(default_factory=list)
    originalSourceAnswerIds: list[str] = Field(default_factory=list)
    editedAt: str | None = None
    note: str

    @model_validator(mode="after")
    def _rules(self) -> "Requirement":
        if (
            isinstance(self.value, RangeValue)
            and self.value.minimum is not None
            and self.value.maximum is not None
            and self.value.minimum > self.value.maximum
        ):
            raise ValueError("The range minimum cannot exceed its maximum.")
        if self.state == "unknown" and not (
            isinstance(self.value, UnknownValue)
            or (isinstance(self.value, TextValue) and self.value.value is None)
        ):
            raise ValueError("A known value cannot be labeled unknown.")
        return self


class SearchRequirements(StrictModel):
    modelVersion: Literal[REQUIREMENTS_MODEL_VERSION]
    revisionId: str = ID
    revisionNumber: int = Field(ge=0)
    createdAt: str = ISO_DT
    requirements: list[Requirement] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique(self) -> "SearchRequirements":
        seen: set[str] = set()
        for requirement in self.requirements:
            if requirement.id in seen:
                raise ValueError(f"Duplicate requirement id {requirement.id}.")
            seen.add(requirement.id)
        return self


# ---------------------------------------------------------------------------
# Candidates, facts, assessments (expansion-matching-v1)

class SourceRef(StrictModel):
    label: str = Field(min_length=1)
    recordId: str | None = None
    capturedAt: str | None = None


class FactUnknown(StrictModel):
    kind: Literal["unknown"]


class FactExactText(StrictModel):
    kind: Literal["exact"]
    value: str = Field(min_length=1)


class FactExactNumber(StrictModel):
    kind: Literal["exact"]
    value: float


class FactNumberRange(StrictModel):
    kind: Literal["range"]
    minimum: float | None = None
    maximum: float | None = None


class Fact(StrictModel):
    id: str = ID
    entityScope: Literal["space"]
    entityId: str = ID
    field: Literal[
        "existingKitchen", "customerParking", "seatCapacity",
        "neighborhood", "monthlyAdditionalCharges",
    ]
    value: FactUnknown | FactExactText | FactExactNumber | FactNumberRange
    unit: Literal["seats", "USD/month", None]
    origin: Origin
    source: SourceRef
    method: str | None = None
    limitations: list[str] = Field(default_factory=list)
    isDemo: bool


class RentQuote(StrictModel):
    low: float | None = None
    high: float | None = None
    rateBasisCode: int | None = None
    currencyCode: int | None = None
    measurementCode: int | None = None
    serviceTypeCode: int | None = None


class SizeRange(StrictModel):
    minimum: float | None = None
    maximum: float | None = None


class SpaceCandidate(StrictModel):
    id: str = ID
    name: str = Field(min_length=1)
    address: str | None = None
    suite: str | None = None
    cityId: str = Field(min_length=1)
    latitude: float | None = None
    longitude: float | None = None
    h3Index: str | None = None
    floorAreaSqFt: float | None = None
    sizeRangeSqFt: SizeRange
    rent: RentQuote | None = None
    spaceUseCode: int | None = None
    listingStatusCode: int | None = None
    propertyId: str = ID
    sourceIds: list[str] = Field(min_length=1)
    recordDate: str | None = None
    datasetDate: str | None = None
    isDemo: bool

    @field_validator("latitude")
    @classmethod
    def _lat(cls, v: float | None) -> float | None:
        if v is not None and not (-90 <= v <= 90):
            raise ValueError("latitude out of range")
        return v

    @field_validator("longitude")
    @classmethod
    def _lon(cls, v: float | None) -> float | None:
        if v is not None and not (-180 <= v <= 180):
            raise ValueError("longitude out of range")
        return v


ASSESSMENT_STATUSES = ["pass", "fail", "unknown", "not_applicable"]
ASSESSMENT_REASON_CODES = [
    "below_cap", "exceeds_cap", "range_crosses_cap", "missing_charges",
    "ambiguous_basis", "unsupported_units", "kitchen_verified",
    "kitchen_absent", "kitchen_unverified", "parking_verified",
    "parking_absent", "parking_unverified", "capacity_aligned",
    "capacity_mismatch", "capacity_unknown", "neighborhood_member",
    "neighborhood_other", "neighborhood_unresolved", "not_applicable",
    "unknown_value",
]


class Assessment(StrictModel):
    requirementId: RequirementId
    status: Literal["pass", "fail", "unknown", "not_applicable"]
    reasonCode: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    evidenceIds: list[str] = Field(default_factory=list)
    sourceValue: str = Field(min_length=1)


CandidateGroup = Literal[
    "meets_assessed_requirements", "needs_verification", "does_not_meet"
]


class AssessedCandidate(StrictModel):
    candidate: SpaceCandidate
    assessments: list[Assessment] = Field(min_length=1)
    group: CandidateGroup
    rank: int = Field(ge=0)
    orderingNotes: list[str] = Field(default_factory=list)


class ExcludedCandidate(StrictModel):
    id: str = ID
    name: str = Field(min_length=1)
    reasonCode: Literal[
        "off_market", "unknown_marketing_status", "incompatible_space_use"
    ]
    reason: str = Field(min_length=1)


class SearchCounts(StrictModel):
    examined: int = Field(ge=0)
    included: int = Field(ge=0)
    excluded: int = Field(ge=0)
    offMarket: int = Field(ge=0)
    unknownMarketingStatus: int = Field(ge=0)
    incompatibleUse: int = Field(ge=0)
    useUnknown: int = Field(ge=0)
    scanCapped: bool
    meets: int = Field(ge=0)
    needsVerification: int = Field(ge=0)
    doesNotMeet: int = Field(ge=0)


# ---------------------------------------------------------------------------
# Agent run request and record

RunStatus = Literal[
    "queued", "running", "completed", "completed_with_gaps", "failed", "cancelled"
]
ExecutionMode = Literal["live", "scripted"]
StageName = Literal["readiness", "market", "site_scout", "space_inspector", "finance"]
StageStatus = Literal["completed", "unavailable", "failed", "not_run"]


class FinanceInputs(StrictModel):
    fixedCostsMonthly: float | None = None
    contributionMargin: float | None = None
    origin: Literal["derived", "unavailable"]
    reasons: list[str] = Field(default_factory=list)


class ProfileArtifact(StrictModel):
    artifactVersion: Literal[ARTIFACT_VERSION]
    modelVersion: Literal[REQUIREMENTS_MODEL_VERSION]
    intakeSchemaVersion: Literal[INTAKE_SCHEMA_VERSION]
    revisionId: str = ID
    revisionNumber: int = Field(ge=0)
    cityId: str = Field(min_length=1)
    intake: RestaurantIntake
    requirements: SearchRequirements
    followUpQuestions: list[FollowUpQuestion] = Field(default_factory=list)
    financeInputs: FinanceInputs

    @model_validator(mode="after")
    def _revision_matches(self) -> "ProfileArtifact":
        if self.requirements.revisionId != self.revisionId:
            raise ValueError("Requirements revision id does not match the artifact.")
        if self.requirements.revisionNumber != self.revisionNumber:
            raise ValueError("Requirements revision number does not match the artifact.")
        return self


class AgentRunRequest(StrictModel):
    requestVersion: Literal[AGENT_RUN_VERSION]
    runId: str = ID
    sessionId: str = ID
    cityId: str = Field(min_length=1)
    executionMode: ExecutionMode
    createdAt: str = ISO_DT
    datasetId: str | None = None
    datasetDate: str | None = None
    profile: ProfileArtifact


class AgentModelInfo(StrictModel):
    framework: str = Field(min_length=1)
    provider: str | None = None
    modelId: str | None = None
    label: str = Field(min_length=1)


class AgentRunProfileRef(StrictModel):
    revisionId: str = ID
    revisionNumber: int = Field(ge=0)


class AgentRunError(StrictModel):
    code: str = Field(min_length=1)
    message: str = Field(min_length=1)


class AgentRunRecord(StrictModel):
    version: Literal[AGENT_RUN_VERSION]
    runId: str = ID
    sessionId: str = ID
    status: RunStatus
    executionMode: ExecutionMode
    createdAt: str = ISO_DT
    updatedAt: str = ISO_DT
    completedAt: str | None = None
    cancelledAt: str | None = None
    cityId: str = Field(min_length=1)
    datasetId: str | None = None
    datasetDate: str | None = None
    profile: AgentRunProfileRef
    requirementsHash: str = Field(min_length=1)
    model: AgentModelInfo | None = None
    toolCalls: dict[str, int] = Field(default_factory=dict)
    stages: dict[StageName, StageStatus] = Field(default_factory=dict)
    error: AgentRunError | None = None


# ---------------------------------------------------------------------------
# Specialized artifacts

class SourceCapability(StrictModel):
    source: str = Field(min_length=1)
    status: Literal["available", "configured", "not_configured", "unavailable"]
    reason: str = Field(min_length=1)
    detail: str | None = None


class MarketDatasetInfo(StrictModel):
    datasetId: str = Field(min_length=1)
    datasetDate: str | None = None
    propertyCount: int = Field(ge=0)
    listingCount: int = Field(ge=0)
    spaceCount: int = Field(ge=0)
    mappableCount: int = Field(ge=0)


class MarketArtifact(StrictModel):
    artifactVersion: Literal[ARTIFACT_VERSION]
    modelVersion: Literal[MARKET_TOOL_VERSION]
    runId: str = ID
    cityId: str = Field(min_length=1)
    sourced: bool
    dataset: MarketDatasetInfo | None = None
    sourceCapabilities: list[SourceCapability] = Field(default_factory=list)
    unavailableReasons: list[str] = Field(default_factory=list)


class SearchArtifact(StrictModel):
    artifactVersion: Literal[ARTIFACT_VERSION]
    modelVersion: Literal[SEARCH_MODEL_VERSION]
    matchingModelVersion: Literal[MATCHING_MODEL_VERSION]
    requirementsModelVersion: Literal[REQUIREMENTS_MODEL_VERSION]
    runId: str = ID
    cityId: str = Field(min_length=1)
    datasetId: str | None = None
    datasetDate: str | None = None
    searchedAt: str = ISO_DT
    cancelled: bool
    requirements: SearchRequirements
    counts: SearchCounts
    candidates: list[AssessedCandidate] = Field(default_factory=list)
    excluded: list[ExcludedCandidate] = Field(default_factory=list)
    excludedTruncated: bool = False


class InspectionEntry(StrictModel):
    candidateId: str = ID
    name: str = Field(min_length=1)
    candidate: SpaceCandidate
    assessments: list[Assessment] = Field(default_factory=list)
    gaps: list[Assessment] = Field(default_factory=list)
    verificationTasks: list[str] = Field(default_factory=list)


class InspectionArtifact(StrictModel):
    artifactVersion: Literal[ARTIFACT_VERSION]
    modelVersion: Literal[INSPECTION_TOOL_VERSION]
    runId: str = ID
    inspectedAt: str = ISO_DT
    candidates: list[InspectionEntry] = Field(default_factory=list)
    notFoundIds: list[str] = Field(default_factory=list)


class OccupancyResult(StrictModel):
    candidateId: str = ID
    known: bool
    low: float | None = Field(default=None, ge=0)
    high: float | None = Field(default=None, ge=0)
    notes: list[str] = Field(default_factory=list)
    reasonCode: str | None = None
    reason: str | None = None
    serviceInclusion: Literal["included", "not_included", "unknown"]


class RequiredSalesResult(StrictModel):
    status: Literal["available", "unavailable"]
    requiredSalesMonthly: float | None = Field(default=None, ge=0)
    reason: str | None = None
    fixedCostsMonthly: float | None = Field(default=None, ge=0)
    contributionMargin: float | None = Field(default=None, ge=0, le=1)
    inputOrigin: Literal["derived", "unavailable"]


class FinanceArtifact(StrictModel):
    artifactVersion: Literal[ARTIFACT_VERSION]
    modelVersion: Literal[FINANCE_TOOL_VERSION]
    runId: str = ID
    evaluatedAt: str = ISO_DT
    occupancy: list[OccupancyResult] = Field(default_factory=list)
    requiredSales: RequiredSalesResult | None = None
    missingInputs: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)


class StageReport(StrictModel):
    stage: StageName
    status: StageStatus
    digest: str = Field(min_length=1)
    candidateIds: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)


class SummaryArtifact(StrictModel):
    artifactVersion: Literal[ARTIFACT_VERSION]
    modelVersion: Literal[AGENT_RUN_VERSION]
    runId: str = ID
    executionMode: ExecutionMode
    terminalStatus: Literal["completed", "completed_with_gaps"]
    stageReports: list[StageReport] = Field(default_factory=list)
    summaryText: str = Field(min_length=1)
    missingEvidence: list[str] = Field(default_factory=list)
    followUps: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    groundedCandidateIds: list[str] = Field(default_factory=list)
    completedAt: str = ISO_DT


# ---------------------------------------------------------------------------
# Events

EventType = Literal[
    "run.started",
    "stage.started",
    "stage.completed",
    "stage.incomplete",
    "tool.completed",
    "unavailable",
    "run.completed",
    "run.cancelled",
    "run.failed",
]


class AgentEvent(StrictModel):
    eventVersion: Literal[EVENT_VERSION]
    seq: int = Field(default=0, ge=0)
    runId: str = ID
    ts: str | None = None
    type: EventType
    stage: StageName | Literal["planner"] | None = None
    payload: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Tool bridge output mirrors (what the worker validates after each call)

class ReadinessMissingItem(StrictModel):
    requirementId: str = Field(min_length=1)
    label: str = Field(min_length=1)
    neededFor: str = Field(min_length=1)


class ReadinessCompleteness(StrictModel):
    known: list[str] = Field(default_factory=list)
    unknown: list[str] = Field(default_factory=list)
    missing: list[ReadinessMissingItem] = Field(default_factory=list)


class ReadinessToolOutput(StrictModel):
    modelVersion: Literal[READINESS_TOOL_VERSION]
    intakeSchemaVersion: Literal[INTAKE_SCHEMA_VERSION]
    requirementsModelVersion: Literal[REQUIREMENTS_MODEL_VERSION]
    revisionId: str = ID
    revisionNumber: int = Field(ge=0)
    followUpQuestions: list[FollowUpQuestion] = Field(default_factory=list)
    completeness: ReadinessCompleteness
    tacticalReport: None = None
    note: str = Field(min_length=1)


class MarketToolOutput(StrictModel):
    modelVersion: Literal[MARKET_TOOL_VERSION]
    cityId: str = Field(min_length=1)
    sourced: bool
    dataset: MarketDatasetInfo | None = None
    sourceCapabilities: list[SourceCapability] = Field(default_factory=list)
    unavailableReasons: list[str] = Field(default_factory=list)


class ScoutTopAssessment(StrictModel):
    requirementId: str = Field(min_length=1)
    status: Literal["pass", "fail", "unknown", "not_applicable"]
    reasonCode: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class ScoutTopCandidate(StrictModel):
    id: str = ID
    name: str = Field(min_length=1)
    group: CandidateGroup
    rank: int = Field(ge=0)
    serviceInclusion: Literal["included", "not_included", "unknown"]
    topAssessment: ScoutTopAssessment


class ScoutToolOutput(StrictModel):
    modelVersion: Literal[SEARCH_MODEL_VERSION]
    matchingModelVersion: Literal[MATCHING_MODEL_VERSION]
    requirementsModelVersion: Literal[REQUIREMENTS_MODEL_VERSION]
    cityId: str = Field(min_length=1)
    datasetId: str | None = None
    datasetDate: str | None = None
    searchedAt: str = ISO_DT
    cancelled: bool
    counts: SearchCounts
    candidateIds: list[str] = Field(default_factory=list)
    topCandidates: list[ScoutTopCandidate] = Field(default_factory=list)
    excluded: list[ExcludedCandidate] = Field(default_factory=list)
    excludedTruncated: bool = False


class InspectionToolOutput(StrictModel):
    modelVersion: Literal[INSPECTION_TOOL_VERSION]
    inspected: list[InspectionEntry] = Field(default_factory=list)
    notFoundIds: list[str] = Field(default_factory=list)
