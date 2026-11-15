"""The genuine Deep Agents planner and its five specialists.

``create_deep_agent`` from the ``deepagents`` package builds the planner; the
five specialists are framework ``SubAgent`` delegations reachable through the
framework's ``task`` tool. Specialists only call the authenticated bridge
tools (readiness/market/scout/inspector) plus a finance orchestrator that
calls the Phase 2 deterministic finance tools; every structured result is
validated before it is persisted. The planner composes validated outputs via
``finalize_run``; text from the model can never carry canonical numbers or
invent candidate IDs — those come from tool outputs only.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Callable

from deepagents import SubAgent, create_deep_agent
from langchain_core.language_models import BaseChatModel
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.tools import StructuredTool, tool as langchain_tool
from pydantic import BaseModel, Field

from .bridge import BridgeError, RunCancelled, ToolBridge
from .models import (
    AgentRunRequest,
    FinanceArtifact,
    InspectionArtifact,
    OccupancyResult,
    ProfileArtifact,
    RequiredSalesResult,
    SearchArtifact,
)
from .runstate import RunDirectory, iso_now
from .versions import ARTIFACT_VERSION, FINANCE_TOOL_VERSION

FINANCE_MAX_CANDIDATES = 10

PLANNER_SYSTEM_PROMPT = """You are the scouting planner for a restaurant owner's expansion search.
You orchestrate five specialists through the task tool, in this dependency order:
1. readiness — profile completeness and follow-ups (never an invented score)
2. market — sourced market/source context, or explicit unavailable reasons
3. site_scout — the full-city search with deterministic assessments
4. space_inspector — suite-scoped facts, gaps and verification tasks for chosen candidates
5. finance — deterministic required-sales/occupancy results, or missing inputs

Rules:
- Delegate every stage to the named specialist; do not perform their work yourself.
- Delegate exactly ONE specialist per step: call task once, wait for its result, then
  call the next. Never batch several task calls together — inspection and finance
  depend on the site scout's persisted results.
- Site search must run even when market context is missing (scores are not required).
- Inspection follows the site scout; finance follows candidates and the profile snapshot.
- You may not invent candidate IDs, counts, financial numbers, sources or observations.
  Numbers and IDs only ever come from tool outputs; your job is grounded explanation.
- When a specialist reports unavailable results, preserve that honestly; do not fill gaps.
- Finish by calling finalize_run once with your grounded summary. Its validation
  rejects invented IDs and numbers, so quote only what the specialists reported.
