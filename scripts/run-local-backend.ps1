param(
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][int]$FrontendPort
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot 'backend'
$python = Join-Path $backendDir '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $python)) {
    throw "Không tìm thấy Python environment: $python"
}

$Host.UI.RawUI.WindowTitle = "YouTube Subtitle Manager - Backend :$Port"
$env:FRONTEND_URL = "http://localhost:$FrontendPort"
Push-Location $backendDir
try {
    & $python -m uvicorn app.main:app --host 127.0.0.1 --port $Port --no-access-log
    if ($LASTEXITCODE -ne 0) {
        throw "Backend thoát với mã lỗi $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}
