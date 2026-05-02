---
name: tokenstein-top
description: "Top N Claude token consumers by session, project, or model. Usage: /tokenstein-top [--by=session|project|model] [--n=10]"
---
Call the `tokenstein_top` tool from the `claude-tokenstein` MCP server. Parse $ARGUMENTS: extract `--by=<value>` (session|project|model, default: model) and `--n=<number>` (default: 10). Display the result.
