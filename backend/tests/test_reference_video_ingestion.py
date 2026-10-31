"""
Video Deconstructor — Stage 2 (Reference Video Ingestion) tests.

Same real-database testing approach test_video_analysis_schema.py established for this
project's first DB-backed test file (see that file's own docstring for the NullPool-engine /
never-blanket-rollback / plain-int-not-ORM-object infrastructure notes — all reused verbatim
here, unmodified). This project has no HTTP test client anywhere (every existing router's logic
is tested by calling its own async function directly, not over HTTP — see test_generate_prompt.py
for the same pattern applied to /generate/prompt) — reference_videos.ingest_reference_video and
.get_reference_video are called directly here the same way, with a real DB session and a real,
already-seeded User row standing in for FastAPI's own auth dependency.

Covers the 16 requested checks: 1 (valid ingestion), 2 (existing upload pipeline reused — the
router only ever takes an already-uploaded asset_id, never a file), 3 (ReferenceVideo created),
4 (asset relationship), 5 (initial VideoAnalysis created), 6 (status is pending), 7 (no fake
analysis data), 8 (asset/original reference unchanged), 9 (invalid ingestion requests fail
cleanly), 10 (no orphaned rows survive a failed transaction), 11 (existing uploads keep working
— verified separately via git diff showing app/routers/upload.py is byte-identical to HEAD; not
re-tested here since it was never tested before Stage 2 either and Stage 2 doesn't touch it),
12 (existing Video Studio functionality intact — whole-suite run), 13-14 (whole-suite / Stage-1
schema re-runs, not individual functions here), 15-16 (frontend typecheck/build, not backend
tests at all).
"""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
import pytest

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.asset import Asset
from app.models.reference_video import ReferenceVideo
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.strategic_insight import StrategicInsight
from app.models.text_element import TextElement
from app.models.user import User
from app.models.video_analysis import VideoAnalysis
from app.models.visual_object import VisualObject
from app.routers.reference_videos import get_reference_video, ingest_reference_video, list_reference_videos
from app.schemas.reference_video import ReferenceVideoIngestRequest

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _existing_test_users(db, n: int = 1) -> list[User]:
    """Reuses real, already-seeded users (ayub/priya/iqra) rather than creating throwaway ones —
    keeps the `users` table itself completely untouched by this test file, same principle as
    test_video_analysis_schema.py's own _existing_test_user_id."""
    result = await db.execute(select(User).limit(n))
    users = result.scalars().all()
    assert len(users) >= n, f"expected at least {n} seeded users, found {len(users)}"
    return list(users)


async def _make_asset(db, user_id: int, file_type: str = "video", filename: str = "stage2_ingest_test.mp4") -> int:
    asset = Asset(
        user_id=user_id,
        original_filename=filename,
        stored_filename=f"stored_{filename}",
        file_path=f"uploads/{filename}",
        file_type=file_type,
        mime_type="video/mp4" if file_type == "video" else f"{file_type}/x-test",
        file_size=4096,
    )
    db.add(asset)
    await db.flush()
    return asset.id


async def _cleanup(db, asset_id: int, reference_video_id: int | None):
    if reference_video_id is not None:
        rv = await db.get(ReferenceVideo, reference_video_id)
        if rv:
            await db.delete(rv)
            await db.flush()
    asset = await db.get(Asset, asset_id)
    if asset:
        await db.delete(asset)
    await db.commit()


# ---------------------------------------------------------------------------
# 1/3/4/5/6. Valid ingestion creates the right rows in the right state.
# ---------------------------------------------------------------------------

