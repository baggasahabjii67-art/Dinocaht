# DinoEngine v0.7 — professional web + Godot 2D engine

DinoEngine v0.7 expands the GPT-controlled development engine with professional web-building helpers, engine self-modification, Godot 2D project tooling and a branded dinosaur EXE icon.

## Professional website tools
- `professional_scaffold` — generates a responsive, semantic, accessible starter with navigation, hero, cards, responsive CSS, reduced-motion handling and clean structure.
- `website_audit` — checks common production issues such as viewport, title, language and missing image alt text.
- Existing file, Git, build, deployment, paint and animation tools remain available.
- GPT can combine these tools into a design → code → audit → fix → build → publish loop.

## Engine modification
- `engine_patch` explicitly lets GPT modify DinoEngine source.
- GPT can add a feature, patch a bug, run the engine build/tests, commit the change and continue improving the engine.
- File operations remain confined to `DINOENGINE_ROOT`.

## Godot 2D
- `godot_create_2d` creates a small Godot 2D starter project with `project.godot`, a scene and GDScript.
- `godot_run` launches the installed Godot command/editor.
- `godot_export` exports using an installed Godot preset.
- The engine uses the installed Godot SDK/editor rather than embedding Godot itself.

## EXE branding
The Windows build generates a DinoEngine dinosaur icon and applies it to `DinoEngine.exe` during GitHub Actions packaging.

## MCP / GPT
- Local endpoint: `http://127.0.0.1:4387/mcp`
- Protocol: DinoMCP/1.0 over JSON-RPC.
- A compatible ChatGPT connector still has to be configured; the EXE alone does not automatically register itself as a ChatGPT plugin.

## Security
DinoEngine is localhost-only by default. Commands run with the local user's permissions, so only connect an AI to a workspace you trust.
