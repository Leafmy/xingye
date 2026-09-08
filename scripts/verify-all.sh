#!/bin/bash
# 一次性验证脚本：启动星野 → 等待就绪 → 截图（浅色/深色/设置页）
cd "C:\Users\Leaf_\Desktop\All In\Xingye"

(./xingye.exe > logs/xingye-verify.log 2>&1 &)

# 等待后端 3000 就绪（最多 75s）
ok=0
for i in $(seq 1 25); do
  sleep 3
  code=$(curl -s --noproxy "*" -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/version 2>/dev/null)
  if [ "$code" = "200" ]; then ok=1; echo "backend ready after ~$((i*3))s"; break; fi
done
[ "$ok" = "1" ] || { echo "backend NOT ready, abort"; exit 1; }
curl -s --noproxy "*" -m 5 http://127.0.0.1:3000/api/version; echo

# 浏览器验证
P=playwright-cli
$P close >/dev/null 2>&1
$P open "http://127.0.0.1:3000" >/dev/null 2>&1
sleep 4
echo "== light theme =="
$P screenshot --filename=shot-light.png >/dev/null 2>&1
ls -la shot-light.png 2>/dev/null | awk '{print $5, $9}'

# 深色模式：注入 localStorage 后重载
$P localstorage-set xingye-theme dark >/dev/null 2>&1
$P reload >/dev/null 2>&1
sleep 3
echo "== dark theme =="
$P screenshot --filename=shot-dark.png >/dev/null 2>&1
ls -la shot-dark.png 2>/dev/null | awk '{print $9}'

# App 设置页（hash 路由）
$P goto "http://127.0.0.1:3000/index.html#/app-settings" >/dev/null 2>&1
sleep 3
echo "== app settings page =="
$P screenshot --filename=shot-settings.png >/dev/null 2>&1
ls -la shot-settings.png 2>/dev/null | awk '{print $9}'

echo "done"
