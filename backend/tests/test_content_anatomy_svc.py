"""
C2 — Content Anatomy V1 tests. The builder is a PURE function of the C1 aggregate, so nearly every test
hand-builds an aggregate dict (no database, no LLM, no ffmpeg). A few tests at the end run it through the
real read path (`get_content_anatomy` on a real database row) and the router.
"""
import copy

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.models.analysis_annotation import AnalysisAnnotation
from app.models.shot import Shot
from app.routers.reference_videos import get_reference_video_anatomy
from app.schemas.content_anatomy import ContentAnatomyResponse
from app.services.content_anatomy_svc import (
    ANATOMY_VERSION, TRANSCRIPT_EXCERPT_MAX_CHARS, ContentAnatomyInputError, ContentAnatomyNotReady,
    build_content_anatomy, get_content_anatomy,
)
from app.services.deconstruction_orchestrator_svc import STAGES, OrchestrationNotFound
from tests.test_deconstruction_orchestrator_svc import _existing_test_user, cleanup, make_reference

_test_engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool)
_TestSessionLocal = async_sessionmaker(_test_engine, expire_on_commit=False)


# ── aggregate builders ────────────────────────────────────────────────────────────────────────

def stages(**overrides):
    """Every stage 'complete' unless overridden (status string, or (status, reason))."""
    out = []
    for spec in STAGES:
        status = overrides.get(spec.key, "complete")
        reason = None
        if isinstance(status, tuple):
            status, reason = status
        out.append({"key": spec.key, "label": spec.label, "kind": spec.kind, "status": status, "error": None, "reason": reason})
    return out


def shot(id, order, s, e, texts=(), objects=(), frames=(), persistent=0, motion=False):
    return {"id": id, "order": order, "start_time": s, "end_time": e, "certainty": "MEASURED",
            "text_elements": list(texts), "visual_objects": list(objects), "frames": list(frames),
            "persistent_visual_elements": [{"id": i} for i in range(persistent)],
            "global_motion_evidence": {"id": 1} if motion else None, "local_motion_evidence": None}


def text(id, t, s, e=None, conf=0.9):
    return {"id": id, "text": t, "start_time": s, "end_time": s if e is None else e, "confidence_score": conf, "certainty": "MEASURED"}


def speech(id, s, e, t, lang="en"):
    return {"id": id, "start_time": s, "end_time": e, "text": t, "language": lang}


def aggregate(*, duration=30.0, shots=None, beats=None, speeches=(), silences=(), recurring=(), phases=(), accepted=(), examined=(),
              hook_window=None, hook_class=None, stage_overrides=None, scene_roles=None, transitions=(), audio_present=True):
    shots = shots if shots is not None else [shot(1, 0, 0.0, 10.0), shot(2, 1, 10.0, 20.0), shot(3, 2, 20.0, duration)]
    story_beats = [{"id": b[0], "start_time": b[1], "end_time": b[2], "boundary_status": b[3] if len(b) > 3 else "constructed"} for b in (beats or [])]
    scenes = [{"id": 900, "order": 0, "start_time": 0.0, "end_time": duration, "narrative_role": scene_roles,
               "story_beats": story_beats}] if (beats or scene_roles) else []
    return {
        "source": {"reference_video_id": 7, "asset_id": 3},
        "video_analysis": {"id": 70, "status": "complete"},
        "orchestration": {"status": "complete"},
        "stages": stages(**(stage_overrides or {})),
        "technical": {"duration": duration},
        "evidence": {
            "shots": shots, "speech_segments": list(speeches), "recurring_elements": list(recurring),
            "audio_structure": {"audio_stream_present": audio_present, "silence_count": len(silences), "silence_intervals": list(silences)},
            "transition_evidence": list(transitions),
        },
        "structure": {"scenes": scenes},
        "editing_rhythm": {"profile": {"id": 5, "details": {"shot_count": len(shots)}}, "pacing_phases": list(phases), "cut_alignments": []},
        "hook": {"window": hook_window, "classification": hook_class, "reasoning_attempts": []},
        "retention": {"candidates": [], "examined": list(examined), "accepted_devices": list(accepted)},
        "ai_configured": {"retention": True},
        "availability": {"technical": True, "shots": bool(shots)},
    }


def device(id, s, e, dtype="text_reveal", fn="renew_attention", attempt=500, schema="acceptance_gate_v3"):
    return {"id": id, "start_time": s, "end_time": e, "device_type": dtype, "probable_attention_function": fn,
            "confidence": "medium", "reasoning_attempt_id": attempt, "schema": schema}


