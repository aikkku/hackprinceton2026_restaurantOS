"""Version constants shared with the TypeScript contracts.

These strings are contract values, not documentation: the TypeScript domain
files export the same constants and both sides reject any other version.
"""

AGENT_RUN_VERSION = "expansion-agent-run-v1"
ARTIFACT_VERSION = "expansion-agent-artifact-v1"
EVENT_VERSION = "expansion-agent-event-v1"
INTAKE_SCHEMA_VERSION = "1.0"
REQUIREMENTS_MODEL_VERSION = "expansion-requirements-v1"
MATCHING_MODEL_VERSION = "expansion-matching-v1"
SEARCH_MODEL_VERSION = "expansion-search-v1"
TOOL_CATALOG_VERSION = "expansion-tools-v1"
FINANCE_TOOL_VERSION = "expansion-finance-tool-v1"
READINESS_TOOL_VERSION = "expansion-readiness-tool-v1"
MARKET_TOOL_VERSION = "expansion-market-tool-v1"
INSPECTION_TOOL_VERSION = "expansion-inspection-tool-v1"

# Version of the scripted deterministic model-double format consumed by
# --mode scripted (tests, e2e). Bumped on breaking script format changes.
SCRIPTED_MODEL_SCRIPT_VERSION = 1
