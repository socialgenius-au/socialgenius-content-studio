"""
C1 — orchestrator INTEGRATION test against the REAL Stage 3-9 handlers and Stage 11.1/11.2 services.

Every other C1 test replaces the stage runners with fakes; this one proves the orchestrator really drives
the existing implementation: it builds a real 9-second clip with two hard cuts (black/white/black, 3s
each, with audio; high-contrast so Stage 4's existing 0.3 luma threshold detects both) using the bundled ffmpeg, ingests it, and runs `run_deconstruction` with the DEFAULT
runners. No AI provider is configured, so Stage 10 / 11.3 / 11.4 must be `skipped` and NO Anthropic call
is possible. Uses only local ffmpeg/EasyOCR/Whisper/detector code, exactly like the existing per-stage
suites.
"""
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.shot import Shot
from app.models.shot_frame import ShotFrame
from app.models.text_element import TextElement
from app.models.video_analysis import VideoAnalysis
from app.services.deconstruction_aggregate_svc import build_full_deconstruction
from app.services.deconstruction_orchestrator_svc import STAGES, run_deconstruction
from app.services.ffmpeg_svc import FFMPEG_BIN
from tests.conftest import _run
from tests.test_deconstruction_orchestrator_svc import _existing_test_user

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


@pytest.fixture
def three_segment_clip(tmp_path) -> str:
    out = tmp_path / "c1_three_segments.mp4"
    inputs, labels = [], ""
    for i, (color, freq) in enumerate([("black", 440), ("white", 550), ("black", 660)]):
        inputs += ["-f", "lavfi", "-i", f"color=c={color}:s=640x360:d=3:r=30", "-f", "lavfi", "-i", f"sine=frequency={freq}:duration=3"]
        labels += f"[{2 * i}:v][{2 * i + 1}:a]"
    _run([FFMPEG_BIN, "-y", *inputs, "-filter_complex", f"{labels}concat=n=3:v=1:a=1[v][a]", "-map", "[v]", "-map", "[a]",
          "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", str(out)])
    return str(out)


async def _cleanup(db, asset_id: int, rv_id: int) -> None:
    """Removes the reference video plus every Asset a real run created (frames, OCR crops)."""
    await db.rollback()
    analysis_ids = [a for (a,) in (await db.execute(select(VideoAnalysis.id).where(VideoAnalysis.reference_video_id == rv_id))).all()]
    extra_assets: set[int] = set()
    if analysis_ids:
        extra_assets |= {a for (a,) in (await db.execute(select(ShotFrame.asset_id).where(ShotFrame.video_analysis_id.in_(analysis_ids)))).all() if a}
        extra_assets |= {a for (a,) in (await db.execute(select(TextElement.source_frame_asset_id).where(TextElement.video_analysis_id.in_(analysis_ids)))).all() if a}
        extra_assets |= {a for (a,) in (await db.execute(select(Shot.keyframe_asset_id).where(Shot.video_analysis_id.in_(analysis_ids)))).all() if a}
    rv = await db.get(ReferenceVideo, rv_id)
    if rv:
        await db.delete(rv)
        await db.flush()
    for aid in extra_assets | {asset_id}:
        asset = await db.get(Asset, aid)
        if asset:
            if aid != asset_id:
                Path(asset.file_path).unlink(missing_ok=True)
            await db.delete(asset)
    await db.commit()


async def test_default_runners_drive_the_real_pipeline_end_to_end_with_ai_unconfigured(three_segment_clip, monkeypatch, capsys):
    for name in ("SEMANTIC_REASONER_PROVIDER", "STORY_BEAT_REASONER_PROVIDER", "HOOK_REASONER_PROVIDER", "RETENTION_REASONER_PROVIDER"):
        monkeypatch.setattr(settings, name, "")

    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        asset = Asset(user_id=user.id, original_filename="c1_integration.mp4", stored_filename="c1_integration_stored.mp4",
                      file_path=three_segment_clip, file_type="video", mime_type="video/mp4", file_size=Path(three_segment_clip).stat().st_size)
        db.add(asset)
        await db.flush()
        asset_id = asset.id
        rv = ReferenceVideo(user_id=user.id, asset_id=asset_id, source="upload")
        db.add(rv)
        await db.flush()
        rv_id = rv.id
        db.add(VideoAnalysis(reference_video_id=rv_id))
        await db.commit()
        try:
            report = await run_deconstruction(db, user, rv_id)  # DEFAULT runners = the real handlers/services
            by_key = {s["key"]: s for s in report["stages"]}
            with capsys.disabled():
                print("\n--- REAL PIPELINE RESULT ---")
                for s in report["stages"]:
                    print(f"  {s['key']:<34} {s['status']:<17} {s['error'] or s['reason'] or ''}"[:170])
                print("  overall:", report["overall_status"])
            assert [s["key"] for s in report["stages"]] == [s.key for s in STAGES]

            # The real handlers ran through the orchestrator and recorded their own state.
            assert by_key["technical_probe"]["status"] == "complete"
            assert by_key["scene_segmentation"]["status"] == "complete"
            shots = list((await db.execute(select(Shot).where(Shot.video_analysis_id == (await db.execute(
                select(VideoAnalysis.id).where(VideoAnalysis.reference_video_id == rv_id))).scalar_one()))).scalars().all())
            assert len(shots) == 3  # the two real hard cuts were detected by the real Stage 4 handler
            assert by_key["visual_evidence"]["status"] == "complete"

            # Free deterministic derived stages ran; every paid/AI stage was skipped, not failed.
            assert by_key["editing_rhythm"]["status"] == "complete"
            assert by_key["hook_window"]["status"] == "complete"
            for key in ("scene_story_beats", "hook_classification", "retention_devices"):
                assert by_key[key]["status"] == "skipped" and "not configured" in by_key[key]["reason"]

            # No stage died from the way the orchestrator calls the handlers.
            for s in report["stages"]:
                assert "MissingGreenlet" not in (s["error"] or ""), s
                assert "TypeError" not in (s["error"] or ""), s

            # The aggregate read model reads the very same run.
            full = await build_full_deconstruction(db, user, rv_id)
            assert len(full["evidence"].shots) == 3
            assert full["hook"]["window"] is not None and full["editing_rhythm"]["profile"] is not None
            assert full["retention"]["accepted_devices"] == [] and full["orchestration"]["status"] in ("complete", "partial")

            # Rerunning changes nothing and calls nothing that is already done.
            before_shots = [s.id for s in shots]
            again = await run_deconstruction(db, user, rv_id)
            assert {s["status"] for s in again["stages"] if s["kind"] == "service" and s["key"] in ("scene_story_beats", "editing_rhythm", "hook_window")} <= {"already_complete", "skipped"}
            shots_after = [s.id for s in (await db.execute(select(Shot).where(Shot.video_analysis_id == full["video_analysis"]["id"]))).scalars().all()]
            assert sorted(shots_after) == sorted(before_shots)  # no duplicate / re-created Shot rows
        finally:
            await _cleanup(db, asset_id, rv_id)