def examined(attempt, s, e, decision, dtype="text_reveal", reasoning="routine captions"):
    return {"attempt_id": attempt, "candidate_start": s, "candidate_end": e, "device_type": dtype,
            "is_retention_device": decision, "reasoning": reasoning}


def phase(id, s, e, partition="scene"):
    return {"id": id, "start_time": s, "end_time": e, "details": {"partition_type": partition}}


THREE_BEATS = [(11, 0.0, 10.0), (12, 10.0, 20.0), (13, 20.0, 30.0)]


# ── section skeleton ────────────────────────────────────────────────────────────────────────

def test_story_beats_are_the_skeleton_when_available():
    a = build_content_anatomy(aggregate(beats=THREE_BEATS))
    assert a["section_source"]["selected"] == "story_beats"
    assert [(s["number"], s["start_time"], s["end_time"], s["duration"]) for s in a["sections"]] == [
        (1, 0.0, 10.0, 10.0), (2, 10.0, 20.0, 10.0), (3, 20.0, 30.0, 10.0)]
    assert [s["source_partition"] for s in a["sections"]] == ["story_beat"] * 3
    assert [s["source_ref"]["story_beat_id"] for s in a["sections"]] == [11, 12, 13]
    assert [s["is_opening"] for s in a["sections"]] == [True, False, False]
    assert a["video"]["section_count"] == 3 and a["video"]["opening_section_number"] == 1
    assert sum(s["duration"] for s in a["sections"]) == a["video"]["duration"]
    assert a["section_source"]["considered"][0] == {"source": "story_beats", "available": True, "usable": True, "count": 3, "note": None}


def test_a_beat_straddling_two_scenes_is_listed_once():
    agg = aggregate(beats=THREE_BEATS)
    agg["structure"]["scenes"].append({"id": 901, "order": 1, "start_time": 5.0, "end_time": 30.0, "narrative_role": None,
                                       "story_beats": [{"id": 12, "start_time": 10.0, "end_time": 20.0, "boundary_status": "constructed"}]})
    assert [s["source_ref"]["story_beat_id"] for s in build_content_anatomy(agg)["sections"]] == [11, 12, 13]


def test_a_lone_whole_video_beat_is_unusable_and_falls_back_to_shots():
    a = build_content_anatomy(aggregate(beats=[(11, 0.0, 30.0, "no_accepted_boundary")]))
    assert a["section_source"]["selected"] == "shots" and len(a["sections"]) == 3
    note = a["section_source"]["considered"][0]["note"]
    assert "single whole-video Story Beat" in note
    assert any(g["field"] == "story_beats" and g["kind"] == "unusable_source" for g in a["gaps"])


def test_story_beats_unavailable_falls_back_to_shots_and_says_why():
    a = build_content_anatomy(aggregate(stage_overrides={"scene_story_beats": ("skipped", "AI reasoner not configured (X is empty)"),
                                                          "hook_classification": "skipped", "retention_devices": "skipped"}))
    assert a["section_source"]["selected"] == "shots"
    assert a["section_source"]["reason"].startswith("Story Beats unusable")
    assert "Stage 10 was skipped" in a["section_source"]["considered"][0]["note"]
    assert [s["source_partition"] for s in a["sections"]] == ["shot"] * 3
    assert [s["source_ref"]["shot_id"] for s in a["sections"]] == [1, 2, 3]
    kinds = {g["field"]: g["kind"] for g in a["gaps"]}
    assert kinds["stage:scene_story_beats"] == "ai_not_configured"  # a normal state, reported, not an error


def test_shots_unavailable_falls_back_to_pacing_phases_preferring_the_story_beat_partition():
    phases = [phase(21, 0.0, 30.0, "scene"), phase(22, 0.0, 12.0, "story_beat"), phase(23, 12.0, 30.0, "story_beat")]
    a = build_content_anatomy(aggregate(shots=[], phases=phases))
    assert a["section_source"]["selected"] == "pacing_phases"
    assert a["section_source"]["considered"][2]["partition_type"] == "story_beat"
    assert [(s["start_time"], s["end_time"]) for s in a["sections"]] == [(0.0, 12.0), (12.0, 30.0)]
    assert [s["source_ref"]["pacing_phase_id"] for s in a["sections"]] == [22, 23]
    # Both partitions' phases that overlap the section are referenced (they are independent segmentations).
    assert a["sections"][0]["pacing"]["pacing_phase_ids"] == [21, 22]


