# hooks/session-start.ps1
# Fire-and-forget detached ingest. Returns immediately.
$ErrorActionPreference = "SilentlyContinue"
$root = Join-Path $env:USERPROFILE ".claude-tokenstein"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "ingest.log"

# start /b detaches without PowerShell overhead, returns in <30ms
$null = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", "start", '""', "/b", "claude-tokenstein.cmd", "ingest", "--since-last", "--with-lock" `
    -WindowStyle Hidden
exit 0
