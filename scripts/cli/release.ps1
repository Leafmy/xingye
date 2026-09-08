$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
& node (Join-Path $PSScriptRoot 'scripts\release.js') @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
