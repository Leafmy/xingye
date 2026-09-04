<div align="center">

![星野 Xingye](source/panel-frontend/public/xingye-logo.png)

# 星野 Xingye

**一个桌面级的 QQ 智能助手 —— 原生窗口、内置引擎、全功能管理面板**

![Version](https://img.shields.io/badge/version-0.6.0-blue.svg)

![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-lightgrey)

![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB)

![Vue](https://img.shields.io/badge/Vue-3-4FC08D)

*下载最新版本请前往 [Releases](../../releases)*

</div>

---

## ✨ 它是什么

星野是一个常驻你桌面、接入 QQ 群聊与私聊的智能助手。安装后它会在托盘安静运行，  
自动完成 QQ 进程注入与消息处理，你只需要在漂亮的面板里管理一切。

> ⚠️ **免责声明**：本项目通过非官方方式（进程注入）接入 QQ，仅供学习与技术研究。  
> 使用本项目产生的任何账号风险（包括封禁）由使用者自行承担。请勿用于商业或违法用途。

## 🎁 特性一览

- 🖥️ **真·桌面应用** —— Tauri 2.0 原生窗口，内存占用低，托盘常驻，单实例锁，可选开机自启
- 🎨 **BakaXL 风格界面** —— Fluent 玻璃质感 + 官网同款渐变光斑，**深浅色自动跟随系统**
- 🤖 **AI 对话** —— 群聊唤醒词 / @ 召唤 / 私聊直聊，支持临时人格设定
- 🎮 **游戏能力** —— Steam 战绩查询、游戏时长排行、促销战报订阅推送、CS2 查询、5E 绑定
- 📺 **B 站集成** —— 视频解析下载（BBDown）、TV 扫码登录
- ⚔️ **原神攻略** —— 角色面板与攻略图生成（米游社元数据）
- 🐧 **QQ 引擎内建** —— SnowLuma 引擎作为内部组件，进程注入/卸载、账号配置热重载、  
  实时日志流全部在面板「QQ 管理」页完成，**无需接触任何第三方 WebUI**
- 📦 **自更新** —— 安装包带 minisign 签名校验，新版本发布后面板内一键升级
- 🌐 **本地 / 远程双模式** —— 面板可直连本机引擎，也可远程管理部署在服务器上的星野

## 📥 安装

1. 前往 [**Releases**](../../releases) 下载 `星野 Xingye_x.y.z_x64-setup.exe`
2. 双击安装（可选安装目录，自动创建桌面与开始菜单快捷方式）
3. 启动后首次使用请在面板「QQ 管理」中完成引擎绑定，然后登录 QQ 即可

<details>

<summary><b>不装安装包？绿色运行</b></summary>

直接下载 Release 附件中的安装包安装即可；开发者在项目根目录构建后  
`xingye.exe` 会自动出现在仓库根目录，双击即可（需先运行 `build-tauri.bat`）。

</details>

## 🚀 快速开始（从源码构建）

```bat
git clone https://github.com/Leafmy/xingye.git
cd xingye
build-tauri.bat
:: 构建完成 → xingye.exe（根目录）+ source\src-tauri\target\release\bundle\nsis\ 安装包
```

要求：Node.js 18+、Rust (MSVC)、WebView2（Win11 自带）。  
开发模式（热重载）用 `dev-tauri.bat`。完整说明见 [source/docs/DEVELOPMENT.md](source/docs/DEVELOPMENT.md)。

## 🧩 功能面板

| 页面        | 说明                     |
| --------- | ---------------------- |
| 总览        | 服务状态、资源图表、告警一览         |
| 用量        | AI Token 消耗统计          |
| 功能管理      | 订阅/绑定/群组/功能开关          |
| 系统设置      | 应用自更新、群唤醒、广播、Prompt 热改 |
| 日志        | 后端实时日志（SSE）            |
| 消息 / 终端   | 手动发消息、Web CLI          |
| 好友管理      | 白名单自动通过                |
| **QQ 管理** | 进程注入、账号配置热重载、实时日志、更新检查 |
| 连接        | 本地 / 远程服务器切换           |

## 🏗️ 技术栈

`Tauri 2 (Rust)` · `Vue 3 + Vite` · `TypeScript + Express` · `SnowLuma (QQ 协议引擎)` · `PM2 / Docker (服务器分发)`

## 📁 仓库结构

```
xingye.exe          ← 主程序（构建产物，根目录即运行目录）
app/                ← 运行资源（后端产物 + 面板）
SnowLuma/           ← QQ 协议引擎
source/             ← 全部开发源码
├── src-tauri/      #   Tauri 壳 (Rust)
├── panel-frontend/ #   管理面板 (Vue 3)
├── bot-backend/    #   业务后端 (TypeScript)
└── scripts/        #   构建/发布脚本
```

## 🗺️ Roadmap

- [ ] 安装包代码签名
- [ ] GitHub Release 自动发版流水线
- [ ] 面板移动端适配
- [ ] 多语言

## 💬 反馈

问题与建议请提交 [Issues](../../issues)。

---

<div align="center">

**星野 Xingye** · Made with ❤️ and Tauri

</div>
