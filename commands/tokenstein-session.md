---
name: tokenstein-session
description: "Token breakdown for the current or a specified session. Usage: /tokenstein-session [session-id] [--currency=usd|eur]"
---
Call the `tokenstein_session` tool from the `claude-tokenstein` MCP server. Parse $ARGUMENTS: if a session ID is present as a positional argument, pass it as `session_id`. If `--currency=eur` is present, pass `currency: "eur"`. Display the result.
