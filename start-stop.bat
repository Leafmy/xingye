@echo off
cd /d %~dp0
title Xingye Stopper (PM2)
echo ========================================
echo   Stopping all services...
echo ========================================
echo.
call pm2.cmd stop xingye-snowluma xingye-backend xingye-frontend xingye-gaokao
call pm2.cmd delete xingye-snowluma xingye-backend xingye-frontend xingye-gaokao
echo.
echo ========================================
echo   All services stopped.
echo ========================================
echo.
pause
