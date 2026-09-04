# 星野 Xingye

QQ 智能助手「星野」—— Tauri 桌面应用（Windows）+ 服务器分发版。

## 项目结构

```
Xingye/
├── src-tauri/            # Tauri 桌面壳（Rust）：窗口、托盘、子进程管理、单实例、自启动
│   ├── src/              #   壳源码（process.rs 管理子进程，tray.rs 托盘菜单）
│   └── capabilities/     #   权限声明（窗口控制、自启动等）
├── panel-frontend/       # 管理面板前端（Vue 3 + Vite，BakaXL 风格玻璃 UI）
├── bot-backend/          # 业务后端（TypeScript/Express，:3000，托管面板与 API）
│   └── genshin-guide/    #   原神攻略模块（miao/liangshi 元数据用 init 脚本拉取）
├── SnowLuma/             # QQ 协议客户端（Node，:5099 WebUI，OneBot :3001）
├── app/                  # 服务器分发版布局模板（打包源）
├── updater/              # 服务器增量更新器
├── scripts/              # 构建 / GitHub 发布脚本
├── docs/                 # 历史文档（更新报告、部署指南等）
├── tests/                # 更新器单元测试
└── version.json          # 版本号单一来源（backend /api/version 与更新检查共用）
```

## 桌面版

双击 `src-tauri/target/release/xingye.exe`（开发时先 `build-tauri.bat`，调试用 `dev-tauri.bat`）。

- 壳自动拉起 SnowLuma 与 bot-backend 子进程，托盘可「显示窗口 / 重启服务 / 开机自启 / 退出」
- 单实例锁：重复启动会聚焦已有窗口
- 关闭按钮 = 隐藏到托盘；托盘右键「退出」才真正结束
- 子进程日志落盘：`src-tauri/target/release/{SnowLuma,app/bot-backend}/logs/`

## 本地开发

```powershell
npm.cmd run build:backend     # tsc 编译 bot-backend
npm.cmd run build:frontend    # vite 构建面板
```

改前端后需重跑 `cargo build --release`（UI 编译时嵌入 exe），且编译前先退出桌面版。

## 发布

`release.bat` 或 `node scripts/release.js --repo OWNER/xingye`，支持 `--dry-run`。

## 服务器更新

服务器上设置 `XINGYE_GITHUB_REPO=Leafmy/xingye` 后：

```powershell
node updater/server-update.js check
node updater/server-update.js apply
```

更新器保留 `.env`、数据库、日志与运行时配置，优先增量包、失败回退全量。详见 `docs/DEPLOY-GUIDE.md`。
