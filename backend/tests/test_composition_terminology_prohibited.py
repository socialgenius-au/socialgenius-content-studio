"""Video Deconstructor — Stage 8 Composition MVP: response-terminology guard test.

Ensures the new Composition MVP files never introduce prohibited semantic terminology as an
actual IDENTIFIER (a schema field name, a class name, or a Python identifier/dict-key literal in
the new service/router source) — the real regression risk this test exists to catch is a field
like `dominant_subject: bool` or a variable `hero_product_id` sneaking into the response, not the
word appearing inside a comment/docstring that EXPLAINS why it must not be used (this codebase's
own established convention — see e.g. VisualObjectSummary's own docstring already saying "never a
guessed product/prop/logo/background role" — such prose must never fail this check).

Method: strip every comment (`#...`) and every triple-quoted string (docstrings) from each
target file's source, then check the remainder for the prohibited terms as identifier-boundary
substrings. Anything surviving that strip is real code — a class/field/variable/dict-key — never
documentation prose.
"""
import re
from pathlib import Path

PROHIBITED_TERMS = [
    "dominant_subject", "primary_subject", "hero_product", "focal_point",
    "speaker", "customer", "foreground", "background",
]

TARGET_FILES = [
    "app/services/visual_geometry_svc.py",
    "app/services/visual_composition_svc.py",
]

# background/foreground genuinely DO appear as legitimate, unrelated English words in existing
# unrelated historical code elsewhere in this repo (e.g. VisualObject's own pre-existing
# 'background' category value, a real Stage-1 concept meaning something else entirely) — per this
# test's own instruction ("existing unrelated historical fields elsewhere are not part of this
# check"), only the NEW Composition files are scanned, not the whole repository.


def _strip_comments_and_docstrings(source: str) -> str:
    # Remove triple-quoted strings (docstrings) — both ''' and """ variants, non-greedy.
    no_docstrings = re.sub(r'"""[\s\S]*?"""', "", source)
    no_docstrings = re.sub(r"'''[\s\S]*?'''", "", no_docstrings)
    # Remove line comments.
    no_comments = re.sub(r"#.*", "", no_docstrings)
    return no_comments


def test_no_prohibited_terminology_as_identifiers_in_new_composition_files():
    repo_root = Path(__file__).resolve().parents[1]
    violations = []
    for rel_path in TARGET_FILES:
        path = repo_root / rel_path
        source = path.read_text(encoding="utf-8")
        code_only = _strip_comments_and_docstrings(source)
        for term in PROHIBITED_TERMS:
            if re.search(rf"\b{re.escape(term)}\b", code_only):
                violations.append(f"{rel_path}: prohibited term '{term}' found in actual code (outside comments/docstrings)")
    assert violations == [], "\n".join(violations)


def test_new_schema_field_names_exclude_prohibited_terms():
    """Direct check against the actual Pydantic field name sets — the response contract itself,
    not just the source text — for every new Composition schema class."""
    from app.schemas.reference_video import (
        PersistentLayoutStabilitySummary, SameFrameLayoutPairSummary, VisualObjectLayoutSummary,
    )
    for model in (VisualObjectLayoutSummary, SameFrameLayoutPairSummary, PersistentLayoutStabilitySummary):
        field_names = set(model.model_fields.keys())
        for term in PROHIBITED_TERMS:
            assert term not in field_names, f"{model.__name__} has prohibited field name '{term}'"


def test_visual_object_summary_new_fields_exclude_prohibited_terms():
    from app.schemas.reference_video import VisualObjectSummary
    new_fields = {"layout", "is_largest_detected_region_in_source_frame"}
    assert new_fields.issubset(set(VisualObjectSummary.model_fields.keys()))
    for term in PROHIBITED_TERMS:
        assert term not in VisualObjectSummary.model_fields.keys()


def test_largest_region_terminology_is_neutral():
    """17: 'largest_detected_region' semantics only -- never 'dominant'/'primary'/'focal'/'hero'."""
    from app.schemas.reference_video import VisualObjectSummary
    field_name = "is_largest_detected_region_in_source_frame"
    assert field_name in VisualObjectSummary.model_fields
    for banned in ("dominant", "primary", "focal", "hero"):
        assert banned not in field_name
