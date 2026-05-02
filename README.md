# claude-tokenstein

Track and report Claude token usage — directly inside Claude Code.

Ingests session transcripts from `~/.claude/projects/` and the Anthropic Admin API, stores them in a local [DuckDB](https://duckdb.org/) database, and exposes slash commands and an MCP server so you can query your usage without leaving the chat.

---

## Features

- **Dual ingest** — local Claude Code JSONL transcripts + Anthropic Admin API
- **Zero-latency reports** — DuckDB runs in-process, no network round-trip
- **Nine slash commands** covering today, YTD, all-time, monthly cost, top consumers, hourly, and more
- **USD / EUR** with live FX from frankfurter.app and a 24-hour DB cache
- **Custom price overrides** — stay accurate when Anthropic changes pricing
- **Session-start hook** — ingest runs automatically on each new session
- **MCP server** — exposes token data to any MCP-aware client
- **Cross-platform** — macOS, Linux, Windows (PowerShell + cmd.exe)

---

## Requirements

- Node.js 20.10+
- Claude Code with plugin support

---

## Install

### As a Claude Code plugin (recommended)

```sh
# From GitHub
claude plugin install gunesbizim/claude-tokenstein

# From a local clone
claude plugin install ./
```

### As an npm package (CLI / MCP only)

```sh
npm install -g claude-tokenstein
```

---

## Quick start

1. Install the plugin (see above).
2. *(Optional)* Create `~/.claude-tokenstein/config.json` with your Admin API key (see [Configuration](#configuration)).
3. Open Claude Code — the session-start hook runs an initial ingest automatically.
4. Type `/tokenstein-today` to see today's usage.

---

## Configuration

Create `~/.claude-tokenstein/config.json` (the directory is created automatically on first run):

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

**Secure the file on macOS/Linux** (tokenstein enforces this at startup):

```sh
chmod 600 ~/.claude-tokenstein/config.json
```

| Field | Default | Description |
|---|---|---|
| `admin_api_key` | *(none)* | Anthropic Admin API key (`sk-ant-admin-…`). Optional — transcript ingest works without it. |
| `default_currency` | `"usd"` | `"usd"` or `"eur"` |
| `fx_override_usd_eur` | `null` | Fixed USD→EUR rate. `null` = fetch live from frankfurter.app |
| `ingest.claude_code` | `true` | Ingest local JSONL transcripts |
| `ingest.admin_api` | `true` | Ingest from Anthropic Admin API |
| `ingest.max_admin_api_lookback_days` | `30` | How many days back to fetch from Admin API |
| `store_prompts` | `true` | Store prompt text in the DB for session-level queries |

---

## Slash commands

All commands accept `--currency=eur` to render costs in EUR.  
Commands that produce tabular output also accept `--json` for machine-readable output.

| Command | Description |
|---|---|
| `/tokenstein-today` | Today's totals with per-model split |
| `/tokenstein-ytd` | Year-to-date totals with daily sparkline |
| `/tokenstein-alltime` | All-time totals grouped by month |
| `/tokenstein-report <N>` | Last N days with daily sparkline |
| `/tokenstein-session [id]` | Current or specified session breakdown |
| `/tokenstein-hourly` | Last 24 hours broken down by hour |
| `/tokenstein-top [--by=session\|project\|model] [--n=10]` | Top-N token consumers |
| `/tokenstein-cost <YYYY-MM>` | Per-model cost breakdown for a month |
| `/tokenstein-ingest` | Force a manual ingest pass |

### Examples

```
/tokenstein-today
/tokenstein-today --currency=eur
/tokenstein-report 7
/tokenstein-cost 2026-04 --currency=eur
/tokenstein-top --by=project --n=5
/tokenstein-session
/tokenstein-alltime --currency=eur
```

---

## CLI usage

When installed globally via npm, the same commands are available on the terminal:

```sh
claude-tokenstein today
claude-tokenstein ytd --currency=eur
claude-tokenstein all-time
claude-tokenstein report 30
claude-tokenstein cost 2026-04
claude-tokenstein top --by=project --n=5
claude-tokenstein session
claude-tokenstein hourly
claude-tokenstein ingest
claude-tokenstein ingest --dry-run
claude-tokenstein ingest --source=claude_code
```

Global flags (place before the subcommand):

| Flag | Description |
|---|---|
| `--currency <c>` | `usd` (default) or `eur` |
| `--json` | Output JSON instead of a table |
| `--color` | Enable ANSI color output |

---

## Price overrides

When Anthropic changes pricing, add a file at `~/.claude-tokenstein/prices.json`. Entries are merged over the bundled defaults — you only need to include changed models:

```json
{
  "claude-opus-4-7": {
    "input": 15.0,
    "output": 75.0,
    "cache_write": 18.75,
    "cache_read": 1.50
  }
}
```

All values are in USD per million tokens.

---

## Data storage

| Path | Contents |
|---|---|
| `~/.claude-tokenstein/tokens.duckdb` | Main database (messages, FX cache, ingest state) |
| `~/.claude-tokenstein/config.json` | Configuration (mode 600) |
| `~/.claude-tokenstein/prices.json` | Optional price overrides |
| `~/.claude-tokenstein/ingest.lock` | Lockfile — prevents concurrent ingest runs |
| `~/.claude-tokenstein/tokenstein.log` | Debug log |

The database is a single local file — no server, no cloud.

---

## MCP server

The plugin registers an MCP server automatically. To use it standalone:

```json
{
  "mcpServers": {
    "claude-tokenstein": {
      "command": "claude-tokenstein",
      "args": ["mcp"]
    }
  }
}
```

---

## Troubleshooting

**DuckDB locked (`ingest.lock` exists)**  
Another ingest is running. Wait for it to finish, or if it's stale: `rm ~/.claude-tokenstein/ingest.lock`

**TLS error on Windows** (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`)  
Set the env var: `NODE_EXTRA_CA_CERTS=C:\path\to\corp-root.crt`

**Block characters render as `?` in cmd.exe**  
Use Windows Terminal, or run `chcp 65001` first.

**Session-start hook does not fire on Windows**  
Verify `claude-tokenstein.cmd` is on `PATH`. Check PowerShell ExecutionPolicy (`Get-ExecutionPolicy`).

**`config.json is world-readable` error on macOS/Linux**  
Run: `chmod 600 ~/.claude-tokenstein/config.json`

**No data after first install**  
Run `/tokenstein-ingest` to trigger a manual pass. The session-start hook will handle future sessions automatically.

---

## Uninstall

```sh
# macOS / Linux
claude plugin uninstall claude-tokenstein
rm -rf ~/.claude-tokenstein
```

```powershell
# Windows
claude plugin uninstall claude-tokenstein
Remove-Item -Recurse -Force "$env:USERPROFILE\.claude-tokenstein"
```

---

## License

MIT — see [LICENSE](LICENSE).
