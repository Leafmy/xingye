<#
 星野 Xingye · 桌面端 exe 构建脚本（独立发布模式）

 做三件事：
   1. 构建面板前端（Vite 产物 → source/panel-frontend/dist）
   2. 构建 Tauri 壳（该产物会被内嵌进 exe，见 src-tauri/tauri.conf.json 的 frontendDist）
   3. 把 exe 复制到仓库根目录（绿色发布版入口）

 用法（本机只安装了 Windows PowerShell 5.1，pwsh 7 未安装）：
   powershell -ExecutionPolicy Bypass -File source/build-exe.ps1
   powershell -ExecutionPolicy Bypass -File source/build-exe.ps1 -SkipFrontend

 编码要求（务必保留）：
   本文件必须以 "UTF-8 with BOM" 保存。PS 5.1 对无 BOM 的 UTF-8 会按 ANSI 解码，
   中文串尾的省略号 `…` 会吞掉后面的引号，报“字符串缺少终止符”语法错误而无法运行。

 关于 bundle.resources：
   tauri.conf.json 里的 resources 只描述「安装包/运行目录里各文件放哪儿」。
   现在使用映射语法（源 → 目标），把资源落到运行时真正解析的位置：
     node/ 、app/bot-backend/{dist,node_modules,BBDown} 、app/panel-frontend/dist 、
     app/{updater,version.json,manifest.json} 、SnowLuma/
   这些正是 Rust 侧 resource_dir() 与 bot-backend 的 __dirname 相对路径所期望的布局
   （见 src-tauri/src/process.rs 与 app/bot-backend/dist/index.js 的 APP_ROOT 推导）。

 历史遗留问题（已消除）：
   a) 旧配置用数组 + `/**/*` 通配，资源会被放到 target/release/_up_/_up_/app/… 下，
      与运行时解析路径完全对不上（装到 Program Files 后 node/、SnowLuma/、dist/ 全部找不到）；
      改用映射语法后落点正确，`cargo build --release` 直接产出可运行目录。
   b) 旧脚本用 $env:TAURI_CONFIG='{"bundle":{"resources":[]}}' 把 resources 置空，
      以绕开 tauri-build 复制 app/bot-backend/dist/genshin-guide/ 下中文文件名时
      build script 报 exit 5 的问题。该问题在当前工具链上已无法复现：
      tauri-build 2.6.3 已完整复制 448MB / 4517 个文件（含 121 个中文名目录），exit 0；
      最深路径 187 字符，未触及 MAX_PATH。故该 hack 已移除，构建链可重现。
      若日后改回数组 + 通配语法又遇到 exit 5，优先怀疑目标文件被进程占用，而非文件名编码。
#>

param(
  [switch]$SkipFrontend
)

$ErrorActionPreference = 'Stop'
$sourceDir = $PSScriptRoot
$repoRoot = Split-Path $sourceDir -Parent
$frontendDir = Join-Path $sourceDir 'panel-frontend'
$tauriDir = Join-Path $sourceDir 'src-tauri'

if (-not (Test-Path (Join-Path $repoRoot 'xingye.exe'))) {
  Write-Warning "仓库根目录未找到 xingye.exe，将直接生成新文件。"
}

# ---------- 1. 前端 ----------
if (-not $SkipFrontend) {
  Write-Host '[1/3] 构建面板前端…' -ForegroundColor Cyan
  Push-Location $frontendDir
  try {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
      pnpm install
      pnpm build
    } else {
      npm install
      npm run build
    }
  } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }
} else {
  Write-Host '[1/3] 跳过前端构建' -ForegroundColor DarkGray
}

# ---------- 2. Tauri 壳 ----------
Write-Host '[2/3] 构建 Tauri 壳（Rust release）…' -ForegroundColor Cyan
Push-Location $tauriDir
try {
  # 直接在 tauri.conf.json 的 resources 生效状态下构建：
  # 映射语法会把 node/、app/、SnowLuma/ 复制到 target/release 下的正确位置，
  # 与发布目录（仓库根）布局一致；不再需要 TAURI_CONFIG 覆盖。
  cargo build --release
  if ($LASTEXITCODE -ne 0) { throw 'Tauri 构建失败' }
} finally {
  Pop-Location
}

# ---------- 3. 复制到根目录 ----------
Write-Host '[3/3] 复制 exe 到仓库根目录…' -ForegroundColor Cyan
$built = Join-Path $tauriDir 'target\release\xingye.exe'
if (-not (Test-Path $built)) { throw "未找到构建产物：$built" }
Copy-Item $built (Join-Path $repoRoot 'xingye.exe') -Force

Write-Host ''
Write-Host '构建完成：' -ForegroundColor Green
Write-Host ("  exe  : " + (Join-Path $repoRoot 'xingye.exe'))
Write-Host ("  大小 : " + [math]::Round((Get-Item (Join-Path $repoRoot 'xingye.exe')).Length / 1MB, 1) + ' MB')
Write-Host '  提示 : 面板 UI 已内嵌进 exe，改动前端后需重新执行本脚本。'
