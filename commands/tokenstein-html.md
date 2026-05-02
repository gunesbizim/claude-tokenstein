---
name: tokenstein-html
description: "Generate a self-contained HTML report for all time periods (today, week, month, quarter, YTD, LTD). Usage: /tokenstein-html [--currency=usd|eur] [--open] [--output=<path>]"
---
Call the `tokenstein_html` tool from the `claude-tokenstein` MCP server.
If $ARGUMENTS contains `--currency=eur`, pass `currency: "eur"`.
If $ARGUMENTS contains `--open`, pass `open: true`.
If $ARGUMENTS contains `--output=<path>`, pass `output: "<path>"`.
Display the returned file path to the user.
