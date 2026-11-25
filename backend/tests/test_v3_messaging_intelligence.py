from app.services.messaging_intelligence import MessagingReport, validated_report


def test_report_links_observed_evidence_and_rejects_invented_or_off_scene_support():
    speech = dict(id="speech-1", kind="speech", start=1, end=2, text="Machine reading")
    scene = dict(id="scene-1", kind="scene", start=0, end=3, text="Section 1")
    frame = dict(id="frame-1", kind="frame", start=4, end=4, text="Sampled frame")
    reading = dict(summary="Convenience claim", confidence="medium", evidence_ids=["speech-1"])
    result = validated_report(MessagingReport.model_validate({
        "findings": [
            {**reading, "topic": "Core message"},
            {**reading, "topic": "Call to action", "evidence_ids": ["missing"]},
            {**reading, "topic": "Target audience", "evidence_ids": ["scene-1"]},
        ],
        "scenes": [
            {**reading, "scene_id": "scene-1", "evidence_ids": ["frame-1"]},
            {**reading, "scene_id": "scene-1"},
        ],
        "translations": [
            {"speech_id": "frame-1", "english": "Invalid", "confidence": "low"},
            {"speech_id": "speech-1", "english": "Saved translation", "confidence": "medium"},
        ],
    }), [speech, scene, frame])
    assert list(result["findings"]) == ["Core message"]
    assert result["findings"]["Core message"]["evidence"] == [speech]
    assert result["scenes"][0]["evidence"] == [speech]
    assert result["translations"][0]["source"] == speech
    assert len(result["translations"]) == 1
