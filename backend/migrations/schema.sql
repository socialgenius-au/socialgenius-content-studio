-- SocialGenius Content Studio — reference schema
-- Tables are auto-created by SQLAlchemy on startup; this file is for reference / manual migrations.

CREATE TABLE IF NOT EXISTS users (
    id               SERIAL PRIMARY KEY,
    username         VARCHAR(64)  UNIQUE NOT NULL,
    email            VARCHAR(255) UNIQUE NOT NULL,
    hashed_password  VARCHAR(255) NOT NULL,
    role             VARCHAR(32)  NOT NULL DEFAULT 'editor',
    is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brands (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    colors          JSONB        NOT NULL DEFAULT '{}',
    fonts           JSONB        NOT NULL DEFAULT '{}',
    logo_url        VARCHAR(512),
    tone_of_voice   VARCHAR(1024),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    brand_id    INTEGER      REFERENCES brands(id) ON DELETE SET NULL,
    title       VARCHAR(512) NOT NULL,
    prompt      TEXT         NOT NULL,
    plan_json   JSONB,
    status      VARCHAR(32)  NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assets (
    id                 SERIAL PRIMARY KEY,
    job_id             INTEGER       REFERENCES jobs(id) ON DELETE SET NULL,
    user_id            INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_filename  VARCHAR(512)  NOT NULL,
    stored_filename    VARCHAR(512)  NOT NULL,
    file_path          VARCHAR(1024) NOT NULL,
    file_type          VARCHAR(64)   NOT NULL,
    mime_type          VARCHAR(128)  NOT NULL,
    file_size          BIGINT        NOT NULL,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
