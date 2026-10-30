"""The V1 clip-join plan (timeline_plan.py): pure, no ffmpeg. The contract: footage sits at the editor's own start times whatever the transition, the output is exactly as long as the timeline,
a blend borrows REAL source frames (or is shortened / held per policy), and rounding cannot accumulate across joins."""
import random

import pytest

from app.services import ffmpeg_svc, timeline_plan as tp

F = tp.FPS
XF = ffmpeg_svc._XFADE_NAMES


def clip(start, end, trim=0.0, speed=1.0, transition="cut", td=0.5, path="a.mp4"):
    return {"path": path, "trim_in": trim, "start_time": start, "end_time": end, "speed": speed, "transition": transition, "transition_duration": td}


def timeline_len(plan: tp.TimelinePlan) -> int:
    """frames the join graph produces: every extended segment, minus what each blend window shares between two segments"""
    return sum(c.total for c in plan.clips) - sum(j.window for j in plan.joins if j.kind == "blend")


def test_hard_cuts_neither_overlap_nor_shorten():
    plan = tp.plan_timeline([clip(0, 3), clip(3, 6), clip(6, 9)], XF)
    assert [j.kind for j in plan.joins] == ["cut", "cut"]
    assert plan.total_f == 270 and timeline_len(plan) == 270
    assert [c.start_f for c in plan.clips] == [0, 90, 180] and all(c.pre == 0 and c.post == 0 for c in plan.clips)


def test_boundaries_are_rounded_cumulatively_so_nothing_drifts():
    ends = [0.7, 1.45, 2.2, 2.95, 3.7, 4.45, 5.2, 5.95, 6.7, 7.45]
    clips, s = [], 0.0
    for e in ends:
        clips.append(clip(s, e)); s = e
    plan = tp.plan_timeline(clips, XF)
    assert plan.total_f == round(7.45 * F) and timeline_len(plan) == plan.total_f
    assert [c.start_f + c.n for c in plan.clips] == [round(e * F) for e in ends]


def test_blend_borrows_real_frames_centred_on_the_join():
    clips = [clip(0, 4, trim=2, transition="dissolve", td=1.0), clip(4, 8, trim=2)]
    plan = tp.plan_timeline(clips, XF, {"a.mp4": 12.0})
    j = plan.joins[0]
    assert (j.kind, j.pre, j.post, j.window, j.join_f) == ("blend", 15, 15, 30, 120)
    out, inc = plan.clips
    assert out.post_real == 15 and out.pre == 0 and inc.pre_real == 15 and inc.post == 0
    assert inc.source_trim_in == pytest.approx(2 - 0.5) and inc.source_duration == pytest.approx(4 + 0.5)    # 15 frames of real source before its trim-in
    assert out.source_trim_in == pytest.approx(2) and out.source_duration == pytest.approx(4 + 0.5)
    assert timeline_len(plan) == 240 == plan.total_f                                                          # the transition did not shorten the timeline


def test_blend_window_is_shortened_to_the_spare_source_frames_never_invented():
    clips = [clip(0, 4, trim=0, transition="dissolve", td=1.0), clip(4, 8, trim=0.2)]      # incoming has 0.2 s before its trim-in, outgoing has no tail (file ends at its trim-out)
    plan = tp.plan_timeline(clips, XF, {"a.mp4": 4.0})
    j = plan.joins[0]
    assert j.post == 0 and j.pre == 5                          # 0.2 s = 6 frames, minus the one-frame guard
    assert j.window < j.requested and "shortened" in j.note
    assert plan.clips[0].post_hold == 0 and plan.clips[1].pre_hold == 0 and timeline_len(plan) == plan.total_f


def test_a_blend_with_no_spare_frames_at_all_becomes_a_hard_cut():
    plan = tp.plan_timeline([clip(0, 4, transition="dissolve", td=1.0), clip(4, 8)], XF, {"a.mp4": 4.0})
    assert plan.joins[0].kind == "cut" and plan.total_f == timeline_len(plan) == 240


def test_unknown_source_length_means_no_post_roll():
    plan = tp.plan_timeline([clip(0, 4, trim=3, transition="dissolve", td=1.0), clip(4, 8, trim=3)], XF, None)
    assert plan.joins[0].post == 0 and plan.joins[0].pre == 30       # only the incoming side has real frames, so it supplies the whole window
    assert timeline_len(plan) == plan.total_f


def test_hold_policy_repeats_the_edge_frame_instead_of_shortening():
    plan = tp.plan_timeline([clip(0, 4, trim=0, transition="dissolve", td=1.0), clip(4, 8)], XF, {"a.mp4": 4.0}, policy="hold")
    j = plan.joins[0]
    assert (j.kind, j.window) == ("blend", 30)
    assert plan.clips[0].post_hold == 15 and plan.clips[0].post_real == 0 and plan.clips[1].pre_hold == 15 and plan.clips[1].pre_real == 0
    assert plan.clips[0].source_duration == pytest.approx(4.0)         # held frames are not cut from the source
    assert timeline_len(plan) == plan.total_f


