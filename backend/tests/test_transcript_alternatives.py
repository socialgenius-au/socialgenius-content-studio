"""Alternative transcripts (M6 item 3): non-destructive, provenance-carrying, never a verified quotation. No database and no engine needed: the pure logic plus the way the anatomy and the mechanism input carry it."""
from types import SimpleNamespace

import pytest

from app.schemas.content_anatomy import ContentAnatomyResponse
from app.services.content_anatomy_svc import build_content_anatomy
from app.services.creative_reconcile import speech_reliability
from app.services.mechanism_reasoner.anatomy_input import build_reasoner_input, source_texts, valid_evidence_ids
from app.services.mechanism_reasoner.providers.anthropic_provider import SYSTEM_PROMPT
from app.services.transcript_alt_svc import STATUS, agreement, build_alternatives_view, choose_preferred, describe_quality, mean_logprob
from tests.test_creative_integration import creative_5131, ref_5131, sec

BASE_DIAG = {"avg_logprob": -0.6835, "no_speech_prob": 0.05, "compression_ratio": 1.01}
SMALL_DIAG = {"avg_logprob": -0.2677, "no_speech_prob": 0.19, "compression_ratio": 1.5}


def original():
    return [{"id": 721, "start_time": 0.0, "end_time": 4.0, "text": "100% шود, bina-pani, bina-kemi-kul", "model": "base", "analysis_details": BASE_DIAG},
            {"id": 722, "start_time": 6.0, "end_time": 10.0, "text": "100% мowne-bana-ya-baraka-se-sa-jaya", "model": "base", "analysis_details": BASE_DIAG}]


def row(i, s, e, text, model="small", lang=None, diag=SMALL_DIAG):
    return SimpleNamespace(id=i, start_time=s, end_time=e, reasoning=text, created_at=None,
                           details={"run_id": f"{model}|{lang or 'auto'}", "model": model, "language_hint": lang, "detected_language": "hi", "analysis_details": diag})


def small_rows():
    return [row(9001, 0.0, 4.0, "शुद, बिना पानी, बिना केमिकल"), row(9002, 6.0, 10.0, "माओने बनाया, बरकासे सजाया")]


def view():
    return build_alternatives_view(original(), small_rows())


# ── pure logic ──
def test_the_garbled_original_is_described_as_implausible_and_the_small_reading_as_plausible():
    o = describe_quality(original())
    assert not o["plausible"] and any("log-probability" in r for r in o["reasons"]) and any("mixes" in r for r in o["reasons"])
    s = describe_quality([{"text": "शुद, बिना पानी", "analysis_details": SMALL_DIAG}])
    assert s["plausible"] and s["scripts"] == ["devanagari"] and mean_logprob([{"analysis_details": SMALL_DIAG}]) == -0.2677


def test_agreement_is_reported_only_between_readings_in_the_same_script():
    cross = agreement("100% شود, bina-pani", "शुद, बिना पानी")
    assert cross["value"] is None and cross["comparable"] is False and "different scripts" in cross["reason"]
    same = agreement("बिना पानी बिना केमिकल", "बिना पानी बिना कैमिकल")
    assert same["comparable"] and 0.8 < same["value"] < 1.0
    assert agreement("", "abc")["comparable"] is False


def test_the_view_keeps_the_original_and_labels_every_alternative_unverified_and_not_quotable():
    v = view()
    assert v["original"]["segment_ids"] == [721, 722] and v["original"]["status"] == STATUS and v["original"]["quotable"] is False
    (alt,) = v["alternatives"]
    assert alt["status"] == STATUS and alt["quotable"] is False and alt["engine"] == "whisper (local)" and alt["model"] == "small"
    assert alt["corrects_segment_ids"] == [721, 722]
    assert alt["agreement_with_original"]["comparable"] is False
    assert v["preferred_run_id"] == "small|auto" and "not a verified quotation" in v["policy"]


def test_a_better_confidence_alone_never_makes_a_reading_verified():
    v = view()
    assert v["alternatives"][0]["status"] == "machine_transcript_unverified"
    assert "verified" not in v["alternatives"][0]["status"].replace("unverified", "")


