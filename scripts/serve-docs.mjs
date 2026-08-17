#!/usr/bin/env node
// Serves the generated TypeDoc reference over HTTP.
//
//   npm run docs:serve            build, then serve on http://localhost:8080
//   PORT=9000 npm run docs:serve
//
// A static server rather than opening the files directly, because TypeDoc's
// search index is fetched with XHR and `file://` origins cannot fetch it — the
// search box silently does nothing when the site is opened from disk.
//
// Binds to loopback only. This is a preview server, not a deployment.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ROOT = join(REPO_ROOT, "docs", "api-reference");
const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);

if (!existsSync(join(ROOT, "index.html"))) {
  console.error(`\n  ✖ ${ROOT} has no index.html.\n\n    Run \`npm run docs\` first.\n`);
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const decoded = decodeURIComponent(url.pathname);

  // Resolve inside ROOT and verify the result never escapes it. Path traversal
  // on a loopback preview server is low-stakes, but "low-stakes" is not a
  // reason to write the version that does not check.
  let target = normalize(join(ROOT, decoded));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) {
    response.writeHead(403, { "content-type": "text/plain" }).end("Forbidden");
    return;
  }

  if (existsSync(target) && statSync(target).isDirectory()) {
    target = join(target, "index.html");
  }

  if (!existsSync(target)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end(`Not found: ${decoded}`);
    return;
  }

  response.writeHead(200, {
    "content-type": MIME[extname(target)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(target).pipe(response);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Threadline API reference → http://localhost:${PORT}\n`);
  console.log(`  Serving ${ROOT}`);
  console.log(`  Ctrl-C to stop. Re-run \`npm run docs\` in another shell to rebuild.\n`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`\n  ✖ Port ${PORT} is already in use.\n\n    PORT=${PORT + 1} npm run docs:serve\n`);
    process.exit(1);
  }
  throw error;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
