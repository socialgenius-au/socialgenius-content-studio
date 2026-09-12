"""Video Deconstructor — Stage 11.2: HOOK WINDOW DERIVATION V1.

Answers ONLY "what opening time range should later Hook Analysis examine?" — never what kind of
hook it is, whether it is strong/weak, or whether it retained viewers. No reasoning, no LLM/
Anthropic call, no StrategicInsight row. Deliberately separate from (and does not depend on) Stage
11.1's Editing Logic measurements — this is a distinct structural question ("where does the
opening functional window end?"), not a rhythm metric.

DELIBERATE SEPARATION FROM SEMANTIC HOOK CLASSIFICATION: this module selects a BOUNDARY only. It
never reads SpeechSegment/TextElement content, never judges hook TYPE, and produces no confidence
value beyond which structural source the boundary came from — certainty is MEASURED, never
INFERRED, because choosing "the first accepted Story Beat boundary" is a deterministic selection
rule over already-existing evidence, not a semantic judgment about that boundary's meaning.

INPUT PRIORITY (checked in this exact order, each gated by the SAME safety guard):
  A. The first accepted Story Beat boundary (the first Story Beat row's own end_time, when a real
     accepted boundary produced it — never the video's own edge).
  B. The first accepted Scene boundary (same shape, one level coarser).
  C. The first Shot's own end_time (a purely MEASURED fallback — no semantic boundary exists at
     all, but the video's own first technical cut is still a defensible, evidence-grounded guess
     at "something changes here").
  D. A fixed TIME fallback (`min(MAX_HOOK_WINDOW_SECONDS, video_duration)`) when NONE of the above
     produces a usable candidate — used only when there is truly nothing else to go on.

THE MAX_HOOK_WINDOW_SECONDS SAFETY GUARD (see the named constant below) exists for exactly one
reason: a video's own first structural boundary can legitimately sit anywhere (Stage 10 makes no
claim about where a Scene/Story Beat boundary "should" be) — VA159's own first Shot spans 30+
seconds. Treating an arbitrarily-late first boundary as "the Hook window" would silently make the
Hook cover most of the video, which defeats the entire point of deriving a window at all. This
guard is a METHODOLOGICAL SAFETY LIMIT, never a definition of what a Hook is — it is checked
identically against every candidate source (Story Beat, Scene, and Shot fallback alike), defined
in exactly this one place, never duplicated or re-derived elsewhere.

Every candidate considered (accepted or rejected, and why) is recorded in the persisted row's own
`details.candidates_considered` — so "why wasn't the Scene boundary used" is always answerable
from the row itself, never only from re-deriving it.
"""
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis_annotation import AnalysisAnnotation
from app.models.reference_video import ReferenceVideo
from app.models.scene import Scene
from app.models.shot import Shot
from app.models.video_analysis import VideoAnalysis
from app.services.story_beat_construction_svc import STORY_BEAT_CATEGORY

HOOK_WINDOW_CATEGORY = "hook_window"
HOOK_WINDOW_PASS_NAME = "hook_window_derivation_v1"

# The ONE place this guard is defined -- see this module's own docstring for why it exists and
# why it is a safety limit, not a Hook definition. 15 seconds is a deliberately generous upper
# bound (not a tight "the hook is exactly this long" claim): short-form-video hook discussion
# commonly treats the opening several seconds as functionally distinct from the rest of the video,
# but genuinely varies by format -- this guard only needs to be wide enough to admit a real early
# structural boundary while still rejecting a degenerate case like VA159's 30-second first Shot.
MAX_HOOK_WINDOW_SECONDS = 15.0


class HookWindowError(Exception):
    """Raised only when this module must refuse rather than guess: an unknown video_analysis_id,
    or a non-positive/unresolvable video duration. Never raised merely because no Story Beat/Scene
    boundary exists or every candidate is rejected by the safety guard -- those are normal,
    honestly-recorded outcomes (derived_from="time_fallback"), not errors."""


async def _resolve_duration(db: AsyncSession, video_analysis_id: int) -> float:
    """Independently defined here, same reasoning every other Stage 10/11 module already gives
    for owning its own copy rather than importing one: no coupling to Scene/Story-Beat/Editing-
    Rhythm construction internals."""
    video_analysis = await db.get(VideoAnalysis, video_analysis_id)
    if video_analysis is None:
        raise HookWindowError(f"VideoAnalysis {video_analysis_id} does not exist.")

    reference_video = await db.get(ReferenceVideo, video_analysis.reference_video_id)
    if reference_video is not None and reference_video.duration is not None:
        return reference_video.duration

    result = await db.execute(select(func.max(Shot.end_time)).where(Shot.video_analysis_id == video_analysis_id))
    max_shot_end = result.scalar_one_or_none()
    if max_shot_end is not None:
        return max_shot_end

    raise HookWindowError(
        f"No authoritative duration available for video_analysis_id={video_analysis_id}: "
        "ReferenceVideo.duration is unset and no Shot rows exist to fall back on."
    )


