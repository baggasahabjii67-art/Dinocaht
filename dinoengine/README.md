# DinoEngine v0.1 Prototype

DinoEngine is a local development engine designed to be controlled by an AI tool layer.

## Prototype capabilities

- Workspace/root discovery
- Recursive project tree
- Read files
- Create/overwrite files
- Delete files
- Create folders
- Run development commands
- Create Git branches
- Read Git status
- JSON API suitable for a future MCP/tool adapter

## Run

Requires Node.js 18+.

```bash
cd dinoengine
node server.js
```

By default the engine listens only on:

`http://127.0.0.1:4387`

Set `DINOENGINE_ROOT` to choose the workspace that the engine controls.

## API

- GET /api/tree
- GET /api/file?path=...
- POST /api/file
- DELETE /api/file
- POST /api/folder
- POST /api/run
- POST /api/git/branch
- GET /api/git/status

The next prototype stage can add an MCP adapter, runtime detection for Node/Python/Java/C/C++/Rust/Go/.NET/PowerShell, build/test orchestration, and a Windows EXE wrapper.
