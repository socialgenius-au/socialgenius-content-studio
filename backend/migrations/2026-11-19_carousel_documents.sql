-- Carousel Creator server persistence: ONE new table. Additive and idempotent.
--
-- The application creates this table itself at startup (SQLAlchemy create_all only ever creates MISSING tables; it never alters, drops or rewrites an existing one), so applying this
-- file by hand is only needed for a manual / pre-checked rollout. It matches app/models/carousel_document.py exactly (a test compares the two).
--
-- Compatibility with existing data: no existing table is touched. The only reference is a foreign key to users(id) with ON DELETE CASCADE (a deleted user's carousels go with them,
-- like their drafts). Nothing is backfilled. Rollback: DROP TABLE carousel_documents (it holds nothing any other table depends on).

CREATE TABLE IF NOT EXISTS carousel_documents (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_id              VARCHAR(64)  NOT NULL,
    title               VARCHAR(255) NOT NULL,
    slide_count         INTEGER      NOT NULL,
    platform_key        VARCHAR(64)  NOT NULL,
    format_key          VARCHAR(64)  NOT NULL,
    theme_id            VARCHAR(32)  NOT NULL,
    active_slide_id     VARCHAR(64),
    blueprint_id        VARCHAR(64),
    reference_video_id  INTEGER,
    origin              VARCHAR(24)  NOT NULL,
    version             INTEGER      NOT NULL,
    document_json       JSON         NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_carousel_user_doc UNIQUE (user_id, doc_id)
);

CREATE INDEX IF NOT EXISTS ix_carousel_user_updated ON carousel_documents (user_id, updated_at);
