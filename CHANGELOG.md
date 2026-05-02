# Changelog

## [0.4.1] - 2026-05-02

### Added
- Test suite expanded from 70 to 224 tests across 8 new test files
- `@vitest/coverage-v8` with thresholds: 90% statements/functions/lines, 70% branches
- `weekStart`, `monthStart`, `quarterStart`, `tomorrow` exported from `src/reports/html-queries.ts` with default `now: Date = new Date()` parameter for testability

### Changed
- Coverage lifted to 93.48% statements / 70.86% branches / 93.12% functions / 94.70% lines (from 78.49% / 54.62% / 70.00% / 81.21%)

## [0.4.0] - 2026-05-02

### Added
- `html` CLI command — generates a fully self-contained single-file HTML report covering Today, This Week, This Month, This Quarter, YTD, and LTD (all-time)
- `tokenstein_html` MCP tool — same report accessible via MCP with `currency`, `output`, and `open` parameters
- `/tokenstein-html` slash command skill
- Per-period interactive tabs with Chart.js charts (stacked bar, doughnut cost split, token breakdown grouped bar, trend line for YTD/LTD) — all embedded inline, no CDN, fully offline
- Cache read costs shown in green throughout HTML report to highlight their ~10% discount vs standard input pricing

### Fixed
- All report commands (`today`, `session`, `report`, `ytd`, `all-time`, `cost`) now show a **Total** column counting all four token types (input + output + cache_write + cache_read) — previously only input + output were counted
- `all-time` and `ytd` tables now show both **Total (gen)** and **Total (all)** columns
- Hourly and top commands now include cache tokens in their totals

## [0.3.0] - 2026-05-02

### Added
- MCP server now exposes all 9 report commands as MCP tools (`tokenstein_today`, `tokenstein_ytd`, `tokenstein_alltime`, `tokenstein_report`, `tokenstein_session`, `tokenstein_hourly`, `tokenstein_top`, `tokenstein_cost`, `tokenstein_ingest`)

### Fixed
- Slash commands no longer loop or fail silently on Claude Code desktop (macOS/Windows) — commands now call MCP tools directly instead of `!bash` invocations that could not resolve the CLI binary or recursed into the slash-command system

## [0.2.2] - 2026-05-02

### Fixed
- SessionStart hook now fires on Windows — replaced bash-only command with a cross-platform Node.js dispatcher that routes to `session-start.cmd` on win32 and `session-start.sh` on POSIX

## [0.2.1] - 2026-05-02

### Changed
- Bump esbuild 0.21.5 → 0.27.7 and vitest 1 → 4 (transitive dep security updates)

## [0.2.0] - 2026-05-02

### Added
- `ytd` command — year-to-date totals with daily sparkline
- `all-time` command — all-time totals grouped by month
- Slash commands `/tokenstein-ytd` and `/tokenstein-alltime`
- Detailed README with full CLI reference, MCP docs, and troubleshooting guide

## [0.1.0] - 2026-05-02

### Added
- DuckDB-backed token tracking from Claude Code JSONL transcripts
- Anthropic Admin API ingest with pagination and retry
- Slash commands: `report`, `today`, `session`, `hourly`, `top`, `cost`, `ingest`
- USD/EUR cost calculation with live FX from frankfurter.app and DB cache
- SessionStart hook for Windows (`.cmd`/`.ps1`) and POSIX (`.sh`)
- JS lockfile via `proper-lockfile` — prevents concurrent ingest runs
- Whitespace normalization preserving code fences (PRD §7)
- Model alias map for dated Anthropic model IDs
- Claude Code plugin manifest with MCP server