def test_scene_partition_is_used_when_no_story_beat_phases_exist():
    a = build_content_anatomy(aggregate(shots=[], phases=[phase(21, 0.0, 15.0, "scene"), phase(22, 15.0, 30.0, "scene")]))
    assert a["section_source"]["selected"] == "pacing_phases" and len(a["sections"]) == 2


def test_no_skeleton_source_at_all_yields_zero_sections_and_a_gap_not_an_error():
    a = build_content_anatomy(aggregate(shots=[]))
    assert a["sections"] == [] and a["section_source"]["selected"] is None
    assert a["video"]["opening_section_number"] is None and a["video"]["section_count"] == 0
    assert a["video"]["structural_pattern"]["summary"] == "No section skeleton could be built."
    ContentAnatomyResponse.model_validate(a)


# ── readiness / malformed input ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("overrides", [{"technical_probe": "failed"}, {"technical_probe": "not_run"}])
def test_not_ready_until_the_technical_probe_completes(overrides):
    with pytest.raises(ContentAnatomyNotReady):
        build_content_anatomy(aggregate(stage_overrides=overrides))


@pytest.mark.parametrize("status", ["failed", "blocked", "not_run"])
def test_not_ready_until_shot_detection_completes(status):
    with pytest.raises(ContentAnatomyNotReady):
        build_content_anatomy(aggregate(stage_overrides={"scene_segmentation": status}))


def test_malformed_aggregates_are_rejected_or_degrade_but_never_crash():
    with pytest.raises(ContentAnatomyInputError):
        build_content_anatomy("not a dict")  # type: ignore[arg-type]
    with pytest.raises(ContentAnatomyNotReady):
        build_content_anatomy({})  # nothing says the probe ran
    no_duration = aggregate()
    no_duration["technical"] = {}
    with pytest.raises(ContentAnatomyInputError):
        build_content_anatomy(no_duration)
    bad_duration = aggregate()
    bad_duration["technical"] = {"duration": 0}
    with pytest.raises(ContentAnatomyInputError):
        build_content_anatomy(bad_duration)


def test_missing_stage_status_falls_back_to_availability_and_reports_the_gap():
    agg = aggregate(beats=THREE_BEATS)
    del agg["stages"]
    a = build_content_anatomy(agg)
    assert len(a["sections"]) == 3
    assert any(g["field"] == "stages" and g["kind"] == "not_established" for g in a["gaps"])
    agg["availability"] = {"technical": True, "shots": False}
    with pytest.raises(ContentAnatomyNotReady):
        build_content_anatomy(agg)


def test_rows_without_usable_times_are_ignored_and_reported_never_crash():
    agg = aggregate(beats=THREE_BEATS, speeches=[speech(1, 1.0, 2.0, "ok"), {"id": 2, "text": "no times"}, {"id": 3, "start_time": "x", "end_time": 1}])
    agg["retention"]["examined"].append({"attempt_id": 9, "candidate_start": None, "candidate_end": None, "is_retention_device": False})
    a = build_content_anatomy(agg)
    assert a["sections"][0]["evidence_ids"]["speech_segments"] == [1]
    gap = next(g for g in a["gaps"] if g["field"] == "evidence:speech_segments")
    assert gap["kind"] == "malformed_evidence" and "2 row(s)" in gap["reason"]
    ContentAnatomyResponse.model_validate(a)


def test_a_completely_bare_but_ready_aggregate_still_builds():
    bare = {"stages": stages(), "technical": {"duration": 12.0}, "availability": {"technical": True, "shots": True},
            "evidence": {"shots": [shot(1, 0, 0.0, 12.0)]}}
    a = build_content_anatomy(bare)
    assert len(a["sections"]) == 1 and a["sections"][0]["speech"] == [] and a["sections"][0]["retention_devices"] == []
    assert a["video"]["hook"] == {"window": None, "hook_section_numbers": [], "classification": None}
    assert a["video"]["retention"]["analysis_status"] == "not_run"
    ContentAnatomyResponse.model_validate(a)


# ── per-section content ─────────────────────────────────────────────────────────────────────

