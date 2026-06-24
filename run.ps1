# Launch the Marker Editor: FastAPI backend (port 8137) + Vite frontend (port 5173).
# Usage:  powershell -ExecutionPolicy Bypass -File run.ps1
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "Starting backend on http://127.0.0.1:8137 ..." -ForegroundColor Cyan
$backend = Start-Process -PassThru -WorkingDirectory "$root\backend" `
  -FilePath "$root\backend\venv\Scripts\python.exe" `
  -ArgumentList "-m","uvicorn","app.main:app","--port","8137"

Write-Host "Starting frontend on http://localhost:5173 ..." -ForegroundColor Cyan
$frontend = Start-Process -PassThru -WorkingDirectory "$root\frontend" `
  -FilePath "cmd.exe" -ArgumentList "/c","npm","run","dev"

Write-Host ""
Write-Host "Open http://localhost:5173 in your browser." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop, then close the spawned windows." -ForegroundColor Yellow
Wait-Process -Id $frontend.Id
Stop-Process -Id $backend.Id -ErrorAction SilentlyContinue
