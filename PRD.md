# PRD — claude-tokenstein

## 1. Goal

Track and report Claude token usage from local logs and the Anthropic Admin API. Distributed as a Claude Code plugin: slash commands for the human, SessionStart hook for incremental ingest, MCP server as the slash-command host.

## 2. Scope

**v1 sources**
- Claude Code transcripts: `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`
- Anthropic Admin API: `GET /v1/organizations/usage_report/messages` (requires `sk-ant-admin-…`)

**v1 non-goals**
- Claude Desktop (no token data on disk)
- Multi-machine sync
- Reset / wipe command
- Programmatic MCP query tools (slash commands only)

## 3. Architecture

```
claude-tokenstein/                    Claude Code plugin
├── plugin.json                       plugin manifest
├── .mcp.json                         MCP server registration
├── hooks/
│   └── session-start.sh              spawns detached ingest
├── commands/                         slash command markdowns
│   ├── tokenstein-report.md
│   ├── tokenstein-today.md
│   ├── tokenstein-session.md
│   ├── tokenstein-hourly.md
│   ├── tokenstein-top.md
│   ├── tokenstein-cost.md
│   └── tokenstein-ingest.md
├── src/
│   ├── cli.ts                        node CLI entry
│   ├── mcp/server.ts                 MCP server (slash command backend)
│   ├── ingest/
│   │   ├── claude-code.ts            JSONL parser
│   │   ├── admin-api.ts              Anthropic Admin API client
│   │   └── orchestrator.ts           lockfile, state, idempotent upsert
│   ├── db/
│   │   ├── duckdb.ts                 connection + migrations
│   │   └── schema.sql
│   ├── reports/                      one file per slash command
│   ├── pricing/
│   │   ├── prices.json               bundled defaults
│   │   ├── loader.ts                 merges user override
│   │   └── fx.ts                     USD/EUR via frankfurter.app
│   └── normalize/text.ts             whitespace normalization
└── package.json
```

**Runtime layout**
- DB: `~/.claude-tokenstein/tokens.duckdb`
- Config: `~/.claude-tokenstein/config.json` (mode 600 — contains admin key)
- Price override: `~/.claude-tokenstein/prices.json` (optional)
- Lock: `~/.claude-tokenstein/ingest.lock`
- Logs: `~/.claude-tokenstein/logs/ingest.log`

## 4. Data model (DuckDB)

```sql
-- One row per assistant turn
CREATE TABLE messages (
    id              UUID PRIMARY KEY,           -- hash(session_id, ts, request_id)
    session_id      VARCHAR NOT NULL,
    project_cwd     VARCHAR NOT NULL,
    git_branch      VARCHAR,
    ts              TIMESTAMP NOT NULL,
    model           VARCHAR NOT NULL,
    service_tier    VARCHAR,
    request_id      VARCHAR,
    claude_version  VARCHAR,
    source          VARCHAR NOT NULL,           -- 'claude_code' | 'admin_api'
    -- token fields
    input_tokens                BIGINT NOT NULL,
    output_tokens               BIGINT NOT NULL,
    cache_creation_input_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_input_tokens     BIGINT NOT NULL DEFAULT 0,
    cache_eph_1h_tokens         BIGINT NOT NULL DEFAULT 0,
    cache_eph_5m_tokens         BIGINT NOT NULL DEFAULT 0,
    web_search_requests         BIGINT NOT NULL DEFAULT 0,
    web_fetch_requests          BIGINT NOT NULL DEFAULT 0,
    -- content
    user_prompt_id              UUID,           -- FK to prompts table (preceding user turn)
    response_text_id            UUID            -- FK to prompts table (this assistant turn)
);

-- Dedup'd, normalized text bodies
CREATE TABLE prompts (
    id          UUID PRIMARY KEY,               -- hash(text)
    role        VARCHAR NOT NULL,               -- 'user' | 'assistant'
    text        VARCHAR NOT NULL,               -- normalized
    char_count  BIGINT  NOT NULL
);

CREATE TABLE ingest_state (
    source              VARCHAR PRIMARY KEY,    -- 'claude_code' | 'admin_api'
    last_ingested_ts    TIMESTAMP,
    last_run_ts         TIMESTAMP,
    cursor              VARCHAR                 -- file path / api page token
);

CREATE TABLE files_seen (
    path        VARCHAR PRIMARY KEY,
    mtime       TIMESTAMP,
    size_bytes  BIGINT,
    line_count  BIGINT,                          -- last ingested line offset
    sha256      VARCHAR
);

CREATE TABLE prices (                            -- snapshotted at ingest time
    model               VARCHAR,
    effective_from      DATE,
    input_per_mtok_usd  DOUBLE,
    output_per_mtok_usd DOUBLE,
    cache_write_per_mtok_usd DOUBLE,
    cache_read_per_mtok_usd  DOUBLE,
    PRIMARY KEY (model, effective_from)
);

CREATE TABLE fx_rates (
    date     DATE PRIMARY KEY,
    usd_eur  DOUBLE NOT NULL,
    fetched_at TIMESTAMP NOT NULL,
    source   VARCHAR NOT NULL                    -- 'frankfurter' | 'manual' | 'fallback'
);

CREATE INDEX idx_msgs_ts ON messages(ts);
CREATE INDEX idx_msgs_session ON messages(session_id);
CREATE INDEX idx_msgs_project ON messages(project_cwd);
CREATE INDEX idx_msgs_model ON messages(model);
```