def test_speech_text_silence_visuals_and_pacing_land_in_the_right_sections():
    agg = aggregate(
        beats=THREE_BEATS,
        shots=[shot(1, 0, 0.0, 10.0, texts=[text(41, "HEADLINE", 2.0)], objects=[{"id": 61, "label": "person", "category": "person", "start_time": 0.0, "end_time": 10.0}],
                    frames=[{"id": 81, "timestamp": 1.0}], persistent=2, motion=True),
               shot(2, 1, 10.0, 20.0, texts=[text(42, "SECOND", 10.0)]),   # exactly on the boundary -> section 2 only
               shot(3, 2, 20.0, 30.0)],
        speeches=[speech(51, 1.0, 4.0, "hello there"), speech(52, 9.0, 12.0, "straddles the boundary")],
        silences=[{"id": 71, "start_time": 25.0, "end_time": 28.0}],
        transitions=[{"id": 91, "boundary_timestamp": 10.0}, {"id": 92, "boundary_timestamp": 20.0}],
    )
    s1, s2, s3 = build_content_anatomy(agg)["sections"]
    assert [x["id"] for x in s1["on_screen_text"]] == [41] and [x["id"] for x in s2["on_screen_text"]] == [42]
    assert s3["on_screen_text"] == []
    assert s1["transcript_excerpt"] == "hello there straddles the boundary"
    assert [(x["id"], x["overlap_seconds"]) for x in s1["speech"]] == [(51, 3.0), (52, 1.0)]
    assert [(x["id"], x["overlap_seconds"]) for x in s2["speech"]] == [(52, 2.0)]  # a straddler is in both, with its own overlap
    assert s3["audio"]["silence_seconds"] == 3.0 and s1["audio"]["silence_seconds"] == 0.0
    assert s1["audio"]["audio_stream_present"] is True
    assert s1["visual"]["objects"] == [{"label": "person", "category": "person", "count": 1}]
    assert s1["visual"]["persistent_visual_element_count"] == 2 and s1["visual"]["keyframe_ids"] == [81]
    assert s1["visual"]["motion_evidence_shot_ids"] == [1] and s2["visual"]["motion_evidence_shot_ids"] == []
    assert s2["visual"]["transition_evidence_ids"] == [91] and s3["visual"]["transition_evidence_ids"] == [92]
    assert s1["features"] == ["speech", "on_screen_text"]
    assert s3["features"] == ["silence", "cut"]  # silence 25-28s, and the cut at 20.0 belongs to [20, 30)


def test_pacing_uses_half_open_sections_and_clipped_exposure():
    a = build_content_anatomy(aggregate(beats=[(11, 0.0, 15.0), (12, 15.0, 30.0)]))
    s1, s2 = a["sections"]
    # shots: 0-10, 10-20, 20-30 -> cuts at 10 and 20. Section 1 [0,15) owns the cut at 10; section 2 [15,30) owns 20.
    assert (s1["pacing"]["shot_count"], s1["pacing"]["cut_count"]) == (2, 1)
    assert (s2["pacing"]["shot_count"], s2["pacing"]["cut_count"]) == (2, 1)
    assert s1["pacing"]["average_shot_exposure_seconds"] == 7.5   # exposures 10 and 5
    assert s1["pacing"]["cuts_per_minute"] == 4.0                 # 1 cut / 15s * 60
    profile = a["video"]["pacing_profile"]
    assert (profile["shot_count"], profile["cut_count"], profile["cuts_per_minute"]) == (3, 2, 4.0)
    assert profile["average_shot_duration_seconds"] == 10.0 and profile["stage_11_1_profile"] == {"shot_count": 3}


def test_a_cut_exactly_on_a_section_boundary_is_counted_in_exactly_one_section():
    a = build_content_anatomy(aggregate(beats=THREE_BEATS))
    assert [s["pacing"]["cut_count"] for s in a["sections"]] == [0, 1, 1]
    assert sum(s["pacing"]["cut_count"] for s in a["sections"]) == a["video"]["pacing_profile"]["cut_count"]


def test_the_last_section_owns_an_instant_at_the_very_end_of_the_video():
    agg = aggregate(beats=THREE_BEATS, shots=[shot(1, 0, 0.0, 30.0, texts=[text(41, "END", 30.0)])])
    assert [len(s["on_screen_text"]) for s in build_content_anatomy(agg)["sections"]] == [0, 0, 1]


def test_transcript_excerpt_is_capped_and_flagged_truncated():
    long_text = "word " * 200
    a = build_content_anatomy(aggregate(beats=THREE_BEATS, speeches=[speech(51, 1.0, 9.0, long_text)]))
    first = a["sections"][0]
    assert len(first["transcript_excerpt"]) == TRANSCRIPT_EXCERPT_MAX_CHARS and first["transcript_truncated"] is True
    assert first["speech"][0]["text"] == long_text  # the full text is still available in `speech`


# ── hook ─────────────────────────────────────────────────────────────────────────────────────

