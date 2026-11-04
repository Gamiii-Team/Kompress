#!/bin/zsh
# Thin wrapper — calls universal Node setup (works on Linux/Mac/WSL/Git Bash)
# Cross-platform: use setup.bat (Windows cmd) or setup.ps1 (PowerShell) on native Windows
exec node "$(dirname $0)/setup.js" "$@"
