# 星野 Launcher
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  星野 Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Write-Host "[1/2] Starting backend..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectRoot\bot-backend'; npm start"

Start-Sleep -Seconds 3

Write-Host "[2/2] Starting frontend..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectRoot\panel-frontend'; npm run dev"

Write-Host ""
Write-Host "Done! Backend: http://localhost:3000 | Frontend: http://localhost:5174" -ForegroundColor Green
Read-Host "Press Enter to close"
