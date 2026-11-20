-- Carousel Creator design library: ONE new table. Additive and idempotent.
--
-- The application creates this table itself at startup (SQLAlchemy create_all only ever creates MISSING tables); applying this file by hand is only needed for a manual / pre-checked rollout.
-- It matches app/models/library_item.py exactly (a test compares them). No existing table is touched; the only reference is a foreign key to users(id) with ON DELETE CASCADE.
-- Rollback: DROP TABLE library_items; (nothing depends on it).

CREATE TABLE IF NOT EXISTS library_items (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(120) NOT NULL,
    kind        VARCHAR(16)  NOT NULL,
    item_json   JSON         NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_library_item_user_updated ON library_items (user_id, updated_at);
