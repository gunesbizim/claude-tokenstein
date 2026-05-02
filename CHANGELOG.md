# Changelog

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
