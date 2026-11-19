@echo off
setlocal
echo ============================================
echo   ProfileGrid - 1-Click Local Desktop Launch
echo ============================================

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js 20+ is required. Download from https://nodejs.org
  pause
  exit /b 1
)

cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing packages ^(first run only^)...
  call npm install --legacy-peer-deps
  if %errorlevel% neq 0 (
    echo [ERROR] Package install failed!
    pause
    exit /b 1
  )
)

echo Starting ProfileGrid on http://localhost:3000 ...
start "" http://localhost:3000
call npm run dev
pause
