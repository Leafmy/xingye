@echo off
cd /d "%~dp0"
title Xingye Launcher (PM2)

echo ========================================
echo   Xingye All-in-One Launcher (PM2)
echo ========================================
echo.

echo [1/3] Installing backend dependencies...
cd /d "%~dp0bot-backend"
call npm install >nul 2>&1

echo [2/3] Installing frontend dependencies...
cd /d "%~dp0panel-frontend"
call npm install >nul 2>&1

echo [3/3] Starting PM2 services...
cd /d "%~dp0"
call pm2.cmd start ecosystem.config.cjs

echo.
echo Waiting for services...
timeout /t 5 /nobreak >nul
call pm2.cmd status

echo.
echo ========================================
echo   All services started!
echo   SnowLuma:  http://localhost:5099
echo   Backend:   http://localhost:3000
echo   Frontend:  http://localhost:5174
echo ========================================
echo.
pause