def test_hook_window_marks_the_overlapping_sections_and_passes_the_classification_through():
    hook_class = {"details": {"primary_type": "question", "probable_intent": "create_curiosity", "provider": "anthropic", "model": "m", "prompt_version": "v1"},
                  "reasoning": "a spoken question", "certainty": "INFERRED"}
    a = build_content_anatomy(aggregate(beats=THREE_BEATS, hook_window={"start_time": 0.0, "end_time": 3.0, "certainty": "MEASURED", "details": {"derived_from": "shot", "source_id": 1, "fallback_reason": None}},
                                        hook_class=hook_class))
    assert [s["overlaps_hook_window"] for s in a["sections"]] == [True, False, False]
    assert "hook_window" in a["sections"][0]["features"]
    hook = a["video"]["hook"]
    assert hook["hook_section_numbers"] == [1] and hook["window"]["derived_from"] == "shot" and hook["window"]["source_id"] == 1
    assert hook["classification"]["primary_type"] == "question" and hook["classification"]["certainty"] == "INFERRED"


# ── retention: zero devices, accepted devices, rejected candidates, legacy ───────────────────

def test_zero_accepted_devices_is_a_normal_complete_anatomy():
    ex = [examined(1, 3.0, 3.0, False), examined(2, 12.0, 12.0, False, dtype="scene_switch")]
    a = build_content_anatomy(aggregate(beats=THREE_BEATS, examined=ex))
    assert all(s["retention_devices"] == [] for s in a["sections"])
    assert a["video"]["retention"] == {"analysis_status": "examined_none_accepted", "accepted_count": 0, "accepted_by_type": {},
                                       "examined_count": 2, "rejected_count": 2, "no_decision_count": 0, "ai_configured": True}
    assert a["video"]["structural_pattern"]["accepted_retention_device_count"] == 0
    assert "0 accepted retention device(s)" in a["video"]["structural_pattern"]["summary"]
    # The rejected candidates are visible as REFERENCES in their own sections, never as mechanisms.
    assert [r["attempt_id"] for r in a["sections"][0]["rejected_candidates"]] == [1]
    assert [r["status"] for r in a["sections"][1]["rejected_candidates"]] == ["rejected"]
    assert a["sections"][0]["rejected_candidates"][0]["reasoning_excerpt"] == "routine captions"


def test_accepted_devices_are_placed_by_time_with_provenance_and_feed_the_summary():
    acc = [device(31, 3.0, 3.0), device(32, 10.0, 10.0, dtype="question", fn="prompt_mental_response", attempt=501),
           device(33, 30.0, 30.0, attempt=502)]  # an instant on the exact boundary / at the very end
    a = build_content_anatomy(aggregate(beats=THREE_BEATS, accepted=acc, examined=[examined(500, 3.0, 3.0, True)]))
    s1, s2, s3 = a["sections"]
    assert [d["id"] for d in s1["retention_devices"]] == [31] and [d["id"] for d in s2["retention_devices"]] == [32]
    assert [d["id"] for d in s3["retention_devices"]] == [33]  # the boundary instant 10.0 belongs to exactly one section
    assert s1["retention_devices"][0]["probable_attention_function"] == "renew_attention"
    assert s1["retention_devices"][0]["certainty"] == "INFERRED" and s1["retention_devices"][0]["reasoning_attempt_id"] == 500
    assert "accepted_retention_device" in s1["features"]
    assert s1["evidence_ids"]["retention_devices"] == [31] and 500 in s1["evidence_ids"]["retention_attempts"]
    assert s1["rejected_candidates"] == []  # an ACCEPTED attempt is never also listed as rejected
    retention = a["video"]["retention"]
    assert retention["analysis_status"] == "accepted_present" and retention["accepted_count"] == 3
    assert retention["accepted_by_type"] == {"question": 1, "text_reveal": 2}


def test_captions_and_watermarks_are_never_promoted_to_devices():
    caption = text(41, "Kabhi Wapas Laut Kar Nahi Aati", 3.0)
    watermark = text(42, "@TANUCREATES_0", 4.0)
    recurring = [{"id": 700, "member_text_element_ids": [42], "start_time": 0.0, "end_time": 30.0}]
    ex = [examined(1, 3.0, 3.0, False, reasoning="routine caption progression"), examined(2, 4.0, 4.0, False, reasoning="watermark handle")]
    a = build_content_anatomy(aggregate(beats=THREE_BEATS, shots=[shot(1, 0, 0.0, 30.0, texts=[caption, watermark])], recurring=recurring, examined=ex))
    first = a["sections"][0]
    assert {t["id"]: t["recurring_element_id"] for t in first["on_screen_text"]} == {41: None, 42: 700}
    assert first["retention_devices"] == []
    assert "accepted_retention_device" not in first["features"] and "on_screen_text" in first["features"]
    assert {r["status"] for r in first["rejected_candidates"]} == {"rejected"}
    assert a["video"]["retention"]["accepted_count"] == 0


