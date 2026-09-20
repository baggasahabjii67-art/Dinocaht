# DinoEngine v0.4 — GPT-controlled Windows engine

DinoEngine is a localhost development engine with a DinoMCP/1.0 bridge.

## v0.4 capabilities
- Workspace tree
- Read/write/delete files
- Create folders
- Run commands
- Runtime detection
- Project inspection
- Git status/log/diff/branch
- Git checkout, commit, push and pull
- MCP JSON-RPC endpoint at /mcp
- Tool discovery with tools/list
- Health endpoint
- Standalone Windows x64 EXE
- Automated Windows EXE smoke test

## Run
Set DINOENGINE_ROOT to the project DinoEngine should control, then run DinoEngine.exe.

Default endpoint:
http://127.0.0.1:4387

MCP endpoint:
http://127.0.0.1:4387/mcp

The engine is localhost-only by default.