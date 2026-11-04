@echo off
REM setup.bat — Windows cmd wrapper for universal Node setup
REM If Node is not installed, instructs user to install from https://nodejs.org/
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo [FAIL] Node not found. Download from https://nodejs.org/
  exit /b 1
)
echo [INIT] Running universal setup (setup.js)...
node "%~dp0\setup.js" %*
if %errorlevel% neq 0 (
  echo [FAIL] Setup failed. Check output above.
  exit /b %errorlevel%
)
echo [OK] Setup complete. Open https://localhost in your browser.
