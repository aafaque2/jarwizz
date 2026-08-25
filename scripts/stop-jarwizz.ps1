<#
  Jarwizz v1 stopper (Windows). Kills the model runtime + backend started by start-jarwizz.ps1.
  Uses command-line matching so it only stops Jarwizz processes, not every node/llama.
#>
$ErrorActionPreference = 'Continue'

# Backend: node running src/server.js
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" | Where-Object {
  $_.CommandLine -like '*src/server.js*'
} | ForEach-Object {
  Write-Host "[STOP] killing backend PID $($_.ProcessId)"
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

# Model runtime
Get-Process -Name 'llama-server' -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Host "[STOP] killing llama-server PID $($_.ProcessId)"
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

# Voice service (python main.py in voice-service)
Get-CimInstance Win32_Process -Filter "name = 'python.exe'" | Where-Object {
  $_.CommandLine -like '*voice-service*main.py*'
} | ForEach-Object {
  Write-Host "[STOP] killing voice PID $($_.ProcessId)"
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Host '[STOP] Done.' -ForegroundColor Green
