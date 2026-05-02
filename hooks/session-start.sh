#!/bin/sh
# hooks/session-start.sh — macOS/Linux developer machines only.
set -eu
LOG="$HOME/.claude-tokenstein/logs/ingest.log"
mkdir -p "$(dirname "$LOG")"
( claude-tokenstein ingest --since-last --with-lock >>"$LOG" 2>&1 ) &
exit 0
