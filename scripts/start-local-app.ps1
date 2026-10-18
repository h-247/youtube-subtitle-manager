$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $env:LOCALAPPDATA 'YouTubeSubtitleManager'
$statePath = Join-Path $runtimeDir 'local-app.json'
$launcherShell = (Get-Process -Id $PID).Path

function Test-ListeningPort([int]$Port) {
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Find-FreePort([int]$StartPort) {
    for ($candidate = $StartPort; $candidate -lt ($StartPort + 30); $candidate++) {
        if (-not (Test-ListeningPort $candidate)) { return $candidate }
    }
    throw "Không tìm thấy cổng trống từ $StartPort đến $($StartPort + 29)."
}

function Test-ExpectedBackend([int]$Port) {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/" -TimeoutSec 2
        return $response.message -eq 'Welcome to YouTube Subtitle Manager API'
    } catch { return $false }
}

function Test-ExpectedFrontend([int]$Port) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -TimeoutSec 3 -UseBasicParsing
        return $response.StatusCode -eq 200 -and $response.Content.Contains('YouTube Subtitle Manager')
    } catch { return $false }
}

function Start-ServiceWindow([string]$ScriptPath, [int]$Port, [int]$PeerPort) {
    $arguments = @(
        '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$ScriptPath`"",
        '-Port', $Port, '-FrontendPort', $PeerPort
    )
    if ($ScriptPath.EndsWith('run-local-frontend.ps1')) {
        $arguments = @(
            '-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$ScriptPath`"",
            '-Port', $Port, '-BackendPort', $PeerPort
        )
    }
    return Start-Process -FilePath $launcherShell -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
}

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$backendPort = $null
$frontendPort = $null
$backendPid = $null
$frontendPid = $null

if (Test-Path -LiteralPath $statePath) {
    try {
        $saved = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
        if ((Test-ListeningPort ([int]$saved.backendPort)) -and (Test-ExpectedBackend ([int]$saved.backendPort))) {
            $backendPort = [int]$saved.backendPort
            $backendPid = [int]$saved.backendPid
        }
        if ((Test-ListeningPort ([int]$saved.frontendPort)) -and (Test-ExpectedFrontend ([int]$saved.frontendPort))) {
            $frontendPort = [int]$saved.frontendPort
            $frontendPid = [int]$saved.frontendPid
        }
    } catch { }
}

$plannedFrontendPort = if ($frontendPort) { $frontendPort } else { Find-FreePort 3001 }

if (-not $backendPort) {
    $candidate = Find-FreePort 8001
    $process = Start-ServiceWindow (Join-Path $PSScriptRoot 'run-local-backend.ps1') $candidate $plannedFrontendPort
    $backendPort = $candidate
    $backendPid = $process.Id
    Write-Host "Đang khởi động backend ở http://127.0.0.1:$backendPort ..."
} else {
    Write-Host "Backend đã chạy ở http://127.0.0.1:$backendPort"
}

if (-not $frontendPort) {
    $candidate = $plannedFrontendPort
    $process = Start-ServiceWindow (Join-Path $PSScriptRoot 'run-local-frontend.ps1') $candidate $backendPort
    $frontendPort = $candidate
    $frontendPid = $process.Id
    Write-Host "Đang khởi động frontend ở http://localhost:$frontendPort ..."
} else {
    Write-Host "Frontend đã chạy ở http://localhost:$frontendPort"
}

@{
    backendPort = $backendPort
    backendPid = $backendPid
    frontendPort = $frontendPort
    frontendPid = $frontendPid
} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

$apiReady = $false
$frontendReady = $false
for ($attempt = 0; $attempt -lt 90; $attempt++) {
    if (-not $apiReady) {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$backendPort/health" -TimeoutSec 2
            $apiReady = $health.status -eq 'healthy'
        } catch { }
    }
    if (-not $frontendReady) { $frontendReady = Test-ExpectedFrontend $frontendPort }
    if ($apiReady -and $frontendReady) { break }
    Start-Sleep -Seconds 1
}

Write-Host "Backend:  http://127.0.0.1:$backendPort/health  $(if ($apiReady) {'OK'} else {'chưa phản hồi'})"
Write-Host "Frontend: http://127.0.0.1:$frontendPort  $(if ($frontendReady) {'OK'} else {'đang khởi động'})"
Start-Process "http://127.0.0.1:$frontendPort"
Write-Host 'Có thể đóng cửa sổ launcher này; giữ hai cửa sổ Backend và Frontend mở khi sử dụng.'
