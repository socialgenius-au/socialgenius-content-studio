from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.routers import reference_videos as routes


async def test_reconstruction_handoff_snapshots_saved_research(monkeypatch):
    report = {
        "dimension": "Local",
        "topic": "Sydney garden supplies",
        "findings": [{"text": "Local guide", "citations": [
            {"url": "https://example.com/guide", "title": "Guide"}
        ]}],
    }
    ownership = AsyncMock()
    monkeypatch.setattr(routes, "_require_owned_reference", ownership)
    db = MagicMock()
    db.scalar = AsyncMock(return_value=None)
    db.flush = AsyncMock(side_effect=lambda: setattr(db.add.call_args.args[0], "id", 31))
    db.commit = AsyncMock()
    db.scalars = AsyncMock(return_value=SimpleNamespace(all=lambda: [
        SimpleNamespace(payload=report),
        SimpleNamespace(payload={**report, "topic": "Older topic"}),
    ]))
    scene = routes.HandoffScene(number=1, start=0, end=2, role="Hook", story="", technical="", audio="")
    user = SimpleNamespace(id=7)

    assert await routes.create_reconstruction_handoff(
        55, routes.ReconstructionHandoff(scenes=[scene]), db=db, user=user,
    ) == {"id": 31}

    ownership.assert_awaited_once_with(db, 55, 7)
    handoff = db.add.call_args.args[0]
    assert handoff.reference_video_id == 55
    assert handoff.payload["research_reports"] == {"Local": report}
    db.commit.assert_awaited_once()
