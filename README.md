# claude-tokenstein

Track and report Claude token usage from local logs and the Anthropic Admin API. Distributed as a Claude Code plugin.

## What it does

- Ingests Claude Code session transcripts (`~/.claude/projects/`) and the Anthropic Admin API
- Stores token counts per turn in a local DuckDB database (`~/.claude-tokenstein/tokens.duckdb`)
- Exposes slash commands for usage reports directly in Claude Code chat
- Fires automatically on session start via a hook

## Install

**Requires:** Node 20.10+, Claude Code with plugin support.

```sh
# From local clone
claude plugin install ./

# Or from GitHub
claude plugin install gunesbizim/claude-tokenstein
```

**Windows (PowerShell):**
```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude-tokenstein" | Out-Null
notepad "$env:USERPROFILE\.claude-tokenstein\config.json"
```

**macOS/Linux:**
```sh
mkdir -p ~/.claude-tokenstein && chmod 700 ~/.claude-tokenstein
$EDITOR ~/.claude-tokenstein/config.json
```

## Configuration

`~/.claude-tokenstein/config.json` (mode 600 on POSIX):

```json
{
  "admin_api_key": "sk-ant-admin-...",
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

`admin_api_key` is optional — Claude Code transcript ingest works without it.

## Slash commands

| Command | Description |
|---|---|
| `/tokenstein-ingest` | Force ingest now |
| `/tokenstein-today` | Today's totals + per-model split |
| `/tokenstein-report <N>` | Last N days with sparkline |
| `/tokenstein-session [id]` | Current or specified session breakdown |
| `/tokenstein-hourly` | Last 24h hour-by-hour |
| `/tokenstein-top [--by=session\|project\|model] [--n=10]` | Top-N consumers |
| `/tokenstein-cost <YYYY-MM>` | Monthly cost breakdown |

All commands accept `--currency=eur` for EUR rendering.

## Price override

`~/.claude-tokenstein/prices.json` (optional, merged over bundled defaults):

```json
{
  "claude-opus-4-7": { "input": 15.0, "output": 75.0, "cache_write": 18.75, "cache_read": 1.50 }
}
```

## Troubleshooting

- **DuckDB locked**: Another ingest is running; wait or delete `~/.claude-tokenstein/ingest.lock`
- **TLS error on Windows** (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`): Set `NODE_EXTRA_CA_CERTS=path\to\corp-root.crt`
- **Block chars render as `?` in cmd.exe**: Use Windows Terminal or run `chcp 65001`
- **Hook does not run on Windows**: Verify `claude-tokenstein.cmd` is on PATH; check PowerShell ExecutionPolicy

## Uninstall

```powershell
# Windows
Remove-Item -Recurse -Force "$env:USERPROFILE\.claude-tokenstein"
```

```sh
# macOS/Linux
rm -rf ~/.claude-tokenstein
```
