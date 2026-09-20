# DinoEngine v0.8

DinoEngine v0.8 is a GPT-controlled visual development engine for professional websites, 2D games and build artifacts.

## Professional drawing toolkit
Structured drawing documents support:
- select, move, scale, rotate and transform
- pen, pencil and brush
- eraser
- line, rectangle, rounded rectangle, ellipse, polygon and star
- Bezier/path drawing
- text
- fill, gradient and eyedropper
- crop, hand and zoom
- ruler, grid, guides and snapping
- layers, visibility, lock, groups and duplication
- undo/redo snapshots
- image import and SVG/PNG-oriented export workflows
- animation timelines and CSS animation export

GPT can use `draw_create`, `draw_read`, `draw_export_svg` and `draw_tools` to turn a rough visual design into production UI.

## Essential Godot 2D tooling
DinoEngine can create and operate projects using an installed Godot toolchain. The feature plan covers:
- scene tree / nodes
- Sprite2D and AnimatedSprite2D
- TileMap / TileMapLayer
- CharacterBody2D, RigidBody2D and Area2D
- collision shapes and physics
- Camera2D
- AnimationPlayer and AnimationTree
- audio
- particles
- UI/Control nodes
- signals
- input actions
- resources
- GDScript
- debugging and pause
- save/load
- export presets
- run/play

Tools: `godot_project`, `godot_scene`, `godot_tool`, `godot_feature_plan`.

## Engine self-modification
`engine_patch` lets GPT deliberately modify DinoEngine source. GPT can patch/add a feature, build/test it, inspect errors, commit the result and continue.

## ChatGPT plugin/app connection
The engine exposes MCP. For current ChatGPT integration, package it as a custom MCP app using Developer Mode/Apps SDK. ChatGPT connects to a **remote MCP server**, not directly to `127.0.0.1`; for a local Windows engine use a supported Secure MCP Tunnel or another secure remote HTTPS MCP endpoint.

The included `gpt-connector.json` is a configuration manifest, not an automatic registration. Publishing/connecting is controlled by ChatGPT workspace/app permissions.

## Security
The engine is localhost-only by default and workspace paths are restricted. Review write, execute and deployment actions before connecting it to an AI service.
