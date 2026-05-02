---
name: tokenstein-report
description: "Last N-day Claude token totals with daily sparkline. Usage: /tokenstein-report <days> [--currency=usd|eur]"
---
Call the `tokenstein_report` tool from the `claude-tokenstein` MCP server. Parse $ARGUMENTS: the first positional value is `days` (number, required). If `--currency=eur` is present, pass `currency: "eur"`. Display the result.
