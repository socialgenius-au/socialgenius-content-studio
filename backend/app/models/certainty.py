"""Video Deconstructor — the shared certainty classification every analytical claim in the
video-analysis schema (Scene, Shot, TextElement, VisualObject, AnalysisAnnotation,
StrategicInsight) must carry. Defined once, here, and imported everywhere it's used, so the
Python-side enum and the database-side CHECK constraint (CERTAINTY_CHECK_SQL, built from the
same CERTAINTY_VALUES list) can never drift apart.

No SQLAlchemy/Postgres native ENUM type is used here on purpose: a real Postgres ENUM adding a
new value later needs its own ALTER TYPE migration, which is exactly the friction this project's
design review decided to keep OUT of the two open-ended `category` columns (AnalysisAnnotation/
StrategicInsight) — for consistency, and because this project has no existing precedent for
native Postgres enums anywhere in its models, this five-value set is enforced the same simple
way: a plain String column plus a CHECK constraint. Certainty's own five values are a closed,
deliberately-fixed set (unlike `category`), so this isn't a flexibility concession — the CHECK
constraint achieves the same "reject invalid values" guarantee a native enum would.
"""
from enum import Enum


class Certainty(str, Enum):
    OBSERVED = "OBSERVED"
    MEASURED = "MEASURED"
    INFERRED = "INFERRED"
    RESEARCH_SUPPORTED = "RESEARCH_SUPPORTED"
    RECOMMENDED = "RECOMMENDED"


CERTAINTY_VALUES: list[str] = [c.value for c in Certainty]

# Reused verbatim in every model's CheckConstraint — see e.g. app/models/scene.py.
CERTAINTY_CHECK_SQL: str = "certainty IN (" + ", ".join(f"'{v}'" for v in CERTAINTY_VALUES) + ")"

# Shared by every table that has a nullable 0-1 confidence_score — confidence is never NOT NULL
# (Stage 1's own rule: never require it for a deterministic/exact value that has no semantic
# confidence at all, e.g. a shot's own measured start/end time), but whenever it IS present, it
# must be a valid probability-like value.
CONFIDENCE_RANGE_CHECK_SQL: str = "confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 1)"