**Idempotency**: `messages.id = sha256(session_id || iso_ts || request_id)`. Re-ingesting the same JSONL is a no-op via `INSERT OR IGNORE`.

**Resumability**: `files_seen.line_count` lets ingest skip already-processed lines in growing JSONL files.

## 5. Ingest

**Claude Code source**

1. Glob `~/.claude/projects/*/*.jsonl`.
2. For each file, look up `files_seen`. If `mtime` unchanged → skip. Else read from `line_count` onward.
3. Per line: parse JSON. If `type == 'assistant'` and `message.usage` exists → build a `messages` row. Look back to nearest preceding `type == 'user'` line for `user_prompt_id`.
4. Normalize prompt text (§ 7), upsert into `prompts` keyed by `sha256(text)`.
5. Update `files_seen` with new `line_count`, `mtime`, `size_bytes`.

**Admin API source**

1. Read `config.admin_api_key`. If missing → skip with log warning.
2. `last_ingested_ts` = `ingest_state.last_ingested_ts(source='admin_api') ?? now - 30d`.
3. Loop pages of `GET /v1/organizations/usage_report/messages?starting_at=…&bucket_width=1h&group_by=model,workspace_id` until exhausted or `ending_at = now - 5min` (account for API latency).
4. Each row → synthetic `messages` entry, `source='admin_api'`, `session_id=NULL`, `cwd=NULL`. Use a deterministic id `sha256('admin_api'||bucket_start||model||workspace_id)`.
5. Persist `last_ingested_ts`.

**Hook entrypoint** (`hooks/session-start.sh`)

```bash
#!/bin/sh
LOCK="$HOME/.claude-tokenstein/ingest.lock"
LOG="$HOME/.claude-tokenstein/logs/ingest.log"
mkdir -p "$(dirname "$LOG")"
# detached, fire-and-forget; lockfile prevents concurrent runs
( flock -n "$LOCK" -c "claude-tokenstein ingest --since-last >>'$LOG' 2>&1" ) &
exit 0
```

Hook returns immediately. macOS `flock` from `util-linux` via Homebrew or fallback to a node-implemented lock.

## 6. Slash commands

All commands accept `--currency=usd|eur` (default `usd`). All read-only against DuckDB.

| Command | Args | Output |
|---|---|---|
| `/tokenstein report <N>` | days | last-N-day total: input, output, cache breakdown, cost. Daily sparkline. |
| `/tokenstein today` | — | today's totals + per-model split |
| `/tokenstein session [<id>]` | optional session id | full breakdown for current (env `CLAUDE_SESSION_ID`) or specified session |
| `/tokenstein hourly` | — | last 24h, hour-by-hour bars |
| `/tokenstein top` | `--by=session\|project\|model --n=10` | top-N by total tokens or cost |
| `/tokenstein cost <month>` | YYYY-MM | per-model cost breakdown for that month, USD + EUR |
| `/tokenstein ingest` | — | force re-ingest now, print stats |

Output format: terminal-friendly tables (CLI tables) + a one-line summary header. Renders inline in the Claude Code chat.

Each `commands/*.md` is a thin Claude Code slash command stub that runs the equivalent CLI subcommand and pastes stdout.