async def test_ingest_creates_reference_video_and_pending_analysis():
    async with _TestSessionLocal() as db:
        [user] = await _existing_test_users(db)
        asset_id = await _make_asset(db, user.id)
        rv_id = None
        try:
            response = await ingest_reference_video(
                body=ReferenceVideoIngestRequest(asset_id=asset_id), db=db, user=user,
            )
            rv_id = response.id

            assert response.asset_id == asset_id
            assert response.source == "upload"
            assert response.original_filename == "stage2_ingest_test.mp4"
            # Reference Preview (post-Stage-4 UI gap fix): exposes the underlying Asset's own
            # file_path so the frontend can build an independent preview URL — must match the
            # real Asset row exactly, never be fabricated or left as a placeholder.
            assert response.asset_file_path == "uploads/stage2_ingest_test.mp4"
            assert response.latest_analysis.status == "pending"  # 6: pending / ready-for-analysis
            assert response.latest_analysis.analysis_tier in ("quick", "standard", "deep")

            # 3/4: re-fetch straight from the DB — confirm the row and its FK really exist,
            # not just what the response object claims.
            result = await db.execute(select(ReferenceVideo).where(ReferenceVideo.id == rv_id))
            rv = result.scalar_one()
            assert rv.asset_id == asset_id
            assert rv.user_id == user.id

            # 5: exactly one VideoAnalysis, pending.
            result = await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id))
            analyses = result.scalars().all()
            assert len(analyses) == 1
            assert analyses[0].status == "pending"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 2. Existing upload/storage pipeline is reused, not duplicated.
# ---------------------------------------------------------------------------

async def test_ingest_never_touches_the_filesystem_or_asset_row():
    """The Asset here has a file_path that was never actually written to disk — if ingestion
    worked by re-validating or re-reading the file itself (duplicating /upload/'s job) rather
    than trusting the already-created Asset row, this would fail. It doesn't, because ingestion
    only ever consumes an asset_id."""
    async with _TestSessionLocal() as db:
        [user] = await _existing_test_users(db)
        asset_id = await _make_asset(db, user.id, filename="never_written_to_disk.mp4")
        rv_id = None
        try:
            response = await ingest_reference_video(
                body=ReferenceVideoIngestRequest(asset_id=asset_id), db=db, user=user,
            )
            rv_id = response.id
            assert response.original_filename == "never_written_to_disk.mp4"
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 7. No fake analysis data is ever generated.
# ---------------------------------------------------------------------------

async def test_no_fake_analysis_data_is_generated():
    async with _TestSessionLocal() as db:
        [user] = await _existing_test_users(db)
        asset_id = await _make_asset(db, user.id)
        rv_id = None
        try:
            response = await ingest_reference_video(
                body=ReferenceVideoIngestRequest(asset_id=asset_id), db=db, user=user,
            )
            rv_id = response.id
            analysis_id = response.latest_analysis.id

            # Every analysis entity that hangs directly off a VideoAnalysis must be empty.
            for model in (Scene, TextElement, VisualObject, AnalysisAnnotation, StrategicInsight):
                result = await db.execute(select(model).where(model.video_analysis_id == analysis_id))
                assert result.scalars().all() == [], f"{model.__tablename__} must be empty at Stage 2"

            # Shot has no video_analysis_id of its own (it hangs off Scene) — since Scene is
            # already proven empty above, and Shot.scene_id is a NOT NULL FK, no Shot can exist
            # under this analysis either; asserted directly anyway rather than left implicit.
            result = await db.execute(
                select(Shot).join(Scene, Shot.scene_id == Scene.id).where(Scene.video_analysis_id == analysis_id)
            )
            assert result.scalars().all() == []

            result = await db.execute(select(VideoAnalysis).where(VideoAnalysis.id == analysis_id))
            analysis = result.scalar_one()
            assert analysis.pass_status == {}
            assert analysis.ai_provider_versions_used == {}
            assert analysis.started_at is None
            assert analysis.completed_at is None
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 8. The original reference (its underlying Asset) remains unchanged by ingestion.
# ---------------------------------------------------------------------------

