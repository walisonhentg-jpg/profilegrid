@echo off
setlocal
echo ============================================
echo   ProfileGrid - Windows .EXE Builder
echo ============================================

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js is required. Install Node.js 20+ from https://nodejs.org
  pause
  exit /b 1
)

cd /d "%~dp0.."

echo [1/4] Installing dependencies...
call npm install --legacy-peer-deps
if %errorlevel% neq 0 goto :fail

echo [2/4] Installing Electron & electron-builder...
call npm install --no-save --legacy-peer-deps electron electron-builder
if %errorlevel% neq 0 goto :fail

echo [3/4] Building frontend and bundling server...
call npm run build
if %errorlevel% neq 0 goto :fail
call npx esbuild server.ts --bundle --platform=node --format=cjs --outfile=dist-server/server.cjs --external:vite --external:@tailwindcss/vite --external:lightningcss --external:playwright-core
if %errorlevel% neq 0 goto :fail

echo [4/4] Packaging Windows .exe (Portable + Setup)...
call npx electron-builder --config desktop/electron-builder.yml --win --publish never
if %errorlevel% neq 0 goto :fail

echo.
echo Build complete! Output file is in: dist-desktop\ProfileGrid-Portable.exe
pause
exit /b 0

:fail
echo.
echo [ERROR] Build failed! Check the message above.
pause
exit /b 1