def test_historical_pre_gate_attempts_and_devices_are_safe_and_never_treated_as_accepted():
    """Pre-acceptance-gate data has no decision: is_retention_device=None (attempts) / a legacy schema tag
    with no function (device rows). Neither may be presented as an accepted mechanism."""
    legacy_attempt = {"attempt_id": 5, "candidate_start": 3.0, "candidate_end": 3.0, "device_type": "text_reveal",
                      "reasoning": "old reasoning", "schema": "legacy_pre_acceptance_gate"}  # no is_retention_device key at all
    legacy_device = {"id": 30, "start_time": 3.0, "end_time": 3.0, "device_type": "text_reveal", "reasoning_attempt_id": 5,
                     "schema": "legacy_pre_acceptance_gate"}
    a = build_content_anatomy(aggregate(beats=THREE_BEATS, examined=[legacy_attempt], accepted=[legacy_device]))
    first = a["sections"][0]
    assert first["retention_devices"] == []
    assert {r["status"] for r in first["rejected_candidates"]} == {"no_acceptance_decision"}
    retention = a["video"]["retention"]
    assert retention["accepted_count"] == 0 and retention["no_decision_count"] == 1 and retention["analysis_status"] == "legacy_only_no_decision"
    assert any(g["field"] == "retention_devices" and g["kind"] == "legacy_data" for g in a["gaps"])
    ContentAnatomyResponse.model_validate(a)


# ── interpretive fields ────────────────────────────────────────────────────────────────────

def test_unsupported_interpretive_fields_stay_null_and_every_absence_is_a_gap():
    a = build_content_anatomy(aggregate(beats=THREE_BEATS))
    for section in a["sections"]:
        assert section["interpretive"] == {"narrative_role": None, "messaging_role": None, "emotional_function": None, "cta_role": None,
                                           "status": "unsupported_in_v1"}
    assert a["video"]["interpretive"]["cta_role"] is None
    fields = {g["field"]: g["kind"] for g in a["gaps"]}
    assert fields["narrative_role"] == "not_established"
    assert fields["messaging_role"] == fields["emotional_function"] == fields["cta_role"] == "unsupported_in_v1"


def test_narrative_role_is_passed_through_only_when_upstream_genuinely_supplies_it():
    a = build_content_anatomy(aggregate(beats=THREE_BEATS, scene_roles="hook"))
    assert {s["interpretive"]["narrative_role"] for s in a["sections"]} == {"hook"}
    assert a["sections"][0]["interpretive"]["status"] == "narrative_role_from_scene"
    assert not any(g["field"] == "narrative_role" for g in a["gaps"])
    # messaging / emotion / CTA remain null regardless.
    assert a["sections"][0]["interpretive"]["cta_role"] is None
    agg = aggregate(beats=THREE_BEATS, scene_roles="hook")
    agg["structure"]["scenes"].append({"id": 901, "order": 1, "start_time": 0.0, "end_time": 30.0, "narrative_role": "proof", "story_beats": []})
    assert build_content_anatomy(agg)["sections"][0]["interpretive"]["narrative_role"] is None  # conflicting roles -> not established


# ── missing optional evidence ───────────────────────────────────────────────────────────────

def test_missing_optional_evidence_yields_empty_collections_and_stage_gaps_not_errors():
    a = build_content_anatomy(aggregate(
        beats=THREE_BEATS, audio_present=None,
        stage_overrides={"speech_analysis": "failed", "text_analysis": "blocked", "visual_objects": "not_run",
                         "hook_classification": "skipped", "retention_devices": "skipped"}))
    for section in a["sections"]:
        assert section["speech"] == [] and section["on_screen_text"] == [] and section["visual"]["objects"] == []
        assert section["audio"]["silence_intervals"] == [] and section["audio"]["audio_stream_present"] is None
    kinds = {g["field"]: g["kind"] for g in a["gaps"]}
    assert kinds["stage:speech_analysis"] == "stage_failed" and kinds["stage:text_analysis"] == "stage_blocked"
    assert kinds["stage:visual_objects"] == "analysis_not_run" and kinds["stage:retention_devices"] == "ai_not_configured"
    assert "speech_analysis" in a["evidence_coverage"]["stages_not_done"]
    assert a["evidence_coverage"]["counts"]["speech_segments"] == 0
    ContentAnatomyResponse.model_validate(a)


# ── stage status vs. data that demonstrably exists ─────────────────────────────────────────

