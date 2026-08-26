<#
  Jarwizz log viewer — a lightweight tmux-style combined tail.
  Shows llama-server, backend, voice and frontend logs in ONE console window,
  each line prefixed and colored by service.

  Usage:
    powershell -NoProfile -File scripts\tail-logs.ps1          # follow all logs
    powershell -NoProfile -File scripts\tail-logs.ps1 -Once    # print what exists now, exit
#>
param(
  [switch]$Once
)

$RepoRoot = Split-Path -Parent $PSScriptRoot
$RunDir   = Join-Path $RepoRoot '.run'

$services = @(
  @{ Name = 'llama';    File = 'llama-server.log';     Color = 'Cyan' },
  @{ Name = 'backend';  File = 'backend.log';          Color = 'Green' },
  @{ Name = 'voice';    File = 'voice.log';            Color = 'Yellow' },
  @{ Name = 'frontend'; File = 'frontend.log';         Color = 'Magenta' },
  @{ Name = 'errors';   File = 'backend.err.log';      Color = 'Red' }
)

$state = @{}
foreach ($s in $services) {
  $path = Join-Path $RunDir $s.File
  if (Test-Path $path) {
    # start at the end: show only new lines (use -Tail 15 to catch up instead)
    $state[$s.File] = (Get-Item $path).Length
  } else {
    $state[$s.File] = -1   # file doesn't exist yet; watch for creation
  }
}

function Write-ServiceLine($svc, $line) {
  Write-Host ("[{0}] " -f $svc.Name) -NoNewline -ForegroundColor $svc.Color
  Write-Host $line
}

Write-Host ''
Write-Host '=== Jarwizz logs - Ctrl+C to exit ===' -ForegroundColor White
Write-Host ''

while ($true) {
  foreach ($s in $services) {
    $path = Join-Path $RunDir $s.File
    if (-not (Test-Path $path)) { continue }
    try { $len = (Get-Item $path -ErrorAction Stop).Length } catch { continue }

    if ($state[$s.File] -eq -1) {
      # newly created — only follow from here on
      $state[$s.File] = $len
      continue
    }
    if ($len -lt $state[$s.File]) { $state[$s.File] = 0 }   # truncated/rotated

    if ($len -gt $state[$s.File]) {
      try {
        $fs = [System.IO.FileStream]::new($path, 'Open', 'Read', 'ReadWrite')
        $fs.Seek($state[$s.File], 'Begin') | Out-Null
        $reader = [System.IO.StreamReader]::new($fs)
        while ($null -ne ($line = $reader.ReadLine())) {
          Write-ServiceLine $s $line
        }
        $state[$s.File] = $fs.Position
        $reader.Close()
      } catch {}
    }
  }
  if ($Once) { break }
  Start-Sleep -Milliseconds 500
}
