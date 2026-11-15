"""Cross-artifact validation: IDs and values must ground in tool outputs.

Schema validation checks shape; these rules check provenance. A summary (or
finalize payload) that references candidate IDs outside the run's persisted
search artifact, or numbers outside tool outputs, is rejected — the model
cannot invent records by writing them into text either.
"""

from __future__ import annotations

from .models import SearchArtifact, SummaryArtifact


class GroundingError(ValueError):
    pass


def validate_summary_against_search(summary: SummaryArtifact, search: SearchArtifact) -> None:
    known = {item.candidate.id for item in search.candidates}
    unknown = [item for item in summary.groundedCandidateIds if item not in known]
    if unknown:
        raise GroundingError(
            f"Summary references candidate IDs missing from the run's search artifact: {', '.join(unknown[:5])}"
        )
    for report in summary.stageReports:
        bad = [item for item in report.candidateIds if item not in known]
        if bad:
            raise GroundingError(
                f"Stage {report.stage} references candidate IDs missing from the search artifact: {', '.join(bad[:5])}"
            )
    if summary.runId != search.runId:
        raise GroundingError("Summary and search artifacts belong to different runs.")