"""

READINESS_SYSTEM_PROMPT = """You are the readiness specialist. Call profile_readiness once, read the
validated output, then call finalize_readiness. Report only missing data and follow-ups that
the tool actually returned. Never invent a readiness score or claim the profile is complete
when the tool says it is not. If the output is unavailable, say so explicitly."""

MARKET_SYSTEM_PROMPT = """You are the market specialist. Call market_context once, read the validated output,
then call finalize_market. Only repeat sourced context the tool returned (dataset id/date, counts,
source capabilities). Everything the tool marks unavailable must stay unavailable in your report."""

SCOUT_SYSTEM_PROMPT = """You are the site scout. Call search_city once and wait for it to finish, then call
finalize_scout with candidate_ids left empty: the tool records every candidate the search
returned, so never copy IDs by hand. Counts and reasons must come from the tool output only.
A cancelled or capped scan is reported, never hidden. Always finish by calling finalize_scout."""

INSPECTOR_SYSTEM_PROMPT = """You are the space inspector. First call list_candidates to read the
candidate IDs from this run's persisted search results, then call inspect_candidates with those
exact IDs, then call finalize_inspection with inspected_candidate_ids left empty (it records
every inspected candidate). Report suite-scoped facts, gaps and verification tasks
exactly as the tool returned them. Unknown IDs are reported as not found, never filled in from
memory, and IDs you invent are rejected by validation."""

FINANCE_SYSTEM_PROMPT = """You are the finance specialist. Call evaluate_finance once; it invokes the
deterministic TypeScript finance tools with the run's profile snapshot and writes the validated
finance artifact. Then call finalize_finance with your text explanation. You must not compute
numbers yourself and must not invent fixed costs or margins: unavailable inputs stay unavailable
and are listed under missingInputs."""


class StageTracker:
    """Records specialist outcomes; all persisted facts come from tool outputs."""

    def __init__(self, emit: Callable[[dict[str, Any]], None]):
        self.emit = emit
        self.statuses: dict[str, str] = {}
        self.digests: dict[str, str] = {}
        self.candidate_ids: dict[str, list[str]] = {}
        self.missing: dict[str, list[str]] = {}
        self.started: set[str] = set()

    def stage_started(self, stage: str) -> None:
        if stage not in self.started:
            self.started.add(stage)
            self.emit({"type": "stage.started", "stage": stage, "payload": None})

    def stage_completed(
        self,
        stage: str,
        status: str,
        digest: str,
        candidate_ids: list[str] | None = None,
        missing: list[str] | None = None,
    ) -> None:
        self.statuses[stage] = status
        self.digests[stage] = digest
        self.candidate_ids[stage] = list(candidate_ids or [])
        self.missing[stage] = list(missing or [])
        event_type = {
            "completed": "stage.completed",
            "unavailable": "unavailable",
        }.get(status, "stage.incomplete")
        self.emit({
            "type": event_type,
            "stage": stage,
            "payload": {"status": status, "digest": digest},
        })

    def stage_failed(self, stage: str, message: str) -> None:
        self.statuses[stage] = "failed"
        self.digests[stage] = message
        self.emit({"type": "stage.incomplete", "stage": stage, "payload": {"status": "failed", "digest": message}})


class Emitter:
    """Event + tool-call bookkeeping; the orchestrator is the single owner."""

    def __init__(self, run_id: str, event_log, record_writer: Callable[[dict[str, Any]], None]):
        from .models import AgentEvent  # local import to avoid cycle

        self.run_id = run_id
        self.event_log = event_log
        self.record_writer = record_writer
        self.tool_calls: dict[str, int] = {}
        self.AgentEvent = AgentEvent

    def __call__(self, spec: dict[str, Any]) -> None:
        event = self.AgentEvent(
            eventVersion="expansion-agent-event-v1",
            seq=0,
            runId=self.run_id,
            type=spec["type"],
            stage=spec.get("stage"),
            payload=spec.get("payload"),
        )
        event = self.event_log.append(event)
        self.record_writer({
            "type": spec["type"],
            "stage": spec.get("stage"),
            "payload": spec.get("payload"),
        })

    def tool(self, tool: str, stage: str | None, outcome: str) -> None:
        self.tool_calls[tool] = self.tool_calls.get(tool, 0) + 1
        self({"type": "tool.completed", "stage": stage, "payload": {"tool": tool, "outcome": outcome}})


class AgentContext:
    """Everything a specialist tool needs, bound to exactly one run."""

    def __init__(
        self,
        request: AgentRunRequest,
        directory: RunDirectory,
        bridge: ToolBridge,
        tracker: StageTracker,
        emitter: Emitter,
        summaries: dict[str, Any],
    ):
        self.request = request
        self.directory = directory
        self.bridge = bridge
        self.tracker = tracker
        self.emitter = emitter
        self.summaries = summaries

    def profile(self) -> ProfileArtifact:
        return self.directory.read_artifact("profile.json", ProfileArtifact)

    def candidates(self) -> SearchArtifact:
        return self.directory.read_artifact("candidates.json", SearchArtifact)

    def inspection(self) -> InspectionArtifact:
        return self.directory.read_artifact("inspection.json", InspectionArtifact)

    def tool_guard(self) -> None:
        self.directory.heartbeat()
        self.bridge.cancelled_check()


# ---------------------------------------------------------------------------
# Bridge-backed specialist tools (langchain tool names are [a-zA-Z0-9_-]+)

def _build_bridge_tool(
    context: AgentContext,
    stage: str,
    bridge_tool: str,
    langchain_name: str,
    description: str,
    fixed_payload: dict[str, Any] | None,
    timeout_s: float | None = None,
    args_to_payload: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    args_schema: Any = None,
) -> StructuredTool:
    tracker = context.tracker

    async def invoke_bridge(**kwargs: Any) -> str:
        tracker.stage_started(stage)
        context.tool_guard()
        payload = dict(fixed_payload or {})
        if args_to_payload:
            payload.update(args_to_payload(kwargs))
        try:
            output = await asyncio.to_thread(
                context.bridge.invoke, bridge_tool, payload, timeout_s,
            )
        except RunCancelled:
            raise
        except BridgeError as error:
            tracker.stage_failed(stage, f"{bridge_tool} failed: {error.code}")
            raise
        context.emitter.tool(bridge_tool, stage, "ok")
        return json.dumps(output, ensure_ascii=False)

    return StructuredTool.from_function(
        coroutine=invoke_bridge,
        name=langchain_name,
        description=description,
        args_schema=args_schema,
    )


class InspectArgs(BaseModel):
    candidate_ids: list[str] = Field(
        default_factory=list,
        description="Candidate IDs from this run's search results (up to 20).",
    )


def _inspect_payload(kwargs: dict[str, Any]) -> dict[str, Any]:
    return {"candidateIds": list(kwargs.get("candidate_ids") or [])}


def _build_list_candidates_tool(context: AgentContext) -> StructuredTool:
    tracker = context.tracker

    def list_candidates() -> str:
        """Read this run's persisted search results and return the valid candidate IDs with top digests."""
        tracker.stage_started("space_inspector")
        context.tool_guard()
        try:
            artifact = context.candidates()
        except FileNotFoundError:
            raise BridgeError("conflict", "The site scout must produce candidates before inspection runs.")
        ordered = sorted(artifact.candidates, key=lambda item: item.rank)
        top = [
            {
                "id": item.candidate.id,
                "name": item.candidate.name,
                "group": item.group,
                "rank": item.rank,
            }
            for item in ordered[:20]
        ]
        return json.dumps({
            "candidateIds": [item["id"] for item in top],
            "topCandidates": top,
            "total": len(artifact.candidates),
        }, ensure_ascii=False)

    return StructuredTool.from_function(
        func=list_candidates,
        name="list_candidates",
        description="Read this run's persisted search results and return the valid candidate IDs with top digests.",
    )


