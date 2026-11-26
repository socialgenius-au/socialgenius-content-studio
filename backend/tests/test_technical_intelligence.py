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