def _consider(source_type: str, candidate: float | None, source_id: int | None, duration: float) -> dict:
    """Evaluates ONE candidate against the shared safety guard and basic sanity bounds, returning
    a fully self-describing record -- accepted or not, and exactly why -- regardless of outcome.
    A candidate is valid at all only if it is a real, positive instant strictly inside (0, duration]
    (protects against a zero/negative or out-of-range value ever being used, however that could
    arise) -- then gated by MAX_HOOK_WINDOW_SECONDS."""
    if candidate is None:
        return {"source_type": source_type, "source_id": source_id, "candidate_end": None,
                "accepted": False, "reason_rejected": "no candidate available from this source"}
    if not (0.0 < candidate <= duration):
        return {"source_type": source_type, "source_id": source_id, "candidate_end": candidate,
                "accepted": False, "reason_rejected": f"candidate {candidate} is outside the valid (0, {duration}] range"}
    if candidate > MAX_HOOK_WINDOW_SECONDS:
        return {"source_type": source_type, "source_id": source_id, "candidate_end": candidate,
                "accepted": False,
                "reason_rejected": f"candidate {candidate}s exceeds MAX_HOOK_WINDOW_SECONDS ({MAX_HOOK_WINDOW_SECONDS}s) safety guard"}
    return {"source_type": source_type, "source_id": source_id, "candidate_end": candidate,
            "accepted": True, "reason_rejected": None}


async def derive_and_persist_hook_window(db: AsyncSession, video_analysis_id: int) -> dict:
    """Stage 11.2's single entry point. Reads already-persisted Story Beat / Scene / Shot rows for
    one exact VideoAnalysis, selects the Hook window per the priority order in this module's own
    docstring, and persists it (delete-then-replace, one commit) as a single `hook_window`
    AnalysisAnnotation row. Never mutates any source evidence row, never touches Stage 10
    construction or Stage 11.1's Editing Logic rows, never calls a reasoner or any external API.

    Raises HookWindowError only if the VideoAnalysis does not exist or no positive duration is
    resolvable -- every other case (no Story Beat/Scene boundary, every candidate rejected by the
    safety guard) degrades to the documented time_fallback, never an exception.
    """
    video_analysis = await db.get(VideoAnalysis, video_analysis_id)
    if video_analysis is None:
        raise HookWindowError(f"VideoAnalysis {video_analysis_id} does not exist.")

    duration = await _resolve_duration(db, video_analysis_id)
    if duration <= 0:
        raise HookWindowError(f"VideoAnalysis {video_analysis_id} has a non-positive duration ({duration}) -- cannot derive a Hook window.")

    story_beats = list((await db.execute(
        select(AnalysisAnnotation).where(
            AnalysisAnnotation.video_analysis_id == video_analysis_id,
            AnalysisAnnotation.category == STORY_BEAT_CATEGORY,
        ).order_by(AnalysisAnnotation.start_time)
    )).scalars().all())
    scenes = list((await db.execute(
        select(Scene).where(Scene.video_analysis_id == video_analysis_id).order_by(Scene.order)
    )).scalars().all())
    shots = list((await db.execute(
        select(Shot).where(Shot.video_analysis_id == video_analysis_id).order_by(Shot.order)
    )).scalars().all())

    # A real accepted boundary exists only when 2+ rows exist (see construct_and_persist_scenes /
    # construct_and_persist_story_beats: zero accepted boundaries always produces exactly ONE row
    # spanning the whole video, with no boundary_end of its own) -- and only when that first row's
    # own boundary_end is actually populated, never assumed from row count alone.
    story_beat_candidate = None
    story_beat_id = None
    if len(story_beats) >= 2 and (story_beats[0].details or {}).get("boundary_end"):
        story_beat_candidate = story_beats[0].end_time
        story_beat_id = story_beats[0].id

    scene_candidate = None
    scene_id = None
    if len(scenes) >= 2 and (scenes[0].details or {}).get("boundary_end"):
        scene_candidate = scenes[0].end_time
        scene_id = scenes[0].id

    shot_candidate = shots[0].end_time if shots else None
    shot_id = shots[0].id if shots else None

    candidates_considered = [
        _consider("story_beat", story_beat_candidate, story_beat_id, duration),
        _consider("scene", scene_candidate, scene_id, duration),
        _consider("shot_fallback", shot_candidate, shot_id, duration),
    ]

    accepted = next((c for c in candidates_considered if c["accepted"]), None)

    if accepted is not None:
        hook_end = accepted["candidate_end"]
        derived_from = accepted["source_type"]
        source_id = accepted["source_id"]
        fallback_reason = None
    else:
        hook_end = min(MAX_HOOK_WINDOW_SECONDS, duration)
        derived_from = "time_fallback"
        source_id = None
        rejected_summary = "; ".join(
            f"{c['source_type']}: {c['reason_rejected']}" for c in candidates_considered
        )
        fallback_reason = f"No usable structural boundary -- {rejected_summary}."
        candidates_considered.append({
            "source_type": "time_fallback", "source_id": None, "candidate_end": hook_end,
            "accepted": True, "reason_rejected": None,
        })

    # Final safety clamp -- Hook window must never exceed video duration, regardless of source.
    hook_end = min(hook_end, duration)

    details = {
        "start_time": 0.0,
        "end_time": hook_end,
        "duration": hook_end,
        "derived_from": derived_from,
        "source_id": source_id,
        "fallback_reason": fallback_reason,
        "max_hook_window_seconds": MAX_HOOK_WINDOW_SECONDS,
        "candidates_considered": candidates_considered,
    }

    await db.execute(delete(AnalysisAnnotation).where(
        AnalysisAnnotation.video_analysis_id == video_analysis_id,
        AnalysisAnnotation.category == HOOK_WINDOW_CATEGORY,
    ))
    row = AnalysisAnnotation(
        video_analysis_id=video_analysis_id, shot_id=None, category=HOOK_WINDOW_CATEGORY,
        start_time=0.0, end_time=hook_end, details=details,
        certainty="MEASURED", confidence_score=None, reasoning=None,
        source="deterministic_measurement", produced_by_pass=HOOK_WINDOW_PASS_NAME,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    return details
