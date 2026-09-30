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
│   │   ├── dist/                 编译产物（入口 dist/index.js，约 0.3MB）
│   │   ├── node_modules/         运行时依赖（仅运行闭包，约 10MB）
│   │   ├── BBDown/BBDown.exe     B 站视频下载器（按需）
│   │   └── package.json
│   ├── panel-frontend/dist/      管理面板静态资源（由后端托管）
│   ├── updater/                  自更新脚本
│   ├── data/                     运行数据（绑定 / 订阅 / 群组 / 下载缓存）
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

### 按需数据（不再随包分发）

原神攻略所需的静态数据体积巨大（约 316MB），已从发布包中移除，改为**首次使用时下载并缓存**：

| 数据 | 体积 | 触发时机 | 缓存位置 |
| --- | --- | --- | --- |
| miao 角色注册表 / 别名 / 词条权重 | 约 70KB | 首次发送攻略指令（`gs <角色>` / `<角色>面板`） | `app/data/cache/gs/miao/` |
| 单个角色的数据与立绘 | 约 1.4MB/角色 | 首次查询该角色 | 同上 |
| liangshi-calc 面板模板 / CSS / 字体 | 约数 MB | 首次生成角色面板图 | `app/data/cache/gs/liangshi/` |

- 启动时**不产生任何网络请求**；不使用攻略功能则永不下载。
- 安装到 `Program Files` 后 `app/data` 只读，缓存会自动回落到
  `%LOCALAPPDATA%\com.xingye.bot\cache`。
- 网络受限时可通过环境变量 `XINGYE_GS_PROXY` 指定代理
  （未设置时依次读取 `STEAM_PROXY_URL` / `HTTPS_PROXY` / `ALL_PROXY`）。
- 下载失败后进入 **5 分钟冷却**（`XINGYE_GS_RETRY_COOLDOWN_MS` 可调），
  期间重复发送攻略指令会立即返回「数据尚未就绪」而不是反复重试；
  冷却结束后自动重试，无需重启进程。
- 也可提前用 `source/bot-backend/genshin-guide/scripts/init-miao-data.ts` 预热缓存。


### 运行期自动生成的目录

