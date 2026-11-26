from app.services.discoverability_intelligence import evidence_fingerprint, link_entries


def test_research_requires_same_dimension_and_existing_hashtags_require_verbatim_evidence():
    sources = [
        {"id": "ocr-1", "kind": "ocr", "text": "Find #RealBrand here"},
        {"id": "seo-1", "kind": "web research", "dimension": "SEO", "text": "A relevant result",
         "citations": [{"url": "https://example.org/page", "title": "Page"}]},
    ]
    base = {"detail": "Useful description", "confidence": "medium", "scope": "reference"}
    report = link_entries([
        {**base, "section": "Hashtags", "group": "Existing", "label": "#RealBrand", "evidence_ids": ["ocr-1"]},
        {**base, "section": "Hashtags", "group": "Existing", "label": "#Invented", "evidence_ids": ["ocr-1"]},
        {**base, "section": "Keywords", "group": "Primary", "label": "123", "evidence_ids": ["ocr-1"]},
        {**base, "section": "SEO", "group": "Intent", "label": "Find the product", "evidence_ids": ["seo-1"]},
        {**base, "section": "GEO", "group": "Entities", "label": "Wrong dimension", "evidence_ids": ["seo-1"]},
    ], sources)
    assert set(report) == {"Hashtags", "SEO"}
    assert [entry["label"] for entry in report["Hashtags"]] == ["#RealBrand"]
    assert report["SEO"][0]["evidence"][0]["citations"] == sources[1]["citations"]
    assert evidence_fingerprint(sources, "Sydney") != evidence_fingerprint(sources, "Bengaluru")


def test_summary_fallback_preserves_original_evidence_and_scope():
    from app.services.discoverability_intelligence import with_executive_summary

    entry = {"group": "Title", "label": "Suggested title", "scope": "recommendation",
             "evidence": [{"id": "speech-1"}]}
    source = {"Recommendations": [entry]}
    assert with_executive_summary(source)["Summary"] == [{**entry, "group": "Recommendations"}]
    assert "Summary" not in source
