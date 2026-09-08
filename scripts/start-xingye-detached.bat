@echo off
REM 启动星野桌面端（脱离工具会话的持久启动）
schtasks /create /tn "XingyeAppStart" /tr "C:\Users\Leaf_\Desktop\All In\Xingye\xingye.exe" /sc once /st 23:59 /f
schtasks /run /tn "XingyeAppStart"
