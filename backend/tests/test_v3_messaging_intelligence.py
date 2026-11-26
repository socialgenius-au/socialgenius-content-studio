from app.services.messaging_intelligence import MessagingReport, parse_report, validated_report


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



def test_parse_report_preserves_valid_siblings_of_a_malformed_finding():
    report = parse_report({"findings": [
        {"topic": "Core message", "summary": "Valid", "evidence_ids": ["speech-1"], "confidence": "high"},
        {"topic": "Solution", "summary": "Invalid", "evidence_ids": [], "confidence": "certain"},
    ]})
    assert [item.topic for item in report.findings] == ["Core message"]


def test_dedicated_strategy_slots_and_scene_details_keep_original_timestamps():
    speech = dict(id="speech-1", kind="speech", start=1, end=2, text="Original transcription")
    scene = dict(id="scene-1", kind="scene", start=0.25, end=2.5, text="Section 1")
    support = dict(summary="A supported conclusion", confidence="medium", evidence_ids=["speech-1"])
    report = parse_report({
        "business_objective": support,
        "strategy_and_positioning": {**support, "evidence_ids": ["fabricated"]},
        "scenes": [{**support, "scene_id": "scene-1", "messaging": "Convenience",
                    "emotional_trigger": "Relief", "narrative_contribution": "Resolves the problem"}],
        "translations": [{"speech_id": "speech-1", "english": "Ready today", "confidence": "medium",
                          "refined_reading": "Aaj ready"}],
    })
    result = validated_report(report, [speech, scene])
    assert list(result["findings"]) == ["Business objective"]
    assert result["scenes"][0]["scene"] == scene
    assert result["scenes"][0]["narrative_contribution"] == "Resolves the problem"
    assert result["translations"][0]["source"] == speech
    assert result["translations"][0]["refined_reading"] == "Aaj ready"