# ---------------------------------------------------------------------------
# Finalize tools (validated structured results)

def _finalize_readiness_tool(context: AgentContext) -> StructuredTool:
    tracker = context.tracker

    @langchain_tool
    def finalize_readiness(
        missing_data: list[str],
        follow_ups: list[str],
        unavailable: bool,
        notes: str,
    ) -> str:
        """Record the validated readiness result. missing_data/follow_ups must be copied from the profile_readiness tool output."""
        context.tool_guard()
        if unavailable:
            tracker.stage_completed(
                "readiness", "unavailable",
                "; ".join(missing_data) or "Readiness unavailable.",
                missing=missing_data,
            )
            return "Readiness recorded as unavailable."
        tracker.stage_completed(
            "readiness", "completed",
            notes or "Profile readiness assessed.",
            missing=[*(missing_data or []), *(follow_ups or [])],
        )
        return "Readiness recorded."

    return finalize_readiness


def _finalize_market_tool(context: AgentContext) -> StructuredTool:
    tracker = context.tracker

    @langchain_tool
    def finalize_market(
        context_summary: str,
        sourced: bool,
        unavailable_reasons: list[str],
        capability_notes: list[str],
    ) -> str:
        """Record the validated market result; every claim must come from the market_context tool output."""
        context.tool_guard()
        if not sourced:
            tracker.stage_completed(
                "market", "unavailable",
                context_summary or "Market context unavailable.",
                missing=unavailable_reasons,
            )
            return "Market recorded as unavailable."
        tracker.stage_completed("market", "completed", context_summary, missing=unavailable_reasons)
        return "Market context recorded."

    return finalize_market


