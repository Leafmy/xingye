@echo off
cd /d "%~dp0"
title Xingye Tauri Dev
echo ========================================
echo   Xingye Tauri Development Mode
echo ========================================
echo.

echo Starting Tauri dev server...
call npx tauri dev
if errorlevel 1 (
    echo Tauri dev failed!
    pause
    exit /b 1
)
