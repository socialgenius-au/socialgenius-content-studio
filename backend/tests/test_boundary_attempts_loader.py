"""Regression: `load_boundary_attempts` must read the field the reasoners actually store.

The scene reasoner stores its decision under `is_semantic_boundary` (the story-beat reasoner under `is_story_beat_boundary`). The loader once read `is_scene_boundary`, which never exists, so every scene
decision came back as None and reference 5131 was reported as "7 undecided" when the stored values were four rejections and three undecided. Real database, no AI call.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.services.structure_integrity import analyze_structure, load_boundary_attempts

_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_Session = async_sessionmaker(_engine, expire_on_commit=False)


async def _analysis(db):
    user = (await db.execute(select(User).limit(1))).scalar_one()
    asset = Asset(user_id=user.id, original_filename="boundary_loader.mp4", stored_filename="boundary_loader_stored.mp4", file_path="uploads/boundary_loader.mp4",
                  file_type="video", mime_type="video/mp4", file_size=1024)
    db.add(asset)
    await db.flush()
    rv = ReferenceVideo(user_id=user.id, asset_id=asset.id, source="upload", duration=10.0)
    db.add(rv)
    await db.flush()
    va = VideoAnalysis(reference_video_id=rv.id, status="complete", pass_status={})
    db.add(va)
    await db.commit()
    return rv.id, asset.id, va.id


async def _attempt(db, va_id, category, t, flag, value, confidence):
    db.add(AnalysisAnnotation(video_analysis_id=va_id, category=category, start_time=t, end_time=t, details={flag: value, "confidence": confidence, "evidence_references": {"supporting_shot_ids": [1]}},
                              certainty="INFERRED"))
    await db.flush()


async def _cleanup(db, asset_id, rv_id):
    rv = await db.get(ReferenceVideo, rv_id)
    if rv:
        await db.delete(rv)
        await db.flush()
    asset = await db.get(Asset, asset_id)
    if asset:
        await db.delete(asset)
    await db.commit()


async def test_the_loader_reads_the_stored_semantic_boundary_decision_and_the_latest_attempt_per_candidate():
    async with _Session() as db:
        rv_id, asset_id, va_id = await _analysis(db)
        try:
            S, B = "semantic_boundary_attempt", "story_beat_boundary_attempt"
            await _attempt(db, va_id, S, 1.0, "is_semantic_boundary", False, "medium")
            await _attempt(db, va_id, S, 2.0, "is_semantic_boundary", True, "high")
            await _attempt(db, va_id, S, 3.0, "is_semantic_boundary", None, "low")
            await _attempt(db, va_id, B, 1.0, "is_story_beat_boundary", True, "low")            # an earlier attempt ...
            await _attempt(db, va_id, B, 1.0, "is_story_beat_boundary", False, "medium")        # ... replaced by the later one at the same time
            await _attempt(db, va_id, B, 4.0, "is_story_beat_boundary", True, "medium")
            await db.commit()

            got = await load_boundary_attempts(db, va_id)
            assert [(a["time"], a["decision"], a["confidence"]) for a in got["scene"]] == [(1.0, False, "medium"), (2.0, True, "high"), (3.0, None, "low")]
            assert [(a["time"], a["decision"]) for a in got["beat"]] == [(1.0, False), (4.0, True)]

            r = analyze_structure(10.0, [], [], got)["reasoning"]["scene"]
            assert (r["examined"], r["accepted"], r["rejected"], r["undecided"]) == (3, 1, 1, 1)         # not "3 undecided"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_no_stored_attempts_is_reported_as_nothing_examined_not_as_undecided():
    async with _Session() as db:
        rv_id, asset_id, va_id = await _analysis(db)
        try:
            got = await load_boundary_attempts(db, va_id)
            assert got == {"scene": [], "beat": []}
            assert analyze_structure(10.0, [], [], got)["uncertainty"] == []
        finally:
            await _cleanup(db, asset_id, rv_id)