def _finalize_scout_tool(context: AgentContext) -> StructuredTool:
    tracker = context.tracker

    @langchain_tool
    def finalize_scout(counts_note: str, notes: str, candidate_ids: list[str] | None = None) -> str:
        """Record the site scout result. Leave candidate_ids empty to record every candidate
        search_city returned (recommended; do not copy IDs by hand). Any ID you do pass must be
        one search_city returned; anything else is rejected."""
        context.tool_guard()
        try:
            artifact = context.candidates()
        except FileNotFoundError:
            return "search_city has not produced candidates yet; call it first."
        known = {item.candidate.id for item in artifact.candidates}
        if not candidate_ids:
            # Grounded by construction: the persisted search artifact is the source.
            candidate_ids = [item.candidate.id for item in artifact.candidates]
        valid = [item for item in candidate_ids if item in known]
        invalid = [item for item in candidate_ids if item not in known]
        if invalid:
            return f"These candidate IDs do not exist in this run's search results and were rejected: {', '.join(invalid[:5])}."
        tracker.stage_completed(
            "site_scout", "completed",
            notes or "Full-city search completed with deterministic assessments.",
            candidate_ids=valid,
        )
        return f"Site scout recorded with {len(valid)} grounded candidate IDs."

    return finalize_scout


def _finalize_inspection_tool(context: AgentContext) -> StructuredTool:
    tracker = context.tracker

    @langchain_tool
    def finalize_inspection(
        findings: list[str],
        verification_tasks: list[str],
        gaps_summary: str,
        inspected_candidate_ids: list[str] | None = None,
    ) -> str:
        """Record the inspection result. Leave inspected_candidate_ids empty to record every
        candidate inspect_candidates returned (recommended). Any ID you pass must exist in this
        run's search results."""
        context.tool_guard()
        try:
            artifact = context.candidates()
        except FileNotFoundError:
            return "No candidates exist in this run yet; the site scout must run first."
        known = {item.candidate.id for item in artifact.candidates}
        if not inspected_candidate_ids:
            try:
                inspected_candidate_ids = [item.candidateId for item in context.inspection().candidates]
            except FileNotFoundError:
                return "inspect_candidates has not produced results yet; call it first."
        invalid = [item for item in inspected_candidate_ids if item not in known]
        if invalid:
            return f"These candidate IDs do not exist in this run's search results and were rejected: {', '.join(invalid[:5])}."
        valid = [item for item in inspected_candidate_ids if item in known]
        tracker.stage_completed(
            "space_inspector", "completed",
            gaps_summary or "Inspection recorded with suite-scoped gaps and verification tasks.",
            candidate_ids=valid,
            missing=verification_tasks,
        )
        return f"Inspection recorded for {len(valid)} candidates."

    return finalize_inspection


def _finalize_finance_tool(context: AgentContext) -> StructuredTool:
    tracker = context.tracker

    @langchain_tool
    def finalize_finance(summary: str, assumptions: list[str], missing_inputs: list[str]) -> str:
        """Record the finance result. Numbers never belong here: they live in the validated finance artifact."""
        context.tool_guard()
        tracker.stage_completed(
            "finance",
            "completed" if not missing_inputs else "unavailable",
            summary or "Finance evaluated with deterministic tools.",
            missing=missing_inputs,
        )
        return "Finance recorded."

    return finalize_finance


def _finalize_run_tool(context: AgentContext) -> StructuredTool:
    tracker = context.tracker

    @langchain_tool
    def finalize_run(
        summary_text: str,
        missing_evidence: list[str],
        follow_ups: list[str],
        assumptions: list[str],
    ) -> str:
        """Compose the validated run summary. Only text: candidate IDs and numbers are taken from tool outputs."""
        context.tool_guard()
        for stage in ["readiness", "market", "site_scout", "space_inspector", "finance"]:
            if stage not in tracker.statuses:
                tracker.stage_failed(stage, "The specialist did not produce a validated result.")
        context.summaries["summary_text"] = summary_text
        context.summaries["missing_evidence"] = missing_evidence
        context.summaries["follow_ups"] = follow_ups
        context.summaries["assumptions"] = assumptions
        tracker.digests["planner"] = summary_text
        return "Run summary recorded; the orchestrator validates and persists it."

    return finalize_run


# ---------------------------------------------------------------------------
# Finance specialist tool (calls the Phase 2 deterministic finance tools)

