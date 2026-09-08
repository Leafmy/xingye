# -*- coding: utf-8 -*-
# 为 App.vue 导航项补全 section 分组字段（一次性修复脚本）
import io

p = r"C:\Users\Leaf_\Desktop\All In\Xingye\src\panel-frontend\src\App.vue"
s = io.open(p, encoding="utf-8").read()

repl = [
    ("{ key: 'usage', label: '用量', desc: 'AI 调用与Token统计', icon:",
     "{ key: 'usage', label: '用量', desc: 'AI 调用与Token统计', section: '监控', icon:"),
    ("{ key: 'logs', label: '日志', desc: '实时事件与错误流', icon:",
     "{ key: 'logs', label: '日志', desc: '实时事件与错误流', section: '监控', icon:"),
    ("{ key: 'settings', label: '功能开关', desc: 'AI/媒体/游戏功能管理', icon:",
     "{ key: 'settings', label: '功能开关', desc: 'AI/媒体/游戏功能管理', section: 'Bot 管理', icon:"),
    ("{ key: 'cli', label: '终端', desc: 'Web CLI 命令行', icon:",
     "{ key: 'cli', label: '终端', desc: 'Web CLI 命令行', section: 'Bot 管理', icon:"),
    ("{ key: 'friendmgmt', label: '好友管理', desc: '好友申请与白名单', icon:",
     "{ key: 'friendmgmt', label: '好友管理', desc: '好友申请与白名单', section: 'QQ', icon:"),
    ("{ key: 'messaging', label: '消息发送', desc: '向群组发送消息', icon:",
     "{ key: 'messaging', label: '消息发送', desc: '向群组发送消息', section: 'QQ', icon:"),
]

count = 0
for old, new in repl:
    if old in s:
        s = s.replace(old, new, 1)
        count += 1
    else:
        print("NOT FOUND:", old[:60])

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("replaced:", count, "/", len(repl))
