"""Dependency-manifest guard: SQLAlchemy >= 2.1 no longer installs greenlet by default, and app/database.py imports sqlalchemy.ext.asyncio."""
import re
from pathlib import Path

REQUIREMENTS = Path(__file__).resolve().parents[1] / "requirements.txt"


def test_sqlalchemy_is_requested_with_the_asyncio_extra():
    lines = [l.strip() for l in REQUIREMENTS.read_text(encoding="utf-8").splitlines() if l.strip() and not l.lstrip().startswith("#")]
    sqlalchemy = [l for l in lines if re.match(r"(?i)sqlalchemy\b", l)]
    assert len(sqlalchemy) == 1
    assert re.match(r"(?i)sqlalchemy\[[^\]]*\basyncio\b[^\]]*\]", sqlalchemy[0]), sqlalchemy[0]


def test_greenlet_is_importable_in_this_environment():
    import greenlet  # noqa: F401
    import sqlalchemy.ext.asyncio  # noqa: F401
