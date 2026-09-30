<#
 星野 Xingye · 桌面端 exe 构建脚本（独立发布模式）

 做三件事：
   1. 构建面板前端（Vite 产物 → source/panel-frontend/dist）
   2. 构建 Tauri 壳（该产物会被内嵌进 exe，见 src-tauri/tauri.conf.json 的 frontendDist）
   3. 把 exe 复制到仓库根目录（绿色发布版入口）

 用法：
   pwsh -File source/build-exe.ps1              # 全量构建
   pwsh -File source/build-exe.ps1 -SkipFrontend # 前端已构建，只重编 Rust 壳

 关于 bundle.resources：
   tauri.conf.json 里的 resources 供 NSIS 安装包使用。本脚本构建时用
   TAURI_CONFIG 覆盖为空，原因有两点：
     a) 绿色发布版把 app/ node/ SnowLuma/ 放在 exe 同级，运行时按相对路径
        解析（Rust 侧 resource_dir() 即 exe 所在目录），无需再复制一份；
     b) tauri-build 复制资源时会在 app/bot-backend/dist/genshin-guide/ 下
        的中文文件名上失败（build script exit 5），导致 cargo build 中断。
   如需产出 NSIS 安装包，请先解决上述中文文件名问题，再执行 `cargo tauri build`。
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
  # 资源已在发布目录中就位；跳过 resources 复制（详见文件头说明）
  $env:TAURI_CONFIG = '{"bundle":{"resources":[]}}'
  cargo build --release
  if ($LASTEXITCODE -ne 0) { throw 'Tauri 构建失败' }
} finally {
  Remove-Item Env:\TAURI_CONFIG -ErrorAction SilentlyContinue
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