## 7. Whitespace normalization (prompts)

```
1. Strip leading/trailing whitespace per line.
2. Collapse runs of inline whitespace (spaces/tabs) into a single space.
3. Collapse runs of blank lines (≥2 consecutive empty lines) into one blank line.
4. Trim leading/trailing whitespace on the whole text.
5. Preserve fenced code blocks unchanged (between triple-backtick markers) — do NOT normalize inside.
```

Code blocks pass through verbatim because trimming whitespace there changes semantics.

## 8. Pricing

Bundled `src/pricing/prices.json` shipped with the plugin. Updated on each plugin release based on https://docs.anthropic.com/en/docs/about-claude/pricing.

```json
{
  "claude-opus-4-7":     { "input": 15.0, "output": 75.0, "cache_write": 18.75, "cache_read": 1.50 },
  "claude-sonnet-4-6":   { "input":  3.0, "output": 15.0, "cache_write":  3.75, "cache_read": 0.30 },
  "claude-haiku-4-5":    { "input":  0.8, "output":  4.0, "cache_write":  1.00, "cache_read": 0.08 }
}
```

Loader merges `~/.claude-tokenstein/prices.json` over the bundled file (deep merge by model id). Unknown models log a warning and price as zero (so reports still render).

Cost formula per row (USD):

```
cost = (input_tokens / 1e6)                * input
     + (output_tokens / 1e6)               * output
     + (cache_creation_input_tokens / 1e6) * cache_write
     + (cache_read_input_tokens / 1e6)     * cache_read
```

## 9. FX (USD → EUR)

- Daily fetch in `claude-tokenstein ingest` from `https://api.frankfurter.app/latest?from=USD&to=EUR`.
- Cache row in `fx_rates` keyed by date.
- On EUR-mode report: look up today's row; if missing AND online → on-demand fetch; if offline → use most recent row, label as `(rate from <date>)` in report footer.
- User override: `config.fx_override_usd_eur` (number) → bypass network, use that rate, mark `source='manual'`.

## 10. Config file

`~/.claude-tokenstein/config.json` (mode 600):

```json
{
  "admin_api_key": "sk-ant-admin-…",
  "default_currency": "usd",
  "fx_override_usd_eur": null,
  "ingest": {
    "claude_code": true,
    "admin_api": true,
    "max_admin_api_lookback_days": 30
  },
  "store_prompts": true
}
```

## 11. Performance targets

- SessionStart hook returns in < 50 ms (detached spawn only).
- Background ingest of 1 day's incremental Claude Code logs: < 2 s on M-class Mac.
- Full backfill of 1M assistant turns: < 60 s.
- Slash command response: < 200 ms on 1M-row DB (DuckDB columnar wins here).

## 12. Edge cases

- **Concurrent ingest** → `flock` returns; second run exits silently.
- **Truncated JSONL line** (interrupted write) → log + skip line, do not advance `line_count` past it; retry next ingest.
- **JSONL line w/o `usage`** → skip silently (system messages, tool results).
- **Missing model in price table** → cost = 0, warn once per model per ingest.
- **Offline FX** → fallback to last-known rate, report footer marks `[stale fx: <date>]`.
- **DuckDB concurrent open** → DuckDB allows one writer; readers (slash commands) must open in read-only mode.
- **Session id missing** (admin_api rows) → reports group by model+date instead.
- **Plugin uninstalled** → DB persists at `~/.claude-tokenstein/`; user can `rm -rf` manually.

## 13. Test plan

- Unit: text normalization, cost calc, FX lookup w/ fallback, price merge.
- Integration: ingest a fixture JSONL → assert exact row counts, dedup on re-ingest.
- E2E: install plugin in a throwaway Claude Code session, verify hook spawns, verify `/tokenstein today` returns rows.

## 14. Build sequence (suggested order)

1. DuckDB schema + migration runner
2. JSONL ingest + idempotency + `files_seen`
3. CLI scaffold (commander/yargs) with `ingest` subcommand
4. Pricing + cost calc
5. `report`, `today`, `session` commands
6. SessionStart hook + lockfile
7. FX module + EUR rendering
8. `hourly`, `top`, `cost` commands
9. Admin API ingest
10. Plugin manifest + slash command stubs + `.mcp.json`
11. Distribution: tag release, plugin install instructions
