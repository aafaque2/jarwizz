<#
  Jarwizz v1 launcher (Windows).
  Starts the local model runtime (llama.cpp, Vulkan) and the backend together.
  Optional: -Voice to also launch the voice service in a new window.

  Usage:
    .\scripts\start-jarwizz.ps1            # model + backend
    .\scripts\start-jarwizz.ps1 -Voice     # + voice service
#>
param(
  [switch]$Voice
)

$ErrorActionPreference = 'Stop'

# ---- Config (override via env if needed) ----
$LlamaExe = $env:LLAMA_SERVER_EXE
if (-not $LlamaExe) {
  # Prebuilt Vulkan llama.cpp used during development
  $LlamaExe = 'C:\Users\aafaq\AppData\Local\Temp\opencode\llama-b10612-vulkan\llama-server.exe'
}
$RepoRoot   = Split-Path -Parent $PSScriptRoot
$BackendDir = (Resolve-Path (Join-Path $RepoRoot 'backend')).Path
$VoiceDir   = (Resolve-Path (Join-Path $RepoRoot 'voice-service')).Path

function Wait-ForUrl($url, $timeoutSec = 120) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try { $r = Invoke-RestMethod -Uri $url -TimeoutSec 3; return $true } catch {}
    Start-Sleep -Seconds 2
  }
  return $false
}

# ---- 1. Model runtime ----
if (Wait-ForUrl 'http://127.0.0.1:8080/health' 2) {
  Write-Host '[LAUNCH] llama-server already running, skipping start.' -ForegroundColor Gray
} else {
  Write-Host '[LAUNCH] Starting llama.cpp (Vulkan)...' -ForegroundColor Cyan
  if (-not (Test-Path $LlamaExe)) {
    Write-Error ('llama-server.exe not found at ' + $LlamaExe + ' (set $env:LLAMA_SERVER_EXE)')
    exit 1
  }
  $llamaArgs = @(
    '--hf-repo', 'Qwen/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M',
    '--ctx-size', '2048', '--host', '127.0.0.1', '--port', '8080',
    '--gpu-layers', '5', '--device', 'Vulkan1'
  )
  $llama = Start-Process -FilePath $LlamaExe -ArgumentList $llamaArgs -PassThru -WindowStyle Hidden
  Write-Host ('[LAUNCH] llama-server PID ' + $llama.Id)
  if (-not (Wait-ForUrl 'http://127.0.0.1:8080/health' 150)) {
    Write-Warning 'llama.cpp did not become healthy in time. Check its logs. Continuing anyway.'
  }
}

# ---- 2. Backend ----
if (Wait-ForUrl 'http://127.0.0.1:4000/health' 2) {
  Write-Host '[LAUNCH] backend already running, skipping start.' -ForegroundColor Gray
} else {
  Write-Host '[LAUNCH] Starting backend (node src/server.js)...' -ForegroundColor Cyan
  $bp = Start-Process -FilePath 'node' -ArgumentList 'src/server.js' -WorkingDirectory $BackendDir -PassThru -WindowStyle Hidden
  Write-Host ('[LAUNCH] backend PID ' + $bp.Id)
  if (-not (Wait-ForUrl 'http://127.0.0.1:4000/health' 30)) {
    Write-Error 'Backend failed to start. Check backend logs.'
    exit 1
  }
}
$health = Invoke-RestMethod -Uri 'http://127.0.0.1:4000/health' -TimeoutSec 5
Write-Host ('[LAUNCH] Backend up. gmail=' + $health.gmail) -ForegroundColor Green

# ---- 3. Voice (optional) ----
if ($Voice) {
  Write-Host '[LAUNCH] Starting voice service...' -ForegroundColor Cyan
  $venvPy = Join-Path $VoiceDir 'venv' | Join-Path -ChildPath 'Scripts' | Join-Path -ChildPath 'python.exe'
  if (Test-Path $venvPy) {
    Start-Process -FilePath $venvPy -ArgumentList 'main.py' -WorkingDirectory $VoiceDir -PassThru
    Write-Host '[LAUNCH] Voice service window opened. Hold Ctrl+Shift to talk.' -ForegroundColor Green
  } else {
    Write-Warning ('Voice venv not found at ' + $venvPy + ' - skipping voice launch.')
  }
}

Write-Host ''
Write-Host '[LAUNCH] Jarwizz v1 is running.' -ForegroundColor Green
Write-Host '  Model:  http://127.0.0.1:8080   Backend: http://127.0.0.1:4000' -ForegroundColor Gray
Write-Host '  Stop everything with: .\scripts\stop-jarwizz.ps1' -ForegroundColor Gray