def test_a_not_run_derived_stage_whose_results_exist_is_not_reported_as_a_gap():
    """A video processed manually (before C1) has no orchestrator record, so C1 reports its derived stages as
    not_run even though their results are in the aggregate. That is not a gap."""
    agg = aggregate(beats=THREE_BEATS, stage_overrides={"editing_rhythm": "not_run", "hook_window": "not_run", "retention_devices": "not_run"},
                    hook_window={"start_time": 0.0, "end_time": 3.0, "details": {}})
    agg["availability"].update({"editing_rhythm": True, "hook_window": True, "retention_examined": True})
    a = build_content_anatomy(agg)
    fields = {g["field"] for g in a["gaps"]}
    assert not fields & {"stage:editing_rhythm", "stage:hook_window", "stage:retention_devices"}
    assert not set(a["evidence_coverage"]["stages_not_done"]) & {"editing_rhythm", "hook_window", "retention_devices"}


def test_a_not_run_stage_with_no_data_is_still_a_gap():
    agg = aggregate(beats=THREE_BEATS, stage_overrides={"hook_window": "not_run", "editing_rhythm": "not_run"})
    agg["availability"]["editing_rhythm"] = True  # only this one has data
    fields = {g["field"]: g["kind"] for g in build_content_anatomy(agg)["gaps"]}
    assert fields["stage:hook_window"] == "analysis_not_run" and "stage:editing_rhythm" not in fields


# ── provenance, determinism, schema ────────────────────────────────────────────────────────

def test_evidence_provenance_is_traceable_to_the_aggregate_ids():
    agg = aggregate(beats=THREE_BEATS, speeches=[speech(51, 1.0, 4.0, "hi")], shots=[shot(1, 0, 0.0, 30.0, texts=[text(41, "T", 2.0)])],
                    silences=[{"id": 71, "start_time": 5.0, "end_time": 6.0}], phases=[phase(21, 0.0, 30.0, "story_beat")])
    a = build_content_anatomy(agg)
    ids = a["sections"][0]["evidence_ids"]
    assert ids["story_beats"] == [11] and ids["shots"] == [1] and ids["speech_segments"] == [51] and ids["text_elements"] == [41]
    assert ids["silence_intervals"] == [71] and ids["pacing_phases"] == [21] and ids["scenes"] == [900]
    prov = a["provenance"]
    assert (prov["reference_video_id"], prov["video_analysis_id"], prov["anatomy_version"]) == (7, 70, ANATOMY_VERSION)
    assert prov["llm_calls"] == 0 and prov["persisted"] is False and prov["orchestration_status"] == "complete"
    assert len(prov["fingerprint"]) == 64
    assert a["sections"][0]["certainty"] == "MEASURED"


def test_the_result_is_deterministic_and_never_mutates_its_input():
    agg = aggregate(beats=THREE_BEATS, speeches=[speech(51, 1.0, 4.0, "hi")], accepted=[device(31, 3.0, 3.0)])
    snapshot = copy.deepcopy(agg)
    first, second = build_content_anatomy(agg), build_content_anatomy(agg)
    assert first == second and first["provenance"]["fingerprint"] == second["provenance"]["fingerprint"]
    assert agg == snapshot
    assert build_content_anatomy(copy.deepcopy(agg))["provenance"]["fingerprint"] == first["provenance"]["fingerprint"]


def test_the_fingerprint_changes_when_the_evidence_or_its_ids_change():
    base = aggregate(beats=THREE_BEATS, speeches=[speech(51, 1.0, 4.0, "hi")])
    fp = lambda agg: build_content_anatomy(agg)["provenance"]["fingerprint"]  # noqa: E731
    assert fp(base) != fp(aggregate(beats=THREE_BEATS, speeches=[speech(52, 1.0, 4.0, "hi")]))     # same content, different evidence id
    assert fp(base) != fp(aggregate(beats=THREE_BEATS, speeches=[speech(51, 1.0, 4.0, "hello")]))  # different content
    assert fp(base) != fp(aggregate(beats=THREE_BEATS, speeches=[speech(51, 1.0, 4.0, "hi")], accepted=[device(31, 3.0, 3.0)]))


