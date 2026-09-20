@echo off
setlocal
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo Downloading Cloudflare tunnel helper...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'; Invoke-WebRequest -Uri $u -OutFile '%~dp0cloudflared.exe'"
)
set "PATH=%~dp0;%PATH%"
set DINOENGINE_AUTO_REMOTE=1
echo Starting DinoEngine remote MCP...
DinoEngine.exe
