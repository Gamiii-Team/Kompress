# setup.ps1 — PowerShell wrapper for universal Node setup (Windows)
$ErrorActionPreference = "Stop"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[FAIL] Node not found. Download from https://nodejs.org/" -ForegroundColor Red
    exit 1
}
Write-Host "[INIT] Running universal setup (setup.js)..." -ForegroundColor Cyan
& node "$PSScriptRoot\setup.js" @args
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Setup failed. Check output above." -ForegroundColor Red
    exit $LASTEXITCODE
}
Write-Host "[OK] Setup complete. Open https://localhost in your browser." -ForegroundColor Green
Write-Host "Note: If you use WSL / Git Bash, you can also run: zsh ./setup.sh" -ForegroundColor Yellow
