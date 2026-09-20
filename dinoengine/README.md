# DinoEngine v0.2

V2 adds runtime detection and a broader AI-oriented local development API.

Capabilities:
- Recursive project tree/file inventory
- Read, create, overwrite and delete files
- Recursive folder creation
- Run commands with workspace and timeout
- Detect common language runtimes: Node, npm, Python, Java, C/C++, Go, Rust, .NET, PHP, Ruby and PowerShell
- Inspect project metadata
- Git status, log, diff and branch creation
- Health endpoint
- Local-only binding by default

Run:
node server.js

Optional workspace on Windows:
set DINOENGINE_ROOT=C:\path\to\project
node server.js

API: http://127.0.0.1:4387

V3 target: native MCP transport, structured permissions, build/test orchestration and Windows EXE packaging.