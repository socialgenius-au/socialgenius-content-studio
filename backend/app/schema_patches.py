"""Additive schema patches — column/index-level changes create_all() cannot apply to an
EXISTING table (create_all only ever CREATES missing tables, never ALTERs one — see this
module's own sibling comment in app/main.py's lifespan, right where this is called from). Every
table-creation-level change is already handled correctly and automatically by create_all; this
file exists ONLY for the narrower class of change: a column added to a table that already
existed before that column was added to the model.

Every statement here is written to be safely re-runnable on every single startup, on any
database, in any state — brand new, partially patched, or fully patched — doing nothing where a
patch has already applied (`ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`).
Deliberately NOT a general migration framework (no Alembic, no version table, no dependency) —
this project's own established additive-only, no-migration-chain philosophy stays intact; this
is the smallest mechanism that turns "run this SQL by hand and remember to do it on every
database" into "happens automatically, exactly once in effect, forever."

Real incident this exists to prevent recurring: Stage 6 (OCR / On-Screen Text) added four
columns to the ALREADY-EXISTING `text_elements` table (present, empty, since Stage 1). They were
applied by hand to the local dev database during implementation but never to Railway's staging
database — create_all's own "table already exists, nothing to do" behaviour then silently
skipped them on every Railway deploy, breaking every reference-video endpoint with
`asyncpg.exceptions.UndefinedColumnError` the moment a real request touched `text_elements`.

Scope note: this currently covers Stage 6's own four `text_elements` columns, plus (added for
Stage 8 Phase B) `visual_objects`'s two new columns and its updated category CHECK constraint.
Stage 3's and Stage 4's own historical column additions (`reference_videos.technical_details`,
`shots.scene_id`/`video_analysis_id`) were also applied by hand at the time and carry the same
class of risk on a database that was never manually patched — deliberately left out of this list
for now, to review and add separately rather than widen this specific change's blast radius.
"""
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

# Stage 6 (OCR / On-Screen Text) — see app/models/text_element.py's own docstring for what each
# of these four columns means and why. All four are nullable, no default, no CHECK constraint —
# every statement here is a pure column/index addition, nothing here relaxes or removes anything.
_ADDITIVE_PATCHES: list[str] = [
    "ALTER TABLE text_elements ADD COLUMN IF NOT EXISTS source_frame_asset_id INTEGER REFERENCES assets(id) ON DELETE RESTRICT",
    "ALTER TABLE text_elements ADD COLUMN IF NOT EXISTS category VARCHAR(48)",
    "ALTER TABLE text_elements ADD COLUMN IF NOT EXISTS style_details JSON",
    "ALTER TABLE text_elements ADD COLUMN IF NOT EXISTS occurrence_group_id INTEGER REFERENCES text_elements(id) ON DELETE SET NULL",
    "CREATE INDEX IF NOT EXISTS ix_text_elements_source_frame_asset_id ON text_elements (source_frame_asset_id)",
    "CREATE INDEX IF NOT EXISTS ix_text_elements_occurrence_group_id ON text_elements (occurrence_group_id)",
    # Stage 8 (Visual Objects), Phase B — see app/models/visual_object.py's own docstring for
    # what each of these means and why. `visual_objects` has existed, empty, since Stage 1 — the
    # exact same "ADD COLUMN IF NOT EXISTS" gap this file exists to close, on the exact same
    # table-already-existed-before-the-column-did class of change as Stage 6's own patches above.
    "ALTER TABLE visual_objects ADD COLUMN IF NOT EXISTS class_id INTEGER",
    "ALTER TABLE visual_objects ADD COLUMN IF NOT EXISTS source_frame_id INTEGER REFERENCES shot_frames(id) ON DELETE RESTRICT",
    "CREATE INDEX IF NOT EXISTS ix_visual_objects_source_frame_id ON visual_objects (source_frame_id)",
    # The category CHECK constraint itself needs the new 'object' value added — Postgres has no
    # "ADD CONSTRAINT IF NOT EXISTS", so this drops (if present, from either an older run of this
    # exact patch or a fresh create_all-built table with the OLD five-value constraint) and
    # unconditionally re-adds it under the same name; running this on every startup is therefore
    # just as idempotent in EFFECT as every other statement here (drop-then-add always ends in
    # the same final constraint, never accumulates, never errors on a repeat run).
    "ALTER TABLE visual_objects DROP CONSTRAINT IF EXISTS ck_visual_objects_category_valid",
    "ALTER TABLE visual_objects ADD CONSTRAINT ck_visual_objects_category_valid "
    "CHECK (category IN ('person', 'product', 'logo', 'background', 'prop', 'object'))",
]


async def apply_additive_schema_patches(conn: AsyncConnection) -> None:
    """Called once per app startup, immediately after create_all, on the same connection/
    transaction — see app/main.py's own lifespan. Runs every patch in order; each is
    independently idempotent, so a partial-then-retried startup can never double-apply one or
    get stuck on one that already succeeded in an earlier run."""
    for statement in _ADDITIVE_PATCHES:
        await conn.execute(text(statement))