def test_a_rich_anatomy_validates_against_the_response_schema():
    a = build_content_anatomy(aggregate(
        beats=THREE_BEATS, speeches=[speech(51, 1.0, 4.0, "hi")], accepted=[device(31, 3.0, 3.0)], examined=[examined(500, 3.0, 3.0, True), examined(501, 12.0, 12.0, False)],
        hook_window={"start_time": 0.0, "end_time": 3.0, "certainty": "MEASURED", "details": {"derived_from": "shot"}},
        shots=[shot(1, 0, 0.0, 10.0, texts=[text(41, "T", 2.0)], frames=[{"id": 81, "timestamp": 1.0}]), shot(2, 1, 10.0, 30.0)]))
    parsed = ContentAnatomyResponse.model_validate(a)
    assert parsed.video.section_count == 3 and parsed.provenance.fingerprint == a["provenance"]["fingerprint"]


def test_evidence_may_be_the_pydantic_model_or_a_plain_dict():
    class Model:
        def __init__(self, d): self._d = d
        def model_dump(self, mode="python"): return copy.deepcopy(self._d)

    agg = aggregate(beats=THREE_BEATS, speeches=[speech(51, 1.0, 4.0, "hi")])
    as_dict = build_content_anatomy(agg)
    agg["evidence"] = Model(agg["evidence"])
    assert build_content_anatomy(agg) == as_dict


# ── the real read path (database) and the router ───────────────────────────────────────────────

async def _seed_shots(db, va_id):
    for i, (s, e) in enumerate([(0.0, 10.0), (10.0, 30.0)]):
        db.add(Shot(video_analysis_id=va_id, scene_id=None, order=i, start_time=s, end_time=e,
                    certainty="MEASURED", source="ffmpeg_scene_filter", produced_by_pass="scene_cut_detection_v1"))
    await db.commit()


async def test_real_read_path_builds_an_anatomy_from_a_database_analysis_without_story_beats():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, va_id = await make_reference(db, user, va_status="complete",
                                                      pass_status={"technical_probe": "complete", "scene_segmentation": "complete"})
        try:
            await _seed_shots(db, va_id)
            db.add(AnalysisAnnotation(video_analysis_id=va_id, shot_id=None, category="hook_window", start_time=0.0, end_time=3.0,
                                      details={"start_time": 0.0, "end_time": 3.0, "derived_from": "shot", "source_id": 1}, certainty="MEASURED", source="test"))
            await db.commit()
            a = await get_content_anatomy(db, user, rv_id)
            ContentAnatomyResponse.model_validate(a)
            assert a["section_source"]["selected"] == "shots" and [s["duration"] for s in a["sections"]] == [10.0, 20.0]
            assert a["video"]["hook"]["hook_section_numbers"] == [1]
            assert a["provenance"]["video_analysis_id"] == va_id and a["provenance"]["reference_video_id"] == rv_id
            assert (await get_content_anatomy(db, user, rv_id))["provenance"]["fingerprint"] == a["provenance"]["fingerprint"]
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_real_read_path_refuses_until_shot_detection_completes_and_hides_foreign_videos():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        rv_id, asset_id, _ = await make_reference(db, user)  # nothing has run
        try:
            with pytest.raises(ContentAnatomyNotReady):
                await get_content_anatomy(db, user, rv_id)
            with pytest.raises(OrchestrationNotFound):
                await get_content_anatomy(db, user, 999_999_999)
        finally:
            await cleanup(db, asset_id, rv_id)


async def test_router_maps_not_found_to_404_not_ready_to_422_and_success_to_a_schema_valid_body():
    async with _TestSessionLocal() as db:
        user = await _existing_test_user(db)
        with pytest.raises(HTTPException) as unknown:
            await get_reference_video_anatomy(reference_video_id=999_999_999, db=db, user=user)
        assert unknown.value.status_code == 404

        rv_id, asset_id, va_id = await make_reference(db, user)
        try:
            with pytest.raises(HTTPException) as not_ready:
                await get_reference_video_anatomy(reference_video_id=rv_id, db=db, user=user)
            assert not_ready.value.status_code == 422 and "technical probe" in not_ready.value.detail

            await orch_patch(db, va_id, {"technical_probe": "complete", "scene_segmentation": "complete"})
            await _seed_shots(db, va_id)
            body = await get_reference_video_anatomy(reference_video_id=rv_id, db=db, user=user)
            ContentAnatomyResponse.model_validate(body)
            assert body["video"]["section_count"] == 2

            with pytest.raises(HTTPException) as wrong_pin:
                await get_reference_video_anatomy(reference_video_id=rv_id, video_analysis_id=999_999_999, db=db, user=user)
            assert wrong_pin.value.status_code == 404
        finally:
            await cleanup(db, asset_id, rv_id)


async def orch_patch(db, va_id, patch):
    from app.services.deconstruction_orchestrator_svc import _patch_pass_status
    await _patch_pass_status(db, va_id, patch)
