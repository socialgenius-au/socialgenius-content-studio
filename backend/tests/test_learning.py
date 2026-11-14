"""Learn stage store: recommendations and their status, per user and per saved draft. Real local Postgres (same convention as the other service tests)."""
import secrets

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.learning_record import LearningRecord
from app.models.user import User
from app.models.video_studio_draft import VideoStudioDraft
from app.routers.learning import RecommendationIn, accepted_lessons, list_for_draft, set_recommendation_status

_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_Session = async_sessionmaker(_engine, expire_on_commit=False)

pytestmark = pytest.mark.skipif(not any(h in settings.DATABASE_URL for h in ("@127.0.0.1", "@localhost", "@[::1]")), reason="writes rows: local database only")


def body(**kw):
    base = dict(status="accepted", note=None, text="Hold the second line longer on screen.", basis="evidence", evidence=["Scene 2: 9 words in 3.0 s (3.0 words/second)"], caveat="A reading-speed guideline, not measured audience behaviour.", rule_version="learn-v1")
    base.update(kw)
    return RecommendationIn(**base)


async def make_user(db, tag):
    u = User(username=f"learn_{tag}_{secrets.token_hex(3)}", email=f"learn_{tag}_{secrets.token_hex(3)}@example.test", hashed_password="x", role="editor", is_active=True)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


async def make_draft(db, user, name="Blueprint — SocialGenius", plan=True):
    pj = {"videoClips": [], "blueprintPlan": {"blueprintId": "bp-abc", "referenceVideoId": 5131}} if plan else {"videoClips": []}
    d = VideoStudioDraft(user_id=user.id, name=name, project_json=pj)
    db.add(d)
    await db.commit()
    await db.refresh(d)
    return d


@pytest.fixture
async def world():
    async with _engine.begin() as conn:
        await conn.run_sync(LearningRecord.__table__.create, checkfirst=True)
    async with _Session() as db:
        a, b = await make_user(db, "a"), await make_user(db, "b")
        da, db2 = await make_draft(db, a, "Draft A"), await make_draft(db, a, "Draft A2", plan=False)
        dbb = await make_draft(db, b, "Draft B")
    yield a, b, da, db2, dbb
    async with _Session() as db:
        await db.execute(delete(LearningRecord).where(LearningRecord.user_id.in_([a.id, b.id])))
        await db.execute(delete(VideoStudioDraft).where(VideoStudioDraft.user_id.in_([a.id, b.id])))
        await db.execute(delete(User).where(User.id.in_([a.id, b.id])))
        await db.commit()


async def test_first_action_creates_the_record_with_a_server_side_identity_snapshot(world):
    a, _, da, _, _ = world
    async with _Session() as db:
        r = await set_recommendation_status(da.id, "text-speed-s2", body(), db, a)
    assert (r.status, r.basis, r.draft_id, r.draft_name, r.blueprint_id, r.reference_video_id) == ("accepted", "evidence", da.id, "Draft A", "bp-abc", 5131)
    assert r.evidence == ["Scene 2: 9 words in 3.0 s (3.0 words/second)"] and r.rule_version == "learn-v1"


async def test_a_draft_that_did_not_come_from_a_blueprint_records_no_blueprint(world):
    a, _, _, d2, _ = world
    async with _Session() as db:
        r = await set_recommendation_status(d2.id, "k", body(), db, a)
    assert (r.blueprint_id, r.reference_video_id) == (None, None)


async def test_later_updates_change_only_status_and_note_never_the_original_recommendation(world):
    a, _, da, _, _ = world
    async with _Session() as db:
        first = await set_recommendation_status(da.id, "text-speed-s2", body(), db, a)
        later = await set_recommendation_status(da.id, "text-speed-s2", body(status="tested", note="Tried 4 s: reads better.", text="A DIFFERENT SENTENCE", basis="hypothesis", evidence=["changed"], caveat="x", rule_version="learn-v9"), db, a)
        rows = (await db.execute(select(LearningRecord).where(LearningRecord.user_id == a.id))).scalars().all()
    assert len(rows) == 1 and later.id == first.id
    assert (later.status, later.note) == ("tested", "Tried 4 s: reads better.")
    assert (later.text, later.basis, later.evidence, later.caveat, later.rule_version) == (first.text, first.basis, first.evidence, first.caveat, first.rule_version)


async def test_records_are_private_to_their_owner(world):
    a, b, da, _, dbb = world
    async with _Session() as db:
        await set_recommendation_status(da.id, "k1", body(), db, a)
        for call in (lambda: list_for_draft(da.id, db, b), lambda: set_recommendation_status(da.id, "k1", body(status="dismissed"), db, b)):
            with pytest.raises(HTTPException) as e:
                await call()
            assert e.value.status_code == 404
        await set_recommendation_status(dbb.id, "k1", body(), db, b)
        assert [r.draft_id for r in await accepted_lessons(None, 20, db, a)] == [da.id]          # B's accepted lesson is never shown to A
        assert [r.draft_id for r in await accepted_lessons(None, 20, db, b)] == [dbb.id]
        unchanged = (await db.execute(select(LearningRecord).where(LearningRecord.draft_id == da.id))).scalar_one()
        assert unchanged.status == "accepted"


async def test_accepted_lessons_lists_only_accepted_and_can_exclude_the_current_draft(world):
    a, _, da, d2, _ = world
    async with _Session() as db:
        await set_recommendation_status(da.id, "ok", body(), db, a)
        await set_recommendation_status(da.id, "no", body(status="dismissed"), db, a)
        await set_recommendation_status(d2.id, "ok2", body(text="Test a clearer opening line."), db, a)
        await set_recommendation_status(d2.id, "open1", body(status="open"), db, a)
        everything = {r.rec_key for r in await accepted_lessons(None, 20, db, a)}
        others = {r.rec_key for r in await accepted_lessons(da.id, 20, db, a)}
    assert everything == {"ok", "ok2"} and others == {"ok2"}


async def test_invalid_input_is_refused(world):
    a, _, da, _, _ = world
    async with _Session() as db:
        with pytest.raises(HTTPException) as e:
            await set_recommendation_status(da.id, "Bad Key!", body(), db, a)
        assert e.value.status_code == 422
    for bad in (dict(status="verified"), dict(basis="measured"), dict(text="ab"), dict(note="x" * 1001), dict(evidence=["e"] * 13)):
        with pytest.raises(ValidationError):
            body(**bad)


async def test_deleting_a_draft_keeps_the_lesson_with_its_provenance(world):
    a, _, da, _, _ = world
    async with _Session() as db:
        await set_recommendation_status(da.id, "keep", body(), db, a)
        await db.execute(text("DELETE FROM video_studio_drafts WHERE id = :i"), {"i": da.id})
        await db.commit()
        kept = (await accepted_lessons(None, 20, db, a))
    assert len(kept) == 1 and kept[0].draft_id is None and kept[0].draft_name == "Draft A" and kept[0].blueprint_id == "bp-abc"


def test_the_record_has_no_audience_performance_fields():
    cols = {c.name for c in LearningRecord.__table__.columns}
    assert not any(w in " ".join(cols) for w in ("reach", "views", "engagement", "watch", "retention", "ctr", "conversion"))
