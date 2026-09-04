@echo off
cd /d "%~dp0"
title Xingye Bot Only (PM2)
echo ========================================
echo   Xingye Bot Launcher (PM2)
echo ========================================
echo.
if not defined STEAM_PROXY_URL set STEAM_PROXY_URL=http://127.0.0.1:7890
echo [Proxy] STEAM_PROXY_URL=%STEAM_PROXY_URL%
echo.
echo Starting backend and frontend...
call pm2.cmd start ecosystem.config.cjs --only xingye-backend,xingye-frontend,xingye-gaokao
timeout /t 3 /nobreak >nul
call pm2.cmd status
echo.
echo ========================================
echo   Bot services started!
echo   Backend:   http://localhost:3000
echo   Frontend:  http://localhost:5174
echo ========================================
echo.
pause
