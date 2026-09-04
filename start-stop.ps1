# 星野 Stop - PM2
Write-Host "Stopping all services via PM2..." -ForegroundColor Yellow
pm2 stop xingye-snowluma xingye-backend xingye-frontend xingye-gaokao 2>$null
pm2 delete xingye-snowluma xingye-backend xingye-frontend xingye-gaokao 2>$null
Write-Host "All services stopped." -ForegroundColor Green