| 路径 | 内容 |
| --- | --- |
| `app/bot-backend/logs/backend.log` | 后端日志 |
| `SnowLuma/logs/` | 引擎日志 |
| `app/data/` | 机器人运行数据 |
| `app/data/cache/gs/` | 原神攻略按需下载的数据缓存（`app/data` 只读时回落到 `%LOCALAPPDATA%\com.xingye.bot\cache`） |
| `%APPDATA%\com.xingye.bot\` | 应用设置（关闭行为 / 模块主开关） |

## 🛠 体积与资源占用

发布包（绿色版，`xingye.exe` + `app/` + `node/` + `SnowLuma/`）经重构后约 **134MB**，
重构前约 **467MB**（−71%）。主要来源：

| 项目 | 前 | 后 | 说明 |
| --- | --- | --- | --- |
| miao 攻略图库 | 138.7MB | 0 | 改为按需下载 + 缓存 |
| `genshin-db` 依赖 | 160.9MB | 0 | 只被一段从未调用的死代码使用，已删除 |
| Playwright（含 core） | 16.7MB | 0 | 改用系统 Edge / Chrome 的 DevTools Protocol 截图 |
| 运行时 `node_modules` | 191.1MB | 10.1MB | 裁到运行闭包，并剔除开发依赖残留 |
| `xingye.exe` | 17.9MB | 5.5MB | release profile 体积优化 + 去掉未用插件 + rustls 替代 native-tls |
| 面板静态资源 | 0.9MB | 0.3MB | 移除未被引用的图片，拆分 chunk |
| `node/node.exe` | 88.5MB | 88.5MB | 内置运行时，未改动 |

运行时侧：

- 面板的 7 处轮询、WebSocket 指标/日志推送、SnowLuma 日志流在窗口隐藏时暂停或缓冲，
  恢复可见时立即补齐；长时间无交互后自动降频。
- 攻略截图所用无头浏览器**懒启动**，空闲 3 分钟自动退出——不再像 Playwright 那样
  在进程生命周期内常驻一个 Chromium。
- 后端只在有面板连接时才采集并推送指标，没有连接时整段逻辑跳过。

> 说明：后端**空闲**内存与 CPU 与重构前基本持平（Node/Express 自身开销占主导），
> 本次的收益集中在磁盘体积、启动期网络依赖与「用到截图功能时的内存/进程常驻」。

## 🧱 从源码构建

```
source/
├── bot-backend/          后端 TypeScript 源码
├── panel-frontend/       面板前端源码（Vue 3 + Vite）
├── src-tauri/            Tauri 壳源码（Rust）
├── scripts/
│   ├── build-backend.ps1 后端编译（tsc --noCheck，产物 → app/bot-backend/dist）
│   ├── build.js / release.js
├── updater/              自更新脚本源码
├── tests/                测试
└── build-exe.ps1         一体化构建（前端 → Tauri → 复制 exe 到根目录）
```

- 后端：`powershell -ExecutionPolicy Bypass -File source/scripts/build-backend.ps1`
- 全量：`powershell -ExecutionPolicy Bypass -File source/build-exe.ps1`
  （`-SkipFrontend` 可跳过前端；需要 `pnpm`/`npm` 与 Rust 工具链）
- `source/**/*.ps1` 一律保存为 **UTF-8 with BOM**：Windows PowerShell 5.1 会按 ANSI
  解码无 BOM 的中文内容，导致脚本语法错误。


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

## 🎨 界面风格

面板整体以 **HarmonyOS 控制中心**为视觉基准统一重制，明暗双主题均按同一套令牌渲染：

| 维度 | 规范 |
| --- | --- |
| 配色 | 品牌蓝 `#007DFF`（按下 `#0A59F7`），冷调浅灰底 + 柔和光斑；深色为近黑底 + 蓝紫光斑 |
| 圆角 | 8 / 12 / 16 / 20 / 24 / 28px，按钮与开关一律全圆角胶囊，图标容器为圆形 |
| 材质 | 半透明磨砂白卡片（`blur(30px) saturate(180%)`）+ 上缘高光描边 |
| 动效 | 统一鸿蒙摩擦曲线 `cubic-bezier(0.2, 0, 0.2, 1)`，150 / 250 / 350ms 三档时长 |
| 指针光效 | 鼠标指针作为点光源，按距离照亮范围内所有卡片（软光斑 + 边缘环高光，见下） |
| 自定义指针 | 复刻 [leafmy.top](https://leafmy.top) 的 Win11 概念指针：亮色黑边白体 / 暗色白边黑体（见下） |

### 指针光效

复刻自 [leafmy.top](https://leafmy.top) 管理控制台的鼠标悬停光效，替换了原先的「压感光效」：

- **一个光源照亮范围内所有卡片** —— 指针到每张卡片矩形的最近距离决定强度，
  在卡片内恒为 1，越远越淡（`(1 − d/R)²`，感应半径 280px），近处亮得明显、远处柔和收敛。
- **每张卡片两层跟随指针的光** —— 软光斑（420px 正圆强羽化，背景洗光）+ 1.6px 边缘环上的
  高光（`mask` 环 + 380px 羽化圆），光心始终指向指针，因此同一屏内的卡片会被同一个光源串起来。
- **只平移、不重绘** —— 光心用 `transform: translate3d()` 走合成器，透明度由 `--card-light(0~1)`
  控制（变化超过 0.004 才写样式）；不在 `radial-gradient` 坐标上改 CSS 变量，避免每帧重绘渐变
  导致的拖影与跳动。
- **动态卡片自动接管** —— `MutationObserver` 观察 `.app` 子树，分页、切页、列表刷新后新增的
  卡片会在 80ms 防抖内自动挂上光层；指针离开窗口 / 失焦 / 缩放时全部熄灭并归位。

实现位于 `source/panel-frontend/src/card-light.ts` + `src/styles/harmonyos.css` 第 14 节
（`.card-light` / `.card-light-blob` / `.card-light-edge`）。卡片本身不需要写任何光效代码，
脚本按选择器（导航项、统计卡、面板、资源卡、列表行、按钮、输入框…）统一装饰。
深色模式下光斑与边缘高光各有一套降饱和剖面，避免在近黑卡片上过曝；
`prefers-reduced-motion` 下只保留透明度淡入淡出，不做位移过渡。

### 自定义指针

复刻自 [leafmy.top](https://leafmy.top) 的 `/custom/cursor/site-cursor.js`（Win11 概念指针）：
圆润三角箭头，`-45°` 旋转后朝左上，`pointermove` 里直接写 `transform` 跟随（零延迟），
按下缩放 0.9，指针离开窗口 / 窗口失焦时淡出，触屏设备整体降级为系统指针。

| 主题 | 描边 | 填充 |
| --- | --- | --- |
| 亮色模式 | 黑色 | 白色 |
| 暗色模式 | 白色 | 黑色 |

- **配色随主题自动切换** —— 站点是彩虹流光渐变填充，星野换成单色描边体，
  颜色写在 `src/styles/custom-cursor.css` 里按 `html.dark` 分组，脚本不感知主题，
  切换明暗时无需重绘指针。
- **热点按几何对齐** —— 站点把元素放在 `(clientX - 2, clientY - 2)`，但 `-45°` 旋转后
  箭头尖端实际落在元素内 `(4.73, 4.73)` 处，视觉上比真实指针偏右下约 2.7px；
  星野按 `viewBox / 尺寸 / 旋转角` 算出尖端坐标，让尖端压在指针上。
- **点击缩放真正生效** —— 站点的 `scale(0.9)` 写在会被内联 `transform` 覆盖的类上，
  从未生效；这里改为外层元素只做平移、内层 `svg` 做旋转 + 缩放，两者互不干扰。
- **只在就绪后隐藏系统指针** —— 由 `html.has-custom-cursor` 控制（脚本注入），
  脚本异常时面板仍保留系统指针，不会出现「没有指针」的失控状态。

实现位于 `source/panel-frontend/src/custom-cursor.ts` + `src/styles/custom-cursor.css`，
在 `main.ts` 中随主题层一起导入；主窗口与「App 设置」窗口共用同一份实现。

## ⚠️ 注意事项

- 目录结构与程序内的路径解析严格绑定：`xingye.exe` 同级必须保留 `app/`、`node/`、`SnowLuma/`，请勿单独移动其中某一项。
- 移动、重命名或拷贝**整个**文件夹不会影响运行（全部为相对路径解析）。
- 首次使用**原神攻略**（`gs <角色名>` / `<角色名>面板`）时需要联网下载一次数据，
  之后走本地缓存；离线环境下这些指令会提示「数据尚未就绪」，其余功能不受影响。
- 本目录只包含可运行程序与运行依赖；开发源码在 `source/`，构建方式见上一节。

## 📜 免责声明

本项目通过非官方方式（进程注入）接入 QQ，仅供学习与技术研究。
使用本项目产生的任何账号风险（包括封禁）由使用者自行承担。请勿用于商业或违法用途。

---

<div align="center">

**星野 Xingye** · Made with ❤️ and Tauri

</div>
