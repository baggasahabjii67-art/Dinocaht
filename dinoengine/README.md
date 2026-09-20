# DinoEngine v0.3 — Windows EXE

DinoEngine can now be packaged as a standalone Windows executable.

## Build the EXE

Requirements for building:
- Windows
- Node.js 18+
- npm

From this folder:

```powershell
npm install
npm run package:win
```

Output:

`release/DinoEngine.exe`

Or run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-win.ps1
```

## Run the EXE

Open Command Prompt or PowerShell in the project you want DinoEngine to control:

```powershell
$env:DINOENGINE_ROOT = "C:\\MyProject"
.\\DinoEngine.exe
```

If `DINOENGINE_ROOT` is not set, DinoEngine uses the current working directory.

Default API:

`http://127.0.0.1:4387`

The server remains localhost-only by default.

## What this package is

The EXE is the DinoEngine server packaged with its Node runtime, so the target machine does not need Node.js installed just to run the built EXE.

For GPT/agent integration, the next layer is a native MCP adapter/connector. The EXE itself does not automatically become connected to ChatGPT merely by existing on Windows.

## v0.3 capabilities

- Project tree
- File read/write/delete
- Folder creation
- Command execution
- Runtime detection
- Project inspection
- Git status/log/diff/branch
- Health endpoint
- Standalone Windows EXE packaging
