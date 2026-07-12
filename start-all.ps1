# 星野 Launcher - PM2 (calls pm2.cmd to avoid .ps1 execution policy issues)
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Starting all services via PM2..." -ForegroundColor Cyan

Write-Host "[1/3] Installing backend dependencies..." -ForegroundColor Yellow
Set-Location (Join-Path $projectRoot "bot-backend"); cmd /c "npm install" 2>$null

Write-Host "[2/3] Installing frontend dependencies..." -ForegroundColor Yellow
Set-Location (Join-Path $projectRoot "panel-frontend"); cmd /c "npm install" 2>$null

Set-Location $projectRoot

Write-Host "[3/3] Starting PM2 services..." -ForegroundColor Yellow
cmd /c "pm2.cmd start ecosystem.config.cjs" 2>$null

Start-Sleep -Seconds 5
cmd /c "pm2.cmd status"

Write-Host ""
Write-Host "All services started via PM2." -ForegroundColor Green
Write-Host "  SnowLuma:  http://localhost:5099"
Write-Host "  Backend:   http://localhost:3000"
Write-Host "  Frontend:  http://localhost:5174"