async def test_asset_is_unchanged_by_ingestion():
    async with _TestSessionLocal() as db:
        [user] = await _existing_test_users(db)
        asset_id = await _make_asset(db, user.id)
        before = await db.get(Asset, asset_id)
        before_snapshot = (before.original_filename, before.file_path, before.file_size, before.mime_type, before.created_at)
        rv_id = None
        try:
            response = await ingest_reference_video(
                body=ReferenceVideoIngestRequest(asset_id=asset_id), db=db, user=user,
            )
            rv_id = response.id

            after = await db.get(Asset, asset_id)
            after_snapshot = (after.original_filename, after.file_path, after.file_size, after.mime_type, after.created_at)
            assert before_snapshot == after_snapshot
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# Duplicates: re-ingesting the same asset is idempotent, not a second row.
# ---------------------------------------------------------------------------

async def test_ingesting_the_same_asset_twice_is_idempotent():
    async with _TestSessionLocal() as db:
        [user] = await _existing_test_users(db)
        asset_id = await _make_asset(db, user.id)
        rv_id = None
        try:
            first = await ingest_reference_video(
                body=ReferenceVideoIngestRequest(asset_id=asset_id), db=db, user=user,
            )
            rv_id = first.id

            second = await ingest_reference_video(
                body=ReferenceVideoIngestRequest(asset_id=asset_id), db=db, user=user,
            )
            assert second.id == first.id  # same ReferenceVideo, not a duplicate

            result = await db.execute(select(ReferenceVideo).where(ReferenceVideo.asset_id == asset_id))
            assert len(result.scalars().all()) == 1

            result = await db.execute(select(VideoAnalysis).where(VideoAnalysis.reference_video_id == rv_id))
            assert len(result.scalars().all()) == 1  # still exactly one, not a second pending run
        finally:
            await _cleanup(db, asset_id, rv_id)


# ---------------------------------------------------------------------------
# 9. Invalid ingestion requests fail cleanly (no fabricated success).
# ---------------------------------------------------------------------------

async def test_ingest_rejects_nonexistent_asset():
    async with _TestSessionLocal() as db:
        [user] = await _existing_test_users(db)
        with pytest.raises(HTTPException) as exc:
            await ingest_reference_video(
                body=ReferenceVideoIngestRequest(asset_id=999_999_999), db=db, user=user,
            )
        assert exc.value.status_code == 404


async def test_ingest_rejects_asset_owned_by_a_different_user():
    async with _TestSessionLocal() as db:
        owner, other = await _existing_test_users(db, n=2)
        asset_id = await _make_asset(db, owner.id, filename="owned_by_someone_else.mp4")
        try:
            with pytest.raises(HTTPException) as exc:
                await ingest_reference_video(
                    body=ReferenceVideoIngestRequest(asset_id=asset_id), db=db, user=other,
                )
            assert exc.value.status_code == 404  # not 403 — never confirms the asset exists at all
        finally:
            await _cleanup(db, asset_id, None)


async def test_ingest_rejects_a_non_video_asset():
    async with _TestSessionLocal() as db:
        [user] = await _existing_test_users(db)
        asset_id = await _make_asset(db, user.id, file_type="image", filename="not_a_video.jpg")
        try:
            with pytest.raises(HTTPException) as exc:
                await ingest_reference_video(
                    body=ReferenceVideoIngestRequest(asset_id=asset_id), db=db, user=user,
                )
            assert exc.value.status_code == 422
        finally:
            await _cleanup(db, asset_id, None)


async def test_get_rejects_nonexistent_reference_video():
    async with _TestSessionLocal() as db:
        [user] = await _existing_test_users(db)
        with pytest.raises(HTTPException) as exc:
            await get_reference_video(reference_video_id=999_999_999, db=db, user=user)
        assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# 10. A failed ingestion transaction leaves no orphaned ReferenceVideo/VideoAnalysis rows.
# ---------------------------------------------------------------------------
# Reproduces, at the raw transaction level, exactly what ingest_reference_video does internally
# (add ReferenceVideo, flush, add VideoAnalysis, commit) but forces the second insert to violate
# a real DB constraint — proving the single-transaction design the router relies on: a failure
# anywhere before the one commit() leaves nothing persisted, not a dangling ReferenceVideo.

