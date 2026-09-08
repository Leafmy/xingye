<div align="center">

<img src="app/panel-frontend/dist/xingye-logo.png" alt="星野 Xingye" width="96" />

# 星野 Xingye

**桌面级 QQ 智能助手 —— 原生窗口 · 内置引擎 · 全功能管理面板**

`v0.6.0` · Windows 10/11 x64 · Tauri 2 + Vue 3 + Node.js

</div>

---

## 🚀 快速开始

双击根目录的 **`xingye.exe`** 即可运行（绿色免安装，整个文件夹可随意移动/拷贝）。

1. 启动后主窗口打开管理面板，程序常驻系统托盘
2. 在「QQ 管理」页完成引擎绑定并登录 QQ
3. 左下角 **「App 设置」** 打开独立设置窗口：拖动标题栏移动窗口，右上角可最小化 / 关闭

> 首次运行会在 `%APPDATA%\com.xingye.bot\` 写入应用设置（关闭行为、模块主开关）。

## 📁 目录结构

```
Xingye/
├── xingye.exe                    主程序（Tauri 桌面壳，唯一入口）
├── version.json                  版本信息（面板与更新器读取）
├── README.md
├── .gitignore
│
├── app/                          运行资源（App 数据根）
│   ├── bot-backend/              业务后端（Express + WebSocket，:3000）
│   │   ├── dist/                 编译产物（入口 dist/index.js）
│   │   ├── node_modules/         运行时依赖
│   │   ├── BBDown/BBDown.exe     B 站视频下载器
│   │   └── package.json
│   ├── panel-frontend/dist/      管理面板静态资源（由后端托管）
│   ├── updater/                  自更新脚本
│   ├── data/                     运行数据（绑定 / 订阅 / 群组）
│   ├── manifest.json             文件清单（增量更新）
│   └── version.json
│
├── node/
│   └── node.exe                  内置 Node.js 运行时（不依赖系统 PATH）
│
└── SnowLuma/                     QQ 协议引擎（内置，无需第三方 WebUI）
    ├── index.mjs                 引擎入口
    ├── client/                   引擎内置 Web 资源
    ├── native/                   原生模块
    └── logs/                     引擎日志
```

### 运行期自动生成的目录

| 路径 | 内容 |
| --- | --- |
| `app/bot-backend/logs/backend.log` | 后端日志 |
| `SnowLuma/logs/` | 引擎日志 |
| `app/data/` | 机器人运行数据 |
| `%APPDATA%\com.xingye.bot\` | 应用设置（关闭行为 / 模块主开关） |

## 🧩 功能面板

| 页面 | 说明 |
| --- | --- |
| 总览 | 服务状态、资源图表、告警一览 |
| 用量 | AI Token 消耗统计 |
| 功能管理 | 订阅 / 绑定 / 群组 / 功能开关 |
| 系统设置 | 应用自更新、群唤醒、广播、Prompt 热改 |
| 日志 | 后端实时日志（SSE） |
| 消息 / 终端 | 手动发消息、Web CLI |
| 好友管理 | 白名单自动通过 |
| **QQ 管理** | 进程注入、账号配置热重载、实时日志、更新检查 |
| 连接 | 本地 / 远程服务器切换 |

## ⚠️ 注意事项

- 目录结构与程序内的路径解析严格绑定：`xingye.exe` 同级必须保留 `app/`、`node/`、`SnowLuma/`，请勿单独移动其中某一项。
- 移动、重命名或拷贝**整个**文件夹不会影响运行（全部为相对路径解析）。
- 本目录只包含可运行程序与运行依赖，不含开发源码；源码历史保留在 `.git` 版本库中（`git log` / `git show` 可查）。

## 📜 免责声明

本项目通过非官方方式（进程注入）接入 QQ，仅供学习与技术研究。
使用本项目产生的任何账号风险（包括封禁）由使用者自行承担。请勿用于商业或违法用途。

---

<div align="center">

**星野 Xingye** · Made with ❤️ and Tauri

</div>
