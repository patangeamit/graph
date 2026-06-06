const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_NODES = Number(process.env.MAX_NODES || 1500);
const FRONTEND_DIR = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(__dirname, "..");
const VENV_NAMES = new Set(["venv", "env", "virtualenv", ".venv"]);

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({limit: "1mb"}));
app.use(express.static(FRONTEND_DIR));

function shouldIgnoreEntry(name, ignoreEnvAndDot) {
  if (!ignoreEnvAndDot) return false;
  return name.startsWith(".") || VENV_NAMES.has(name.toLowerCase());
}

async function assertDirectory(dirPath) {
  const resolved = path.isAbsolute(dirPath)
    ? path.resolve(dirPath)
    : path.resolve(PROJECT_ROOT, dirPath);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    const err = new Error("Path is not a directory");
    err.statusCode = 400;
    throw err;
  }
  return resolved;
}

async function buildDirectoryGraph(rootPath, options = {}) {
  const ignoreEnvAndDot = options.ignoreEnvAndDot !== false;
  const rootName = path.basename(rootPath) || rootPath;
  const graph = {nodes: [], links: [], skipped: 0, capped: false};

  async function walk(currentPath, parentId = null) {
    if (graph.nodes.length >= MAX_NODES) {
      graph.capped = true;
      return;
    }

    const id = currentPath;
    const label = parentId ? path.basename(currentPath) : rootName;
    graph.nodes.push({
      id,
      label,
      path: currentPath,
      kind: "directory",
      color: "#4F46E5"
    });

    if (parentId) graph.links.push({source: parentId, target: id});

    let entries;
    try {
      entries = await fs.readdir(currentPath, {withFileTypes: true});
    } catch (err) {
      graph.skipped++;
      return;
    }

    entries.sort((a, b) => {
      if (a.isDirectory() === b.isDirectory()) return a.name.localeCompare(b.name);
      return a.isDirectory() ? -1 : 1;
    });

    for (const entry of entries) {
      if (graph.nodes.length >= MAX_NODES) {
        graph.capped = true;
        break;
      }
      if (shouldIgnoreEntry(entry.name, ignoreEnvAndDot)) {
        graph.skipped++;
        continue;
      }

      const childPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(childPath, id);
      } else if (entry.isFile()) {
        graph.nodes.push({
          id: childPath,
          label: entry.name,
          path: childPath,
          kind: "file",
          color: "#10B981"
        });
        graph.links.push({source: id, target: childPath});
      } else {
        graph.skipped++;
      }
    }
  }

  await walk(rootPath);
  return graph;
}

app.post("/api/graph", async (req, res) => {
  try {
    const dirPath = String(req.body.dirPath || "").trim();
    if (!dirPath) {
      return res.status(400).json({error: "dirPath is required"});
    }

    const root = await assertDirectory(dirPath);
    const graph = await buildDirectoryGraph(root, {
      ignoreEnvAndDot: Boolean(req.body.ignoreEnvAndDot)
    });

    res.json({
      root,
      maxNodes: MAX_NODES,
      ...graph
    });
  } catch (err) {
    const statusCode = err.statusCode || (err.code === "ENOENT" ? 404 : 500);
    res.status(statusCode).json({error: err.message});
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Directory graph server running at http://localhost:${PORT}`);
});
