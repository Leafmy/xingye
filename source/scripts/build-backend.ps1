# ============================================================
# 星野 Xingye · 后端编译脚本
#
# 用法:
#   pwsh -File source/scripts/build-backend.ps1                 # 编译到 app/bot-backend/dist
#   pwsh -File source/scripts/build-backend.ps1 -OutDir <dir>   # 编译到指定目录（用于校验）
#
# 说明:
#   - 源码根目录 source/bot-backend 只跟踪 .ts，不含 node_modules；
#     依赖解析借道 app/bot-backend/node_modules（运行时依赖已安装在那里）。
#   - TypeScript 编译器优先取 source/bot-backend/node_modules，其次
#     source/panel-frontend/node_modules，最后回退全局 tsc。
#   - 默认用 --noCheck 只做发射：发布目录是从生产安装（无 devDependencies）里
#     取 node_modules 的，@types/* 并不存在，做全量类型检查必然报错且无意义。
#     需要类型检查时显式加 -TypeCheck（要求先装好 devDependencies）。
# ============================================================

param(
  [string]$OutDir = '',
  [switch]$Clean,
  [switch]$TypeCheck
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$srcDir = Join-Path $repoRoot 'source\bot-backend'
$depsDir = Join-Path $repoRoot 'app\bot-backend'
$depsModules = Join-Path $depsDir 'node_modules'

if (-not $OutDir) { $OutDir = Join-Path $depsDir 'dist' }
if (-not [System.IO.Path]::IsPathRooted($OutDir)) { $OutDir = Join-Path $repoRoot $OutDir }

# ---------- 定位 node ----------
function Resolve-Node {
  $bundled = Join-Path $repoRoot 'node\node.exe'
  if (Test-Path $bundled) { return $bundled }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $fallback = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path $fallback) { return $fallback }
  throw '未找到 node.exe（请确认 node/ 目录存在，或把 node 加入 PATH）'
}

# ---------- 定位 tsc ----------
function Resolve-Tsc {
  $candidates = @(
    (Join-Path $srcDir 'node_modules\typescript\lib\tsc.js'),
    (Join-Path $repoRoot 'source\panel-frontend\node_modules\typescript\lib\tsc.js')
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  throw '未找到 TypeScript 编译器：请在 source/bot-backend 或 source/panel-frontend 下安装 typescript'
}

$node = Resolve-Node
$tsc = Resolve-Tsc

Write-Host "[build-backend] node: $node"
Write-Host "[build-backend] tsc : $tsc"
Write-Host "[build-backend] out : $OutDir"

if ($Clean -and (Test-Path $OutDir)) {
  Remove-Item $OutDir -Recurse -Force
}

# ---------- 编译 ----------
# 在源码目录旁建一个临时构建根，用 junction 指向运行时 node_modules，
# 这样 TS 的模块解析（express / ws / undici …）与真实部署一致。
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("xingye-backend-build-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $stage | Out-Null

try {
  Copy-Item (Join-Path $srcDir '*.ts') $stage
  Copy-Item (Join-Path $srcDir 'tsconfig.json') $stage
  foreach ($sub in 'genshin-guide') {
    $p = Join-Path $srcDir $sub
    if (Test-Path $p) { Copy-Item $p $stage -Recurse }
  }
  # 源码里可能残留的编译产物/缓存不入编译
  Get-ChildItem $stage -Recurse -Directory -Include dist, miao-data, liangshi-data, node_modules -ErrorAction SilentlyContinue |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

  if (Test-Path $depsModules) {
    New-Item -ItemType Junction -Path (Join-Path $stage 'node_modules') -Target $depsModules | Out-Null
  } else {
    Write-Warning '未找到 app/bot-backend/node_modules，类型解析可能失败'
  }

  # @types/node 不一定随运行依赖安装（生产安装会剔除 devDependencies），
  # 因此把面板前端的 @types 也纳入类型根。
  $typeRoots = @()
  foreach ($root in @((Join-Path $depsModules '@types'), (Join-Path $repoRoot 'source\panel-frontend\node_modules\@types'))) {
    if (Test-Path $root) { $typeRoots += $root }
  }

  $tscArgs = @('-p', (Join-Path $stage 'tsconfig.json'), '--outDir', $OutDir)
  if ($typeRoots.Count -gt 0) { $tscArgs += @('--typeRoots', ($typeRoots -join ',')) }
  if (-not $TypeCheck) { $tscArgs += '--noCheck' }

  & $node $tsc @tscArgs 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { throw "TypeScript 编译失败 (exit $LASTEXITCODE)" }
} finally {
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}

$files = Get-ChildItem $OutDir -Recurse -File -Filter *.js
Write-Host "[build-backend] 完成：$($files.Count) 个产物 → $OutDir" -ForegroundColor Green

# ---------- 非 TS 资源 ----------
# 模板/CSS 这类资源 tsc 不会搬运。历史上 dist 里就缺了 genshin-guide/templates，
# 导致「gs <角色>」的攻略图渲染必然抛 ENOENT 并静默降级为纯文本。
$assets = @()
foreach ($rel in @('genshin-guide\templates')) {
  $src = Join-Path $srcDir $rel
  if (-not (Test-Path $src)) { continue }
  $dst = Join-Path $OutDir $rel
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item (Join-Path $src '*') $dst -Recurse -Force
  $assets += (Get-ChildItem $dst -Recurse -File)
}
if ($assets.Count -gt 0) {
  Write-Host "[build-backend] 同步 $($assets.Count) 个资源文件（模板 / CSS）" -ForegroundColor Green
}
