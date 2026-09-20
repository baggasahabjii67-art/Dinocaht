# DinoEngine v0.5 — GPT website builder + publisher

DinoEngine v0.5 turns GPT into a local website-building control layer.

## One-prompt workflow
GPT can use the MCP tools to:
1. Understand the website request.
2. Create the project and folders.
3. Write all HTML/CSS/JS/assets/config files.
4. Run the app/build/tests.
5. Inspect and fix errors.
6. Create or switch Git branches.
7. Commit changes.
8. Publish to GitHub Pages, Vercel, or Netlify when configured.

## MCP
- Local endpoint: http://127.0.0.1:4387/mcp
- Protocol: MCP over JSON-RPC
- Connector manifest: gpt-connector.json

The EXE exposes an MCP server, but an EXE running on a user's PC does not by itself become a ChatGPT plugin. ChatGPT must have a configured connector that can reach the MCP endpoint. For remote ChatGPT access, the endpoint also needs an appropriate secure/public transport layer.

## Website tools
- website_create
- write_files
- website_publish
- deploy_command

Publishing:
- github-pages: commits/pushes a gh-pages branch; GitHub Pages must be enabled for the repository.
- vercel: runs Vercel CLI if installed/authenticated.
- netlify: runs Netlify CLI if installed/authenticated.

## Security
The engine remains localhost-only by default and confines file operations to DINOENGINE_ROOT. Commands execute with the local user's permissions, so only connect it to GPT when you understand and trust the requested actions.