def _build_finance_tool(context: AgentContext) -> StructuredTool:
    tracker = context.tracker

    async def evaluate_finance() -> str:
        """Run the deterministic finance tools for this run's top candidates and profile snapshot."""
        tracker.stage_started("finance")
        context.tool_guard()
        profile = context.profile()
        try:
            candidates = context.candidates()
        except FileNotFoundError:
            raise BridgeError("conflict", "The site scout must produce candidates before finance runs.")
        top = sorted(candidates.candidates, key=lambda item: item.rank)[:FINANCE_MAX_CANDIDATES]

        occupancy: list[OccupancyResult] = []
        for assessed in top:
            context.tool_guard()
            output = await asyncio.to_thread(
                context.bridge.invoke,
                "finance.monthly_occupancy",
                {"candidateId": assessed.candidate.id, "extrasMonthly": None},
                None,
            )
            context.emitter.tool("finance.monthly_occupancy", "finance", "ok")
            if output.get("known") is True:
                occupancy.append(OccupancyResult(
                    candidateId=assessed.candidate.id,
                    known=True,
                    low=output.get("low"),
                    high=output.get("high"),
                    notes=list(output.get("notes") or []),
                    serviceInclusion=output.get("serviceInclusion"),
                ))
            else:
                occupancy.append(OccupancyResult(
                    candidateId=assessed.candidate.id,
                    known=False,
                    reasonCode=output.get("reasonCode"),
                    reason=output.get("reason"),
                    serviceInclusion=output.get("serviceInclusion"),
                ))

        finance_inputs = profile.financeInputs
        missing_inputs: list[str] = []
        if finance_inputs.origin == "derived":
            output = await asyncio.to_thread(
                context.bridge.invoke,
                "finance.required_sales",
                {
                    "fixedCostsMonthly": finance_inputs.fixedCostsMonthly,
                    "contributionMargin": finance_inputs.contributionMargin,
                },
                None,
            )
        else:
            output = await asyncio.to_thread(
                context.bridge.invoke,
                "finance.required_sales",
                {"fixedCostsMonthly": None, "contributionMargin": None},
                None,
            )
            missing_inputs.extend(finance_inputs.reasons)
        context.emitter.tool("finance.required_sales", "finance", "ok")
        required_sales = RequiredSalesResult(
            status=output.get("status"),
            requiredSalesMonthly=output.get("requiredSalesMonthly"),
            reason=output.get("reason"),
            fixedCostsMonthly=finance_inputs.fixedCostsMonthly if finance_inputs.origin == "derived" else None,
            contributionMargin=finance_inputs.contributionMargin if finance_inputs.origin == "derived" else None,
            inputOrigin=finance_inputs.origin,
        )

        artifact = FinanceArtifact(
            artifactVersion=ARTIFACT_VERSION,
            modelVersion=FINANCE_TOOL_VERSION,
            runId=context.request.runId,
            evaluatedAt=iso_now(),
            occupancy=occupancy,
            requiredSales=required_sales,
            missingInputs=missing_inputs,
            assumptions=[],
        )
        context.directory.write_artifact("finance.json", artifact)
        return json.dumps(artifact.model_dump(), ensure_ascii=False)

    return StructuredTool.from_function(
        coroutine=evaluate_finance,
        name="evaluate_finance",
        description="Run the deterministic TypeScript finance tools for this run's top candidates and profile snapshot; writes the validated finance artifact.",
    )


# ---------------------------------------------------------------------------
# Model construction

