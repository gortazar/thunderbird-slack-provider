"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "../../src");
const PORT = 3456;

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = http.createServer((req, res) => {
  const urlPath = req.url.split("?")[0];
  const filePath = path.join(SRC_DIR, urlPath === "/" ? "/space.html" : urlPath);

  // Security: stay within SRC_DIR
  if (!filePath.startsWith(SRC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const ext = path.extname(filePath);
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  process.stdout.write(`Test server listening on http://localhost:${PORT}\n`);
});

module.exports = server;
