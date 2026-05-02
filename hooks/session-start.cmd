@echo off
REM hooks/session-start.cmd
REM Lightweight detached ingest — returns in <30ms, no PowerShell startup cost.
start "" /b "claude-tokenstein.cmd" ingest --since-last --with-lock >nul 2>&1
exit /b 0
