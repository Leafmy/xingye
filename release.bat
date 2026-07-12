@echo off
cd /d "%~dp0"
title Xingye Release
call npm.cmd run release -- %*
if errorlevel 1 pause