def test_an_alternative_that_is_not_clearly_better_is_not_preferred():
    worse = [row(1, 0.0, 4.0, "बिना पानी", diag={"avg_logprob": -0.9})]
    assert build_alternatives_view(original(), worse)["preferred_run_id"] is None
    same = [row(1, 0.0, 4.0, "bina pani", diag={"avg_logprob": -0.62})]
    assert build_alternatives_view(original(), same)["preferred_run_id"] is None                       # gain 0.06 < 0.15 and the original is not better formed than it
    good_original = [{"id": 1, "start_time": 0.0, "end_time": 4.0, "text": "बिना पानी", "analysis_details": {"avg_logprob": -0.2}}]
    malformed = [row(1, 0.0, 4.0, "बिना پانی", diag={"avg_logprob": -0.05})]
    assert build_alternatives_view(good_original, malformed)["preferred_run_id"] is None              # never swap a well-formed reading for a malformed one


def test_two_runs_are_kept_side_by_side_and_the_best_is_preferred():
    rows = small_rows() + [row(9101, 0.0, 4.0, "शुद बिना पानी", model="small", lang="hi", diag={"avg_logprob": -0.2}), row(9102, 6.0, 10.0, "माओने बनाया", model="small", lang="hi", diag={"avg_logprob": -0.2})]
    v = build_alternatives_view(original(), rows)
    assert {a["run_id"] for a in v["alternatives"]} == {"small|auto", "small|hi"} and v["preferred_run_id"] == "small|hi"


def test_speech_reliability_uses_the_engines_own_log_probability():
    q = speech_reliability({"id": 1, "text": "bina pani", "confidence_score": 0.9, "analysis_details": {"avg_logprob": -0.9}})
    assert not q["reliable"] and any("log-probability" in r for r in q["reasons"])
    assert speech_reliability({"id": 1, "text": "bina pani", "confidence_score": 0.9, "analysis_details": {"avg_logprob": -0.2}})["reliable"]


# ── anatomy and mechanism input ──
def anat(with_alt=True, with_creative=True):
    return build_content_anatomy(ref_5131(), creative_5131() if with_creative else None, view() if with_alt else None)


def test_without_an_alternative_the_anatomy_is_unchanged():
    assert build_content_anatomy(ref_5131(), creative_5131(), None) == build_content_anatomy(ref_5131(), creative_5131())
    assert "transcript" not in anat(False)["video"] and all("speech_reading" not in s for s in anat(False)["sections"])


def test_the_alternative_is_attached_beside_the_original_and_changes_the_pin():
    a, b = anat(False), anat(True)
    assert b["video"]["transcript"]["original"]["segment_ids"] == [721, 722]
    assert b["provenance"]["fingerprint"] != a["provenance"]["fingerprint"]
    s1 = sec(b, 1)
    assert s1["speech_reading"]["text"].startswith("शुद") and s1["speech_reading"]["quotable"] is False and s1["speech_reading"]["model"] == "small"
    assert [x["id"] for x in s1["speech"]] == [721] and "शुद" not in s1["speech"][0]["text"]            # the original speech is untouched
    ContentAnatomyResponse.model_validate(b)                                                            # the API response model keeps the new fields
    assert ContentAnatomyResponse.model_validate(b).video.transcript["preferred_run_id"] == "small|auto"


def test_the_reading_is_understanding_only_it_cannot_be_cited_and_it_is_source_wording():
    b = anat(True)
    ids = valid_evidence_ids(b)
    assert "9001" not in str(ids) and "9002" not in str(ids)                                                # no alternative-segment id is citable
    assert any("शुद" in t for t in source_texts(b))                                                     # a principle may not reproduce it
    ri = build_reasoner_input(b)
    r1 = next(s for s in ri["sections"] if s["n"] == 1)
    assert r1["speech_reading"] == {"text": "शुद, बिना पानी, बिना केमिकल", "model": "small", "unverified": True}
    assert "transcript_note" in ri and "never a quotation" in ri["transcript_note"]["policy"]
    assert "speech_reading" in SYSTEM_PROMPT and "never a quotation" in SYSTEM_PROMPT and "can never be cited" in SYSTEM_PROMPT


def test_the_reading_works_without_a_creative_read_too():
    b = anat(True, False)
    ri = build_reasoner_input(b)
    assert "transcript_note" in ri and "creative_read" not in ri
    assert next(s for s in ri["sections"] if s["n"] == 1)["speech_reading"]["unverified"] is True
