# Changelog

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
