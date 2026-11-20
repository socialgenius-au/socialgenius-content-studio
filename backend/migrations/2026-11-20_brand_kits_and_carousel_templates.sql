-- Carousel Creator: Brand Kits and reusable carousel templates. TWO new tables. Additive and idempotent.
--
-- The application creates these tables itself at startup (SQLAlchemy create_all only ever creates MISSING tables; it never alters, drops or rewrites an existing one), so applying this file by
-- hand is only needed for a manual / pre-checked rollout. It matches app/models/brand_kit.py and app/models/carousel_template.py exactly (a test compares them).
--
-- Compatibility with existing data: no existing table is touched (the older `brands` table is left exactly as it is). The only references are foreign keys to users(id) with ON DELETE CASCADE
-- (a deleted user's kits and templates go with them, like their carousels). Nothing is backfilled. Rollback: DROP TABLE carousel_templates; DROP TABLE brand_kits; (nothing depends on them).

CREATE TABLE IF NOT EXISTS brand_kits (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(120) NOT NULL,
    kit_json    JSON         NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_brand_kit_user_updated ON brand_kits (user_id, updated_at);

CREATE TABLE IF NOT EXISTS carousel_templates (
    id             SERIAL PRIMARY KEY,
    user_id        INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           VARCHAR(120) NOT NULL,
    description    VARCHAR(500) NOT NULL,
    kind           VARCHAR(16)  NOT NULL,
    slide_count    INTEGER      NOT NULL,
    platform_key   VARCHAR(64)  NOT NULL,
    format_key     VARCHAR(64)  NOT NULL,
    brand_kit_id   INTEGER,
    template_json  JSON         NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_carousel_template_user_updated ON carousel_templates (user_id, updated_at);
