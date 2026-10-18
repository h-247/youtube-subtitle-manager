param(
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][int]$BackendPort
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendDir = Join-Path $repoRoot 'frontend'

if (-not (Test-Path -LiteralPath (Join-Path $frontendDir 'node_modules'))) {
    throw "Không tìm thấy frontend/node_modules. Hãy chạy npm install trong thư mục frontend."
}

$Host.UI.RawUI.WindowTitle = "YouTube Subtitle Manager - Frontend :$Port"
$env:NEXT_PUBLIC_API_URL = "http://127.0.0.1:$BackendPort/api"
Push-Location $frontendDir
try {
    & npm.cmd run dev -- --hostname 127.0.0.1 --port $Port
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend thoát với mã lỗi $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
