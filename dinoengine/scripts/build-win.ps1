$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
Write-Host "=== DinoEngine Windows EXE Builder ==="
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is required to build DinoEngine." }
New-Item -ItemType Directory -Force -Path "release" | Out-Null
npm install
npm run package:win
Write-Host ""
Write-Host "Built: release\\DinoEngine.exe"
Write-Host "Run it from a project folder, or set DINOENGINE_ROOT before launch."
