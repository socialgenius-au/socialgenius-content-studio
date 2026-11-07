"""The stored run record as readers see it: a run still 'running' past the crash limit is flagged stale by the SERVER (pure function, no database)."""
from datetime import datetime, timedelta, timezone

from app.services.deconstruction_orchestrator_svc import ORCHESTRATION_STALE_SECONDS, _orchestration_view


def _iso(seconds_ago: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(seconds=seconds_ago)).isoformat()


def test_a_fresh_running_claim_is_not_stale():
    state = {"status": "running", "started_at": _iso(30), "finished_at": None, "force_ai": False}
    assert _orchestration_view(state) == state


def test_a_running_claim_past_the_crash_limit_is_flagged_stale_without_touching_the_record():
    state = {"status": "running", "started_at": _iso(ORCHESTRATION_STALE_SECONDS + 5), "finished_at": None, "force_ai": False}
    view = _orchestration_view(state)
    assert view["stale"] is True and view["status"] == "running"
    assert "stale" not in state                     # nothing stored or mutated: a read-only view


def test_finished_and_missing_records_are_returned_as_they_are():
    done = {"status": "complete", "started_at": _iso(99999), "finished_at": _iso(99000), "force_ai": False}
    assert _orchestration_view(done) == done
    assert _orchestration_view(None) is None
    assert _orchestration_view({}) == {}


def test_a_running_claim_with_no_usable_start_time_counts_as_stale_like_the_claim_rule_itself():
    assert _orchestration_view({"status": "running", "started_at": None})["stale"] is True
