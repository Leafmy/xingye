@echo off
cd /d "%~dp0"
title Xingye Tauri Build
echo ========================================
echo   Xingye Tauri Build
echo ========================================
echo.

echo [1/3] Building frontend...
cd /d "%~dp0panel-frontend"
call npm run build
if errorlevel 1 (
    echo Frontend build failed!
    pause
    exit /b 1
)

echo.
echo [2/3] Building Tauri app...
cd /d "%~dp0"
call npx tauri build
if errorlevel 1 (
    echo Tauri build failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Build complete!
echo   Output: src-tauri/target/release/bundle/
echo ========================================
echo.
pause