async def test_failed_ingestion_transaction_leaves_no_orphaned_rows():
    async with _TestSessionLocal() as db:
        [user] = await _existing_test_users(db)
        asset_id = await _make_asset(db, user.id, filename="forced_failure.mp4")
        try:
            rv = ReferenceVideo(user_id=user.id, asset_id=asset_id, source="upload")
            db.add(rv)
            await db.flush()  # rv.id now assigned, INSERT sent — but not yet committed

            # An invalid status value violates ck_video_analyses_status_valid — the same class of
            # real, unrecoverable failure any bug or future field addition could trigger here.
            # Must still fit status's own VARCHAR(16) column, or asyncpg raises a DataError
            # before the CHECK constraint is even evaluated — "invalid_status" (14 chars) does.
            db.add(VideoAnalysis(reference_video_id=rv.id, status="invalid_status"))
            with pytest.raises(IntegrityError):
                await db.commit()
            await db.rollback()  # genuinely needed after a real constraint violation

            # Nothing survived — not the ReferenceVideo, and (since it cascades) nothing that
            # could reference it either.
            result = await db.execute(select(ReferenceVideo).where(ReferenceVideo.asset_id == asset_id))
            assert result.scalars().all() == []
        finally:
            await _cleanup(db, asset_id, None)  # the ReferenceVideo never survived to be cleaned up


# ---------------------------------------------------------------------------
# Restoration (post-Stage-3 defect fix): GET / lists the caller's own ReferenceVideos.
# ---------------------------------------------------------------------------

async def test_list_returns_the_users_own_reference_video():
    """The exact restoration path the Stage-3 defect fix relies on: a fresh page load has no
    local component state, and this is the ONLY way it can find an already-ingested reference
    again — never re-uploads, never creates anything (a plain GET)."""
    async with _TestSessionLocal() as db:
        [user] = await _existing_test_users(db)
        asset_id = await _make_asset(db, user.id, filename="list_restore_test.mp4")
        rv_id = None
        try:
            created = await ingest_reference_video(
                body=ReferenceVideoIngestRequest(asset_id=asset_id), db=db, user=user,
            )
            rv_id = created.id

            listed = await list_reference_videos(db=db, user=user)
            assert any(r.id == rv_id for r in listed)
            found = next(r for r in listed if r.id == rv_id)
            assert found.original_filename == "list_restore_test.mp4"
            assert found.latest_analysis.status == "pending"
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_list_never_leaks_another_users_reference_video():
    async with _TestSessionLocal() as db:
        owner, other = await _existing_test_users(db, n=2)
        asset_id = await _make_asset(db, owner.id, filename="private_to_owner.mp4")
        rv_id = None
        try:
            created = await ingest_reference_video(
                body=ReferenceVideoIngestRequest(asset_id=asset_id), db=db, user=owner,
            )
            rv_id = created.id

            listed_by_other = await list_reference_videos(db=db, user=other)
            assert all(r.id != rv_id for r in listed_by_other)
        finally:
            await _cleanup(db, asset_id, rv_id)


async def test_list_orders_newest_first():
    async with _TestSessionLocal() as db:
        [user] = await _existing_test_users(db)
        asset1_id = await _make_asset(db, user.id, filename="list_order_1.mp4")
        asset2_id = await _make_asset(db, user.id, filename="list_order_2.mp4")
        rv1_id = rv2_id = None
        try:
            first = await ingest_reference_video(body=ReferenceVideoIngestRequest(asset_id=asset1_id), db=db, user=user)
            rv1_id = first.id
            second = await ingest_reference_video(body=ReferenceVideoIngestRequest(asset_id=asset2_id), db=db, user=user)
            rv2_id = second.id

            listed = await list_reference_videos(db=db, user=user)
            ids_in_order = [r.id for r in listed if r.id in (rv1_id, rv2_id)]
            assert ids_in_order == [rv2_id, rv1_id]  # newest (second) first
        finally:
            await _cleanup(db, asset1_id, rv1_id)
            await _cleanup(db, asset2_id, rv2_id)
