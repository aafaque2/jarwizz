<#
  Jarwizz v1 launcher (Windows).
  Starts the local model runtime (llama.cpp, Vulkan) and the backend together.
  Optional: -Voice to also launch the voice service, -UI to open the dashboard.

  Usage:
    .\scripts\start-jarwizz.ps1              # model + backend
    .\scripts\start-jarwizz.ps1 -Voice       # + voice service
    .\scripts\start-jarwizz.ps1 -UI          # + desktop shell (orb + dashboard)
    .\scripts\start-jarwizz.ps1 -Voice -UI   # everything
    .\scripts\start-jarwizz.ps1 -Logs        # open combined log viewer (tmux-style)

  All service output is logged to .run\<service>.log — check there when
  something fails to come up.
#>
param(
  [switch]$Voice,
  [switch]$UI,
  [switch]$Logs
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
$FrontendDir = (Resolve-Path (Join-Path $RepoRoot 'frontend')).Path
$RunDir     = Join-Path $RepoRoot '.run'
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

function Wait-ForUrl($url, $timeoutSec = 120) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try { $r = Invoke-RestMethod -Uri $url -TimeoutSec 3; return $true } catch {}
    Start-Sleep -Seconds 2
  }
  return $false
}

function Show-LogTail($name, $lines = 15) {
  $log = Join-Path $RunDir "$name.log"
  if (Test-Path $log) {
    Write-Host "--- last $lines lines of $name.log ---" -ForegroundColor Yellow
    Get-Content $log -Tail $lines | Write-Host
  } else {
    Write-Host "(no $name.log written)" -ForegroundColor Yellow
  }
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
  $llamaOut = Join-Path $RunDir 'llama-server.log'
  $llamaErr = Join-Path $RunDir 'llama-server.err.log'
  $llama = Start-Process -FilePath $LlamaExe -ArgumentList $llamaArgs -PassThru -WindowStyle Hidden `
            -RedirectStandardOutput $llamaOut -RedirectStandardError $llamaErr
  Write-Host ('[LAUNCH] llama-server PID ' + $llama.Id)
  if (-not (Wait-ForUrl 'http://127.0.0.1:8080/health' 150)) {
    Show-LogTail 'llama-server.err'
    Write-Warning 'llama.cpp did not become healthy in time. Continuing anyway.'
  }
}

# ---- 2. Backend ----
if (Wait-ForUrl 'http://127.0.0.1:4000/health' 2) {
  Write-Host '[LAUNCH] backend already running, skipping start.' -ForegroundColor Gray
} else {
  Write-Host '[LAUNCH] Starting backend (node src/server.js)...' -ForegroundColor Cyan
  $beOut = Join-Path $RunDir 'backend.log'
  $beErr = Join-Path $RunDir 'backend.err.log'
  $bp = Start-Process -FilePath 'node' -ArgumentList 'src/server.js' -WorkingDirectory $BackendDir -PassThru -WindowStyle Hidden `
          -RedirectStandardOutput $beOut -RedirectStandardError $beErr
  Write-Host ('[LAUNCH] backend PID ' + $bp.Id)
  if (-not (Wait-ForUrl 'http://127.0.0.1:4000/health' 60)) {
    Show-LogTail 'backend.err'
    Show-LogTail 'backend'
    # Leave it running briefly dead or kill? Kill so stop/start cycles stay clean.
    try { Stop-Process -Id $bp.Id -Force -ErrorAction SilentlyContinue } catch {}
    Write-Error 'Backend failed to start - see the log tail above.'
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
    $vOut = Join-Path $RunDir 'voice.log'
    $vErr = Join-Path $RunDir 'voice.err.log'
    # python -u: unbuffered stdout so the log file updates live
    Start-Process -FilePath $venvPy -ArgumentList '-u', 'main.py' -WorkingDirectory $VoiceDir `
      -WindowStyle Hidden -RedirectStandardOutput $vOut -RedirectStandardError $vErr
    Write-Host '[LAUNCH] Voice service started (log: .run\voice.log). Hold Ctrl+Shift to talk.' -ForegroundColor Green
  } else {
    Write-Warning ('Voice venv not found at ' + $venvPy + ' - skipping voice launch.')
  }
}

# ---- 4. Dashboard UI (optional): Vite + Electron shell ----
if ($UI) {
  if (Wait-ForUrl 'http://localhost:5173' 2) {
    Write-Host '[LAUNCH] Vite dev server already running, skipping start.' -ForegroundColor Gray
  } else {
    Write-Host '[LAUNCH] Starting Vite dev server...' -ForegroundColor Cyan
    $feOut = Join-Path $RunDir 'frontend.log'
    $feErr = Join-Path $RunDir 'frontend.err.log'
    # npm is a .cmd shim — must go through cmd.exe for Start-Process
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm', 'run', 'dev' -WorkingDirectory $FrontendDir `
      -WindowStyle Hidden -RedirectStandardOutput $feOut -RedirectStandardError $feErr
    if (-not (Wait-ForUrl 'http://localhost:5173' 30)) {
      Show-LogTail 'frontend.err'
      Write-Warning 'Dashboard dev server did not come up - see the log tail above.'
    }
  }
  if (Wait-ForUrl 'http://localhost:5173' 2) {
    Write-Host '[LAUNCH] Opening Jarwizz desktop shell (orb + dashboard)...' -ForegroundColor Cyan
    # Electron reads the dev URL from the environment; the console is hidden,
    # the app windows themselves are visible.
    $env:ELECTRON_RENDERER_URL = 'http://localhost:5173'
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npx', 'electron', '.' `
      -WorkingDirectory $FrontendDir -WindowStyle Hidden
    Write-Host '[LAUNCH] Dashboard ready: http://localhost:5173' -ForegroundColor Green
  }
}

# ---- 5. Combined log viewer (optional) ----
if ($Logs) {
  Write-Host '[LAUNCH] Opening combined log viewer...' -ForegroundColor Cyan
  Start-Process -FilePath 'powershell' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', (Join-Path $PSScriptRoot 'tail-logs.ps1')
  )
}

Write-Host ''
Write-Host '[LAUNCH] Jarwizz v1 is running.' -ForegroundColor Green
Write-Host '  Model:  http://127.0.0.1:8080   Backend: http://127.0.0.1:4000' -ForegroundColor Gray
Write-Host '  Logs:   .run\' -ForegroundColor Gray
Write-Host '  Stop everything with: .\scripts\stop-jarwizz.ps1' -ForegroundColor Gray
