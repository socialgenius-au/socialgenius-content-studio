import base64
import io

from PIL import Image

from app.services.technical_intelligence import link_findings, picture_metrics


def test_picture_metrics_measure_sample_pixels():
    with io.BytesIO() as buffer:
        Image.new("RGB", (8, 8), (255, 0, 0)).save(buffer, "PNG")
        result = picture_metrics({"data": base64.b64encode(buffer.getvalue())})
    assert result == {
        "sample_luma_0_255": 76.0, "sample_luma_stddev": 0.0,
        "sample_saturation_percent": 100.0, "sample_palette": ["#ff0000"],
    }


def test_findings_require_same_shot_and_appropriate_evidence():
    frame = {"id": "frame-2", "kind": "frame", "shot": 1, "start": 1.5, "end": 1.5}
    motion = {"id": "motion-1", "kind": "motion", "shot": 1, "start": 1.0, "end": 2.0}
    finding = {"shot": 1, "summary": "Candidate", "confidence": "low", "evidence_ids": ["frame-2"]}
    linked = link_findings([
        {**finding, "topic": "Lighting"}, {**finding, "topic": "Camera movement"},
        {**finding, "topic": "Visible objects", "shot": 2},
        {**finding, "topic": "Colour", "evidence_ids": ["unknown"]},
        {**finding, "topic": "Camera movement", "evidence_ids": ["motion-1"]},
    ], [frame, motion])
    assert set(linked[1]) == {"Lighting", "Camera movement"}
    assert linked[1]["Lighting"]["evidence"] == [frame]
    assert linked[1]["Camera movement"]["evidence"] == [motion]
    assert 2 not in linked


def test_audio_windows_keep_overlapping_speech_and_music_separate():
    from app.services.technical_audio import collect_events

    events = collect_events([(0, [("Music", .8), ("Speech", .6), ("Rain", .1)]),
                             (.48, [("Music", .7), ("Rain", .8)])], 1.2)
    assert [(item["kind"], item["start"], item["end"]) for item in events] == [
        ("speech", 0, .975), ("music", 0, 1.2), ("ambience", .48, 1.2),
    ]
    assert events[1]["confidence"] == "high"


def test_scene_summary_drops_visual_readings_outside_boundary():
    from app.services.technical_intelligence import summarize_scenes

    scenes = [{"number": 1, "start": 0, "end": 2, "shots": [1]}]
    shots = [{"number": 1, "findings": [
        {"topic": "Colour", "evidence": [{"start": 1, "end": 1}]},
        {"topic": "Lighting", "evidence": [{"start": 2, "end": 2}]},
    ]}]
    audio = [{"label": "Rain", "start": .6, "end": 2.2}, {"label": "Speech", "start": 2, "end": 3}]
    summary, = summarize_scenes(scenes, shots, audio)
    assert "Colour" in summary["summary"] and "Lighting" not in summary["summary"]
    assert summary["audio"] == audio[:1]
