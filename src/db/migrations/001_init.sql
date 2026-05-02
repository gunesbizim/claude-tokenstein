CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY,
    session_id      VARCHAR NOT NULL,
    project_cwd     VARCHAR NOT NULL,
    git_branch      VARCHAR,
    ts              TIMESTAMP NOT NULL,
    model           VARCHAR NOT NULL,
    service_tier    VARCHAR,
    request_id      VARCHAR,
    claude_version  VARCHAR,
    source          VARCHAR NOT NULL,
    input_tokens                BIGINT NOT NULL,
    output_tokens               BIGINT NOT NULL,
    cache_creation_input_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_input_tokens     BIGINT NOT NULL DEFAULT 0,
    cache_eph_1h_tokens         BIGINT NOT NULL DEFAULT 0,
    cache_eph_5m_tokens         BIGINT NOT NULL DEFAULT 0,
    web_search_requests         BIGINT NOT NULL DEFAULT 0,
    web_fetch_requests          BIGINT NOT NULL DEFAULT 0,
    user_prompt_id              UUID,
    response_text_id            UUID
);

CREATE TABLE IF NOT EXISTS prompts (
    id          UUID PRIMARY KEY,
    role        VARCHAR NOT NULL,
    text        VARCHAR NOT NULL,
    char_count  BIGINT  NOT NULL
);

CREATE TABLE IF NOT EXISTS ingest_state (
    source              VARCHAR PRIMARY KEY,
    last_ingested_ts    TIMESTAMP,
    last_run_ts         TIMESTAMP,
    cursor              VARCHAR
);

CREATE TABLE IF NOT EXISTS files_seen (
    path        VARCHAR PRIMARY KEY,
    mtime       TIMESTAMP,
    size_bytes  BIGINT,
    line_count  BIGINT,
    sha256      VARCHAR
);

CREATE TABLE IF NOT EXISTS prices (
    model               VARCHAR,
    effective_from      DATE,
    input_per_mtok_usd  DOUBLE,
    output_per_mtok_usd DOUBLE,
    cache_write_per_mtok_usd DOUBLE,
    cache_read_per_mtok_usd  DOUBLE,
    PRIMARY KEY (model, effective_from)
);

CREATE TABLE IF NOT EXISTS fx_rates (
    date     DATE PRIMARY KEY,
    usd_eur  DOUBLE NOT NULL,
    fetched_at TIMESTAMP NOT NULL,
    source   VARCHAR NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_msgs_ts      ON messages(ts);
CREATE INDEX IF NOT EXISTS idx_msgs_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_msgs_project ON messages(project_cwd);
CREATE INDEX IF NOT EXISTS idx_msgs_model   ON messages(model);
