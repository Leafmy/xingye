# 星野 Xingye

QQ 智能助手「星野」—— Tauri 桌面应用（Windows）+ 服务器分发版。

## 项目结构

```
Xingye/
├── xingye.exe            # 桌面版主程序（构建后自动同步至根目录）
├── app/                  # 运行资源：backend 编译产物 + 面板 dist + updater + version.json
├── SnowLuma/             # QQ 协议引擎（内部运行，:5099 为内部 API）
├── BBDown/               # B 站下载工具
├── version.json          # 版本号单一来源
├── ecosystem.config.cjs  # PM2 配置（服务器部署用）
├── README.md
└── source/               # 全部开发源码
    ├── src-tauri/        #   Tauri 壳（Rust）：窗口、托盘、单实例、自启动
    ├── panel-frontend/   #   管理面板（Vue 3，BakaXL 风格玻璃 UI，双主题）
    ├── bot-backend/      #   业务后端（TypeScript/Express）
    ├── scripts/          #   构建/发布脚本
    ├── updater/          #   服务器增量更新器
    ├── tests/            #   单元测试
    ├── docs/             #   历史文档
    └── server/           #   服务器分发（Dockerfile、部署/打包脚本）
```

完整说明见根目录《星野概况.md》。

## 桌面版

主程序在项目根目录：双击 **`xingye.exe`** 即可（构建脚本会在每次构建后自动把产物同步到这里）。

- 壳自动拉起 SnowLuma 与 bot-backend 子进程，托盘可「显示窗口 / 重启服务 / 开机自启 / 退出」
- 单实例锁：重复启动会聚焦已有窗口
- 关闭按钮 = 隐藏到托盘；托盘右键「退出」才真正结束
- 子进程日志落盘：`SnowLuma/logs/` 与 `app/bot-backend/logs/`
- 依赖解析：backend 优先用 `app/bot-backend` 自带依赖，缺失时回退源码 `bot-backend/node_modules`（NODE_PATH）

开发与打包：

- `build-tauri.bat`：前端构建 → `npx tauri build`（NSIS 安装包 + 更新签名）→ 同步 `xingye.exe` 到根目录
- `dev-tauri.bat`：开发模式
- 手动 `cargo build --release` 后需自行复制 exe 到根目录（或重跑 build-tauri.bat）
- 改前端后需重新 `cargo build --release`（UI 编译时嵌入 exe），编译前先退出桌面版

## 发布

`release.bat` 或 `node scripts/release.js --repo OWNER/xingye`，支持 `--dry-run`。

## 服务器更新

服务器上设置 `XINGYE_GITHUB_REPO=Leafmy/xingye` 后：

```powershell
node updater/server-update.js check
node updater/server-update.js apply
```

更新器保留 `.env`、数据库、日志与运行时配置，优先增量包、失败回退全量。详见 `docs/DEPLOY-GUIDE.md`。
