const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { exec } = require("child_process");

const PORT = Number(process.env.DINOENGINE_PORT || 4387);
const ROOT = path.resolve(process.env.DINOENGINE_ROOT || process.cwd());

function safePath(input = "") {
  const target = path.resolve(ROOT, input);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    throw new Error("Path escapes DinoEngine workspace");
  }
  return target;
}

function json(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

async function listTree(dir, relative = "") {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const rel = path.join(relative, entry.name);
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    result.push({
      path: rel.replaceAll(path.sep, "/"),
      type: entry.isDirectory() ? "folder" : "file"
    });
    if (entry.isDirectory()) {
      result.push(...await listTree(path.join(dir, entry.name), rel));
    }
  }
  return result;
}

function run(command, cwd = ROOT) {
  return new Promise((resolve) => {
    exec(command, {
      cwd: safePath(cwd),
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error ? error.code : 0,
        stdout,
        stderr
      });
    });
  });
}

async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : {};

  if (req.method === "GET" && url.pathname === "/") {
    return json(res, 200, {
      engine: "DinoEngine",
      version: "0.1.0",
      status: "online",
      workspace: ROOT,
      tools: [
        "project.tree",
        "file.read",
        "file.write",
        "file.create",
        "file.delete",
        "folder.create",
        "git.branch.create",
        "git.status",
        "code.run"
      ]
    });
  }

  if (req.method === "GET" && url.pathname === "/api/tree") {
    return json(res, 200, { root: ROOT, tree: await listTree(ROOT) });
  }

  if (req.method === "GET" && url.pathname === "/api/file") {
    const file = safePath(url.searchParams.get("path") || "");
    return json(res, 200, { path: path.relative(ROOT, file), content: await fsp.readFile(file, "utf8") });
  }

  if (req.method === "POST" && url.pathname === "/api/file") {
    const file = safePath(body.path);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, String(body.content ?? ""), "utf8");
    return json(res, 200, { ok: true, path: path.relative(ROOT, file) });
  }

  if (req.method === "DELETE" && url.pathname === "/api/file") {
    await fsp.rm(safePath(body.path), { force: true });
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/folder") {
    await fsp.mkdir(safePath(body.path), { recursive: true });
    return json(res, 200, { ok: true, path: body.path });
  }

  if (req.method === "POST" && url.pathname === "/api/run") {
    if (!body.command) return json(res, 400, { error: "command is required" });
    return json(res, 200, await run(String(body.command), body.cwd || "."));
  }

  if (req.method === "POST" && url.pathname === "/api/git/branch") {
    if (!body.name) return json(res, 400, { error: "branch name is required" });
    return json(res, 200, await run("git branch " + JSON.stringify(String(body.name))));
  }

  if (req.method === "GET" && url.pathname === "/api/git/status") {
    return json(res, 200, await run("git status --short --branch"));
  }

  json(res, 404, { error: "Not found" });
}

const server = http.createServer((req, res) => {
  route(req, res).catch(error => json(res, 500, { error: error.message }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("DinoEngine v0.1.0");
  console.log("Workspace:", ROOT);
  console.log("API: http://127.0.0.1:" + PORT);
});