class ProviderUnavailable(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


PROVIDER_KEYS = {
    "anthropic": ("ANTHROPIC_API_KEY",),
    "openai": ("OPENAI_API_KEY",),
    # GOOGLE_API_KEY is the langchain_google_genai name; GEMINI_API_KEY is
    # the commonly used alias. Either satisfies the google provider.
    "google": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
}
DEFAULT_MODEL_IDS = {
    "anthropic": "claude-sonnet-4-5",
    "openai": "gpt-4o-mini",
    "google": "gemini-2.5-flash",
}


def resolve_provider(config: dict[str, Any]) -> tuple[str, str]:
    """Resolve (provider, effective model id) from config + environment."""
    import os

    provider = (config.get("provider") or "").lower() or None
    if provider is None:
        provider = next(
            (name for name, env_names in PROVIDER_KEYS.items() if any(os.environ.get(env_name) for env_name in env_names)),
            None,
        )
    if provider is None:
        raise ProviderUnavailable(
            "provider_not_configured",
            "No model provider key is configured (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY or GEMINI_API_KEY); the live Deep Agents run cannot start. Use the deterministic search path.",
        )
    env_names = PROVIDER_KEYS.get(provider)
    if not env_names:
        raise ProviderUnavailable("provider_not_configured", f"Unknown agent provider '{provider}'.")
    api_key = next((os.environ.get(env_name) for env_name in env_names if os.environ.get(env_name)), None)
    if not api_key:
        raise ProviderUnavailable(
            "provider_not_configured",
            f"No {' or '.join(env_names)} is configured; the live Deep Agents run cannot start. Use the deterministic search path.",
        )
    return provider, config.get("model_id") or DEFAULT_MODEL_IDS[provider]


def make_live_model(config: dict[str, Any]) -> BaseChatModel:
    import os

    provider, model_id = resolve_provider(config)
    env_names = PROVIDER_KEYS[provider]
    api_key = next((os.environ.get(env_name) for env_name in env_names if os.environ.get(env_name)), None)
    timeout = float(config.get("model_timeout_s") or 90.0)
    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(model=model_id, temperature=0, timeout=timeout, max_retries=2)
    if provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=model_id, temperature=0, timeout=timeout, max_retries=2)
    if provider == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=model_id,
            google_api_key=api_key,
            temperature=0,
            timeout=timeout,
            max_retries=2,
        )
    raise ProviderUnavailable("provider_not_configured", f"Unknown agent provider '{provider}'.")


class ScriptedFakeChatModel(GenericFakeChatModel):
    """GenericFakeChatModel plus bind_tools support.

    The scripted messages already carry the tool calls, so bind_tools only
    needs to accept the deepagents tool binding without reimplementing it.
    """

    def bind_tools(
        self,
        tools: Any,
        *,
        tool_choice: Any = None,
        **kwargs: Any,
    ) -> Any:
        from langchain_core.runnables import RunnableBinding

        return RunnableBinding(bound=self, config={}, kwargs=kwargs)


def make_scripted_model(role: str, script: dict[str, Any]) -> BaseChatModel:
    """Deterministic model double: the same real deepagents graph consumes
    scripted messages. Placeholders resolve lazily, so candidate IDs are read
    from the persisted search artifact only when the stage actually runs."""
    from langchain_core.messages import AIMessage

    def messages():
        for message in script.get("agents", {}).get(role, []):
            kwargs: dict[str, Any] = {"content": message.get("content", "")}
            tool_calls = message.get("tool_calls") or []
            converted: list[dict[str, Any]] = []
            for index, call in enumerate(tool_calls):
                args = call.get("args") or {}
                converted.append({
                    "name": call["name"],
                    "args": {key: _substitute_placeholders(value) for key, value in args.items()},
                    "id": call.get("id") or f"call_{index + 1}",
                    "type": "tool_call",
                })
            if converted:
                kwargs["tool_calls"] = converted
            yield AIMessage(**kwargs)

    return ScriptedFakeChatModel(messages=iter(messages()))


def _substitute_placeholders(value: Any) -> Any:
    if isinstance(value, list):
        return [_substitute_placeholders(item) for item in value]
    if isinstance(value, dict):
        return {key: _substitute_placeholders(item) for key, item in value.items()}
    if isinstance(value, str):
        import os
        if value.startswith("@TOP_CANDIDATE_IDS"):
            count = 3
            if value.startswith("@TOP_CANDIDATE_IDS:"):
                try:
                    count = int(value.split(":", 1)[1])
                except ValueError:
                    count = 3
            return top_candidate_ids(count)
        if value == "@RUN_CITY":
            return os.environ.get("EXPANSION_AGENT_CITY", "")
        return value
    return value


def top_candidate_ids(count: int) -> list[str]:
    """Top-ranked candidate IDs from the persisted search artifact (lazy)."""
    import os
    run_dir = os.environ.get("EXPANSION_AGENT_RUN_DIR", "")
    if run_dir:
        try:
            artifact = RunDirectory(run_dir, "").read_artifact("candidates.json", SearchArtifact)
            ordered = sorted(artifact.candidates, key=lambda item: item.rank)
            return [item.candidate.id for item in ordered[:count]]
        except Exception:
            return []
    return []