def test_hold_incoming_policy_never_freezes_the_outgoing_clip():
    plan = tp.plan_timeline([clip(0, 4, trim=0, transition="dissolve", td=1.0), clip(4, 8)], XF, {"a.mp4": 4.0}, policy="hold_incoming")
    j = plan.joins[0]
    assert (j.kind, j.window, j.post, j.pre) == ("blend", 30, 0, 30)
    assert plan.clips[0].post == 0 and plan.clips[1].pre_hold == 30 and plan.clips[1].pre_real == 0       # the whole window is the incoming clip's first frame, ending at the join
    assert timeline_len(plan) == plan.total_f
    real = tp.plan_timeline([clip(0, 4, trim=2, transition="dissolve", td=1.0), clip(4, 8, trim=0)], XF, {"a.mp4": 12.0}, policy="hold_incoming")
    assert real.joins[0].post == 15 and real.clips[0].post_real == 15 and real.clips[0].post_hold == 0       # real tail frames are still used where they exist


def test_fade_through_black_stays_inside_the_clips_own_spans():
    plan = tp.plan_timeline([clip(0, 4, transition="fade_black", td=1.0), clip(4, 8)], XF)
    j = plan.joins[0]
    assert j.kind == "fade" and plan.clips[0].fade_out == 15 and plan.clips[1].fade_in == 15
    assert plan.clips[0].pre == plan.clips[0].post == plan.clips[1].pre == plan.clips[1].post == 0
    assert timeline_len(plan) == plan.total_f == 240


def test_legacy_fade_to_black_name_is_a_fade_too():
    assert tp.plan_timeline([clip(0, 2, transition="fade_to_black", td=0.5), clip(2, 4)], XF).joins[0].kind == "fade"


def test_a_short_clip_between_two_long_blends_keeps_both_windows_inside_itself():
    clips = [clip(0, 2, trim=2, transition="dissolve", td=1.0), clip(2, 2.4, trim=2, transition="dissolve", td=1.0), clip(2.4, 5, trim=2)]
    plan = tp.plan_timeline(clips, XF, {"a.mp4": 12.0})
    mid = plan.clips[1]
    used = plan.joins[0].post + plan.joins[1].pre
    assert used <= mid.n and mid.n == 12
    assert timeline_len(plan) == plan.total_f


def test_speed_scales_the_source_range_but_not_the_timeline():
    plan = tp.plan_timeline([clip(0, 3, trim=2, speed=2.0, transition="dissolve", td=0.6), clip(3, 6, trim=2, speed=0.5)], XF, {"a.mp4": 12.0})
    j = plan.joins[0]
    inc = plan.clips[1]
    assert inc.pre_real == j.pre and inc.source_trim_in == pytest.approx(2 - j.pre / F * 0.5)
    assert plan.clips[0].source_duration == pytest.approx((90 + j.post) / F * 2.0)


def test_random_projects_always_keep_the_timeline_length():
    rnd = random.Random(7)
    names = ["cut", "cut", "dissolve", "fade_black", "whip_pan", "zoom_punch"]
    for _ in range(300):
        n = rnd.randint(1, 7)
        s, clips = 0.0, []
        for i in range(n):
            d = rnd.choice([0.1, 0.4, 1.0, 2.5, 4.0])
            clips.append(clip(s, s + d, trim=rnd.choice([0, 0.3, 2.0]), speed=rnd.choice([0.5, 1, 1, 2]), transition=rnd.choice(names), td=rnd.choice([0.25, 0.5, 1.0, 2.0])))
            s += d
        for policy in ("shorten", "hold", "hold_incoming"):
            plan = tp.plan_timeline(clips, XF, {"a.mp4": rnd.choice([3.0, 12.0])}, policy=policy)
            assert timeline_len(plan) == plan.total_f - plan.origin_f
            for c in plan.clips:
                assert c.n >= 1 and c.pre >= 0 and c.post >= 0 and c.fade_in + c.fade_out <= c.n
            for jn in plan.joins:
                assert jn.kind != "blend" or jn.window >= tp.MIN_BLEND_FRAMES


def test_graph_joins_cuts_without_overlap_and_blends_at_the_planned_offset():
    clips = [clip(0, 3, trim=2), clip(3, 6, trim=2, transition="dissolve", td=1.0), clip(6, 9, trim=2)]
    plan = tp.plan_timeline(clips, XF, {"a.mp4": 12.0})
    g, v, a = ffmpeg_svc.build_join_graph(plan)
    assert g.count("concat=n=2:v=1:a=1") == 1 and g.count("xfade") == 1 and g.count("acrossfade") == 1         # join 0 is a cut (concat), join 1 the blend
    clips[0]["transition"], clips[1]["transition"] = "dissolve", "cut"
    plan = tp.plan_timeline(clips, XF, {"a.mp4": 12.0})
    g, _v, _a = ffmpeg_svc.build_join_graph(plan)
    assert f"xfade=transition=dissolve:duration=0.500000:offset={(90 - plan.joins[0].pre) / F:.6f}" in g and g.count("acrossfade") == 1


def test_graph_forces_every_segment_to_its_planned_length():
    plan = tp.plan_timeline([clip(0, 3, trim=2, transition="fade_black", td=0.5), clip(3, 6, trim=2)], XF, {"a.mp4": 12.0})
    g, _v, _a = ffmpeg_svc.build_join_graph(plan)
    assert "trim=end_frame=90" in g and "atrim=end=3.000000" in g and "fade=t=out:start_frame=83:nb_frames=7" in g and "fade=t=in:start_frame=0:nb_frames=8" in g
