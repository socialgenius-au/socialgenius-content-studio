"""(ships with the C1 patch) The opt-in edge policy on the export request."""
import pytest
from pydantic import ValidationError

from app.schemas.video_export import ExportProjectRequest


def _req(**kw):
    return ExportProjectRequest(canvas_width=360, canvas_height=640, video_clips=[], **kw)


def test_the_request_edge_policy_defaults_to_shorten_and_allows_only_the_two_known_values():
    assert _req().transition_edge_policy == "shorten" and _req(transition_edge_policy="hold_incoming").transition_edge_policy == "hold_incoming"
    with pytest.raises(ValidationError):
        _req(transition_edge_policy="hold")
