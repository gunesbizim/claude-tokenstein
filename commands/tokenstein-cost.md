---
name: tokenstein-cost
description: "Per-model cost breakdown for a given month. Usage: /tokenstein-cost <YYYY-MM> [--currency=usd|eur]"
---
Call the `tokenstein_cost` tool from the `claude-tokenstein` MCP server. Parse $ARGUMENTS: the first positional value is `month` in YYYY-MM format (required). If `--currency=eur` is present, pass `currency: "eur"`. Display the result.