# ---------------------------------------------------------------------------
# Assembly

def build_planner(
    request: AgentRunRequest,
    directory: RunDirectory,
    bridge: ToolBridge,
    emitter: Emitter,
    script: dict[str, Any] | None,
    config: dict[str, Any],
) -> tuple[Any, StageTracker, dict[str, Any], tuple[str, str] | None]:
    tracker = StageTracker(emitter)
    summaries: dict[str, Any] = {}
    context = AgentContext(request, directory, bridge, tracker, emitter, summaries)

    live_info: tuple[str, str] | None = None
    if config.get("mode") == "scripted":
        if not script or script.get("version") != 1 or "agents" not in script:
            raise ProviderUnavailable("script_invalid", "The scripted model-double script is missing or invalid.")
        planner_model = make_scripted_model("planner", script)
    else:
        live_info = resolve_provider(config)
        planner_model = make_live_model(config)

    def model_for(role: str) -> BaseChatModel:
        if script is not None:
            return make_scripted_model(role, script)
        return make_live_model(config)

    specialists = [
        SubAgent(
            name="readiness",
            description="Profile completeness and follow-ups for the restaurant profile; reports missing data, never an invented readiness score.",
            model=model_for("readiness"),
            tools=[
                _build_bridge_tool(
                    context, "readiness", "profile.readiness_report", "profile_readiness",
                    "Read the validated profile completeness report for this run.",
                    {"revisionId": request.profile.revisionId, "revisionNumber": request.profile.revisionNumber},
                ),
                _finalize_readiness_tool(context),
            ],
            system_prompt=READINESS_SYSTEM_PROMPT,
        ),
        SubAgent(
            name="market",
            description="Sourced market and source-capability context for the run's city, or explicit unavailable reasons.",
            model=model_for("market"),
            tools=[
                _build_bridge_tool(
                    context, "market", "market.context", "market_context",
                    "Read sourced market/source-capability context for this run's city.",
                    {"cityId": request.cityId},
                ),
                _finalize_market_tool(context),
            ],
            system_prompt=MARKET_SYSTEM_PROMPT,
        ),
        SubAgent(
            name="site_scout",
            description="Full-city offered-space search with deterministic assessments; returns candidate IDs, counts and reasons.",
            model=model_for("site_scout"),
            tools=[
                _build_bridge_tool(
                    context, "site_scout", "scout.search_city", "search_city",
                    "Search the run's city for offered spaces and evaluate every candidate deterministically.",
                    {"cityId": request.cityId},
                    timeout_s=240.0,
                ),
                _finalize_scout_tool(context),
            ],
            system_prompt=SCOUT_SYSTEM_PROMPT,
        ),
        SubAgent(
            name="space_inspector",
            description="Suite-scoped facts, assessment gaps and verification tasks for chosen candidates from the site scout.",
            model=model_for("space_inspector"),
            tools=[
                _build_list_candidates_tool(context),
                _build_bridge_tool(
                    context, "space_inspector", "inspector.evidence", "inspect_candidates",
                    "Inspect suite-scoped evidence for up to 20 candidate IDs from this run's search results.",
                    None,
                    args_to_payload=_inspect_payload,
                    args_schema=InspectArgs,
                ),
                _finalize_inspection_tool(context),
            ],
            system_prompt=INSPECTOR_SYSTEM_PROMPT,
        ),
        SubAgent(
            name="finance",
            description="Deterministic required-sales and monthly-occupancy results for the run's candidates and profile snapshot; unavailable inputs stay unavailable.",
            model=model_for("finance"),
            tools=[_build_finance_tool(context), _finalize_finance_tool(context)],
            system_prompt=FINANCE_SYSTEM_PROMPT,
        ),
    ]

    agent = create_deep_agent(
        model=planner_model,
        tools=[_finalize_run_tool(context)],
        subagents=specialists,
        system_prompt=PLANNER_SYSTEM_PROMPT,
    )
    return agent, tracker, summaries, live_info
