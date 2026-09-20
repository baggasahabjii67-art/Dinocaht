# DinoEngine v0.6 — GPT visual web/app builder
DinoEngine v0.6 adds a visual design layer, animation timelines and artifact building.

## One-prompt workflow
GPT can plan a professional UI, create files, use the paint canvas as a design layer, generate animations from keyframes, run builds/tests, fix errors, Git commit/push and publish.

## Visual tools
- `ui_paint`: stores hand-drawn strokes/paint notes that GPT can use as a UI reference.
- `ui_read`: reads saved design canvases.
- `ui_export_svg`: converts a painted canvas into SVG.
- `animation_create`: creates named timelines with tracks and keyframes.
- `animation_read`: reads timelines.
- `animation_export_css`: converts keyframes into CSS @keyframes.

Example animation keyframe shape:
`{"tracks":[{"target":".hero","keyframes":[{"at":0,"css":{"opacity":0,"transform":"translateY(30px)"}},{"at":700,"css":{"opacity":1,"transform":"translateY(0)"}}]}]}`

## App/file building
- `build_artifact` supports EXE, APK, AAB, or a custom command.
- EXE/APK/AAB builds use the project's installed toolchain. APK/AAB normally require an Android/Gradle project and Android SDK; EXE requires the project's appropriate packager/build tool.
- A truly universal “any file to EXE/APK” converter is not possible without knowing the source/runtime. DinoEngine instead detects/uses the project's toolchain and accepts custom build commands.

## MCP / GPT
- Local MCP endpoint: http://127.0.0.1:4387/mcp
- Protocol: DinoMCP/1.0 over JSON-RPC
- `gpt-connector.json` describes the connector.
The EXE itself does not automatically become a ChatGPT plugin. A compatible ChatGPT connector must be configured to reach the endpoint; remote access also needs an appropriate secure transport layer.

## Safety
DinoEngine is localhost-only by default and confines file operations to DINOENGINE_ROOT. Commands run with the local user's permissions, so connect it to an AI only when you trust the requested operations.